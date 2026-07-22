package com.mxsuite.controller;

import com.mxsuite.audit.AuditService;
import com.mxsuite.model.Invitation;
import com.mxsuite.model.Invitation.InvitationStatus;
import com.mxsuite.model.User;
import com.mxsuite.model.enums.UserRole;
import com.mxsuite.repository.InvitationRepository;
import com.mxsuite.repository.TenantRepository;
import com.mxsuite.repository.UserRepository;
import com.mxsuite.security.TenantContext;
import com.mxsuite.security.UserPrincipal;
import com.mxsuite.service.EmailService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.env.Environment;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.net.URI;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/invitations")
@Transactional(readOnly = true)
public class InvitationController {

    private static final Logger log = LoggerFactory.getLogger(InvitationController.class);
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    private static final String DEV_DEFAULT_PASSWORD = "Admin123!";

    private final InvitationRepository invitationRepository;
    private final UserRepository userRepository;
    private final TenantRepository tenantRepository;
    private final PasswordEncoder passwordEncoder;
    private final EmailService emailService;
    private final AuditService auditService;
    private final Environment environment;

    public InvitationController(InvitationRepository invitationRepository,
                                 UserRepository userRepository,
                                 TenantRepository tenantRepository,
                                 PasswordEncoder passwordEncoder,
                                 EmailService emailService,
                                 AuditService auditService,
                                 Environment environment) {
        this.invitationRepository = invitationRepository;
        this.userRepository = userRepository;
        this.tenantRepository = tenantRepository;
        this.passwordEncoder = passwordEncoder;
        this.emailService = emailService;
        this.auditService = auditService;
        this.environment = environment;
    }

    public record SendInviteRequest(
            @NotBlank @Email @Size(max = 255) String email,
            @NotNull UserRole role) {}

    // VULN-16: Password complexity requirements
    public record AcceptInviteRequest(
            @NotBlank String token,
            @NotBlank @Size(min = 1, max = 100) String firstName,
            @NotBlank @Size(min = 1, max = 100) String lastName,
            @NotBlank @Size(min = 8, max = 128)
            @Pattern(regexp = "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&\\-_#^+=])[A-Za-z\\d@$!%*?&\\-_#^+=]{8,}$",
                    message = "Password must contain at least 1 uppercase, 1 lowercase, 1 digit, and 1 special character")
            String password) {}

    // VULN-10: Response DTO that excludes the token field
    public record InvitationResponse(String id, String email, String role, String status,
                                      String tenantId, Instant expiresAt, Instant acceptedAt) {}

    @GetMapping("/counts")
    public Map<String, Long> counts(@AuthenticationPrincipal UserPrincipal principal) {
        UUID tenantId = TenantContext.getCurrentTenantId();
        long total = invitationRepository.countByTenantId(tenantId);
        long pending = invitationRepository.countByTenantIdAndStatus(tenantId, InvitationStatus.PENDING);
        long accepted = invitationRepository.countByTenantIdAndStatus(tenantId, InvitationStatus.ACCEPTED);
        long cancelled = invitationRepository.countByTenantIdAndStatus(tenantId, InvitationStatus.CANCELLED);
        long expired = invitationRepository.countByTenantIdAndStatus(tenantId, InvitationStatus.EXPIRED);
        return Map.of("total", total, "pending", pending, "accepted", accepted,
                "cancelled", cancelled, "expired", expired);
    }

    @GetMapping
    public Page<InvitationResponse> list(@AuthenticationPrincipal UserPrincipal principal,
                                          Pageable pageable,
                                          @RequestParam(required = false) String status) {
        UUID tenantId = TenantContext.getCurrentTenantId();
        Page<Invitation> invitations;
        if (status != null) {
            try {
                InvitationStatus invStatus = InvitationStatus.valueOf(status.toUpperCase());
                invitations = invitationRepository.findByTenantIdAndStatus(tenantId, invStatus, pageable);
            } catch (IllegalArgumentException e) {
                invitations = invitationRepository.findByTenantId(tenantId, pageable);
            }
        } else {
            invitations = invitationRepository.findByTenantId(tenantId, pageable);
        }
        return invitations.map(this::toResponse);
    }

    @PostMapping
    @Transactional
    public ResponseEntity<?> sendInvite(@AuthenticationPrincipal UserPrincipal principal,
                                         @Valid @RequestBody SendInviteRequest request) {
        UUID tenantId = TenantContext.getCurrentTenantId();

        // Only TENANT_ADMIN, PLATFORM_ADMIN, PLATFORM_SUPPORT can invite
        if (principal.role() != UserRole.TENANT_ADMIN
                && principal.role() != UserRole.PLATFORM_ADMIN
                && principal.role() != UserRole.PLATFORM_SUPPORT) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of(
                    "status", 403, "message", "Only admins can send invitations"));
        }

        // Tenant users can only invite TENANT_USER or TENANT_ADMIN roles
        if (!principal.isPlatformUser() &&
                (request.role() == UserRole.PLATFORM_ADMIN || request.role() == UserRole.PLATFORM_SUPPORT)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of(
                    "status", 403, "message", "Cannot assign platform roles"));
        }

        String email = request.email().toLowerCase().trim();

        // Check if user already exists
        if (userRepository.existsByEmail(email)) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of(
                    "status", 409, "message", "A user with this email already exists"));
        }

        // Check for pending invitation
        if (invitationRepository.existsByEmailAndTenantIdAndStatus(email, tenantId, InvitationStatus.PENDING)) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of(
                    "status", 409, "message", "A pending invitation already exists for this email"));
        }

        var tenant = tenantRepository.findById(tenantId).orElseThrow();
        var inviter = userRepository.findById(principal.id()).orElseThrow();

        // VULN-09: Use SecureRandom instead of UUID.randomUUID()
        String token = generateSecureToken();

        Invitation invitation = new Invitation();
        invitation.setEmail(email);
        invitation.setToken(token);
        invitation.setRole(request.role());
        invitation.setTenant(tenant);
        invitation.setInvitedBy(inviter);
        invitation.setStatus(InvitationStatus.PENDING);
        invitation.setExpiresAt(Instant.now().plus(7, ChronoUnit.DAYS));
        invitation = invitationRepository.save(invitation);

        if (isDevLoginEnabled()) {
            // Dev mode: auto-accept invitation — create user directly, skip email
            User user = new User();
            user.setEmail(email);
            user.setFirstName(email.split("@")[0]); // derive name from email
            user.setLastName("(Dev)");
            user.setPasswordHash(passwordEncoder.encode(DEV_DEFAULT_PASSWORD));
            user.setRole(request.role());
            user.setTenant(tenant);
            user.setActive(true);
            userRepository.save(user);

            invitation.setStatus(InvitationStatus.ACCEPTED);
            invitation.setAcceptedAt(Instant.now());
            invitationRepository.save(invitation);

            auditService.log("INVITE", "Invitation", invitation.getId(),
                    email + " (dev-mode: auto-accepted)");
            log.info("Invitation auto-accepted (dev mode): email={} role={} tenant={}",
                    email, request.role(), tenant.getSlug());
        } else {
            emailService.sendInvitation(email, principal.getFullName(), tenant.getName(), invitation.getToken());

            auditService.log("INVITE", "Invitation", invitation.getId(), email);
            log.info("Invitation sent: email={} role={} tenant={} by={}", email, request.role(),
                    tenant.getSlug(), principal.email());
        }

        // VULN-10: Return response DTO without token
        return ResponseEntity
                .created(URI.create("/api/invitations/" + invitation.getId()))
                .body(toResponse(invitation));
    }

    // VULN-06: @Transactional + pessimistic lock to prevent double-acceptance
    @PostMapping("/accept")
    @Transactional
    public ResponseEntity<?> acceptInvite(@Valid @RequestBody AcceptInviteRequest request) {
        // Use pessimistic lock to prevent race conditions
        var invitation = invitationRepository.findByTokenForUpdate(request.token()).orElse(null);
        if (invitation == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of(
                    "status", 404, "message", "Invalid invitation token"));
        }

        if (invitation.getStatus() != InvitationStatus.PENDING) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of(
                    "status", 409, "message", "This invitation has already been " + invitation.getStatus().name().toLowerCase()));
        }

        if (invitation.isExpired()) {
            invitation.setStatus(InvitationStatus.EXPIRED);
            invitationRepository.save(invitation);
            return ResponseEntity.status(HttpStatus.GONE).body(Map.of(
                    "status", 410, "message", "This invitation has expired. Please ask the sender to resend."));
        }

        if (userRepository.existsByEmail(invitation.getEmail())) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of(
                    "status", 409, "message", "A user with this email already exists"));
        }

        User user = new User();
        user.setEmail(invitation.getEmail());
        user.setFirstName(request.firstName().trim());
        user.setLastName(request.lastName().trim());
        user.setPasswordHash(passwordEncoder.encode(request.password()));
        user.setRole(invitation.getRole());
        user.setTenant(invitation.getTenant());
        user.setActive(true);
        user = userRepository.save(user);

        invitation.setStatus(InvitationStatus.ACCEPTED);
        invitation.setAcceptedAt(Instant.now());
        invitationRepository.save(invitation);

        log.info("Invitation accepted: email={} tenant={}", invitation.getEmail(),
                invitation.getTenant().getSlug());

        return ResponseEntity.ok(Map.of(
                "message", "Account created successfully. You can now log in.",
                "email", user.getEmail()));
    }

    @PostMapping("/{id}/cancel")
    @Transactional
    public ResponseEntity<?> cancel(@PathVariable UUID id,
                                     @AuthenticationPrincipal UserPrincipal principal) {
        var invitation = invitationRepository.findById(id).orElse(null);
        if (invitation == null) return ResponseEntity.notFound().build();

        UUID tenantId = TenantContext.getCurrentTenantId();
        if (!invitation.getTenant().getId().equals(tenantId) && !principal.isPlatformUser()) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }

        if (invitation.getStatus() != InvitationStatus.PENDING) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of(
                    "status", 409, "message", "Only pending invitations can be cancelled"));
        }

        invitation.setStatus(InvitationStatus.CANCELLED);
        invitationRepository.save(invitation);

        auditService.log("CANCEL_INVITE", "Invitation", invitation.getId(), invitation.getEmail());
        log.info("Invitation cancelled: email={} by={}", invitation.getEmail(), principal.email());

        return ResponseEntity.ok(Map.of("message", "Invitation cancelled"));
    }

    @PostMapping("/{id}/resend")
    @Transactional
    public ResponseEntity<?> resend(@PathVariable UUID id,
                                     @AuthenticationPrincipal UserPrincipal principal) {
        var invitation = invitationRepository.findById(id).orElse(null);
        if (invitation == null) return ResponseEntity.notFound().build();

        UUID tenantId = TenantContext.getCurrentTenantId();
        if (!invitation.getTenant().getId().equals(tenantId) && !principal.isPlatformUser()) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }

        // VULN-09: Use SecureRandom instead of UUID.randomUUID()
        invitation.setToken(generateSecureToken());
        invitation.setExpiresAt(Instant.now().plus(7, ChronoUnit.DAYS));
        invitation.setStatus(InvitationStatus.PENDING);
        invitation = invitationRepository.save(invitation);

        emailService.sendInvitation(invitation.getEmail(), principal.getFullName(),
                invitation.getTenant().getName(), invitation.getToken());

        auditService.log("RESEND_INVITE", "Invitation", invitation.getId(), invitation.getEmail());
        log.info("Invitation resent: email={} by={}", invitation.getEmail(), principal.email());

        return ResponseEntity.ok(Map.of("message", "Invitation resent"));
    }

    // VULN-10: Convert entity to response DTO without token
    private InvitationResponse toResponse(Invitation invitation) {
        return new InvitationResponse(
                invitation.getId().toString(),
                invitation.getEmail(),
                invitation.getRole().name(),
                invitation.getStatus().name(),
                invitation.getTenant().getId().toString(),
                invitation.getExpiresAt(),
                invitation.getAcceptedAt()
        );
    }

    private boolean isDevLoginEnabled() {
        for (String profile : environment.getActiveProfiles()) {
            if ("devlogin".equals(profile)) return true;
        }
        return false;
    }

    // VULN-09: Generate cryptographically secure token
    private static String generateSecureToken() {
        byte[] bytes = new byte[32];
        SECURE_RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
}
