package com.mxsuite.controller;

import com.mxsuite.audit.AuditService;
import com.mxsuite.model.Invitation;
import com.mxsuite.model.Invitation.InvitationStatus;
import com.mxsuite.model.PlatformAssignment;
import com.mxsuite.model.Tenant;
import com.mxsuite.model.User;
import com.mxsuite.model.enums.TenantType;
import com.mxsuite.model.enums.UserRole;
import com.mxsuite.repository.InvitationRepository;
import com.mxsuite.repository.PlatformAssignmentRepository;
import com.mxsuite.repository.TenantRepository;
import com.mxsuite.repository.UserRepository;
import com.mxsuite.service.EmailService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.core.io.InputStreamResource;
import org.springframework.core.io.Resource;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.crypto.password.PasswordEncoder;
import com.mxsuite.security.UserPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@RestController
@RequestMapping("/api/admin/tenants")
@PreAuthorize("hasAnyRole('PLATFORM_ADMIN', 'PLATFORM_SUPPORT')")
@Transactional(readOnly = true)
public class TenantController {

    private static final Logger log = LoggerFactory.getLogger(TenantController.class);
    private static final long MAX_LOGO_SIZE = 2 * 1024 * 1024; // 2 MB
    private static final Set<String> ALLOWED_IMAGE_TYPES = Set.of(
            "image/png", "image/jpeg", "image/svg+xml", "image/webp");
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    private final TenantRepository tenantRepository;
    private final UserRepository userRepository;
    private final InvitationRepository invitationRepository;
    private final PlatformAssignmentRepository assignmentRepository;
    private final EmailService emailService;
    private final AuditService auditService;
    private final PasswordEncoder passwordEncoder;
    private final Environment environment;
    private final String basePath;

    private static final String DEV_DEFAULT_PASSWORD = "Admin123!";

    public TenantController(TenantRepository tenantRepository, UserRepository userRepository,
                            InvitationRepository invitationRepository,
                            PlatformAssignmentRepository assignmentRepository,
                            EmailService emailService,
                            AuditService auditService,
                            PasswordEncoder passwordEncoder,
                            Environment environment,
                            @Value("${mxsuite.storage.local.base-path}") String basePath) {
        this.tenantRepository = tenantRepository;
        this.userRepository = userRepository;
        this.invitationRepository = invitationRepository;
        this.assignmentRepository = assignmentRepository;
        this.emailService = emailService;
        this.auditService = auditService;
        this.passwordEncoder = passwordEncoder;
        this.environment = environment;
        this.basePath = basePath;
    }

    public record AssignCoachRequest(UUID userId) {}

    public record CoachDto(UUID id, String firstName, String lastName, String email) {}

    public record CreateTenantRequest(
            @NotBlank @Size(min = 2, max = 100) String name,
            @NotBlank @Size(min = 2, max = 50) @Pattern(regexp = "^[a-z0-9-]+$",
                    message = "Slug must contain only lowercase letters, numbers, and hyphens") String slug,
            List<UUID> coachIds) {}

    public record UpdateTenantRequest(
            @Size(min = 2, max = 100) String name,
            Boolean active,
            @Size(max = 100) String brandName,
            @Size(max = 500) String logoUrl,
            Map<String, Object> themeConfig,
            Map<String, Object> featureConfig,
            Boolean openToAllCoaches) {}

    public record CreateTenantWithOwnerRequest(
            @NotBlank @Size(min = 2, max = 100) String name,
            @NotBlank @Size(min = 2, max = 50) @Pattern(regexp = "^[a-z0-9-]+$",
                    message = "Slug must contain only lowercase letters, numbers, and hyphens") String slug,
            @NotBlank @Email String ownerEmail,
            @NotBlank @Size(min = 1, max = 100) String ownerFirstName,
            @NotBlank @Size(min = 1, max = 100) String ownerLastName,
            List<UUID> coachIds) {}

    @GetMapping
    public Page<Tenant> list(Pageable pageable, @RequestParam(required = false) String search) {
        if (search != null && !search.isBlank()) {
            return tenantRepository.findByNameContainingIgnoreCase(search.trim(), pageable);
        }
        return tenantRepository.findAll(pageable);
    }

    @GetMapping("/stats")
    public Map<String, Long> stats() {
        long totalOrganizations = tenantRepository.countByTenantTypeAndActive(TenantType.CUSTOMER, true);
        long totalUsers = userRepository.countByActive(true);
        return Map.of(
                "totalOrganizations", totalOrganizations,
                "totalUsers", totalUsers
        );
    }

    @GetMapping("/{id}")
    public ResponseEntity<Tenant> get(@PathVariable UUID id) {
        return tenantRepository.findById(id)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping
    @PreAuthorize("hasRole('PLATFORM_ADMIN')")
    @Transactional
    public ResponseEntity<?> create(@Valid @RequestBody CreateTenantRequest request) {
        if (tenantRepository.existsBySlug(request.slug())) {
            log.warn("Attempt to create tenant with duplicate slug: {}", request.slug());
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of(
                    "status", 409,
                    "message", "A tenant with slug '" + request.slug() + "' already exists"
            ));
        }

        Tenant tenant = new Tenant();
        tenant.setName(request.name().trim());
        tenant.setSlug(request.slug().trim());
        tenant.setTenantType(TenantType.CUSTOMER);
        tenant.setActive(true);
        // Default to open-to-all-coaches when no specific coaches are assigned
        boolean hasCoaches = request.coachIds() != null && !request.coachIds().isEmpty();
        tenant.setOpenToAllCoaches(!hasCoaches);
        tenant = tenantRepository.save(tenant);

        assignCoaches(tenant, request.coachIds());
        auditService.log("CREATE", "Tenant", tenant.getId(), tenant.getName());
        log.info("Created tenant: slug={} id={} openToAllCoaches={}", tenant.getSlug(), tenant.getId(), !hasCoaches);

        return ResponseEntity
                .created(URI.create("/api/admin/tenants/" + tenant.getId()))
                .body(tenant);
    }

    @PostMapping("/with-owner")
    @PreAuthorize("hasRole('PLATFORM_ADMIN')")
    @Transactional
    public ResponseEntity<?> createWithOwner(@Valid @RequestBody CreateTenantWithOwnerRequest request,
                                              @AuthenticationPrincipal UserPrincipal principal) {
        if (tenantRepository.existsBySlug(request.slug())) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of(
                    "status", 409,
                    "message", "A tenant with slug '" + request.slug() + "' already exists"
            ));
        }

        String email = request.ownerEmail().trim().toLowerCase();
        if (userRepository.existsByEmail(email)) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of(
                    "status", 409,
                    "message", "A user with email '" + email + "' already exists"
            ));
        }

        // Create tenant
        Tenant tenant = new Tenant();
        tenant.setName(request.name().trim());
        tenant.setSlug(request.slug().trim());
        tenant.setTenantType(TenantType.CUSTOMER);
        tenant.setActive(true);
        boolean hasCoaches = request.coachIds() != null && !request.coachIds().isEmpty();
        tenant.setOpenToAllCoaches(!hasCoaches);
        tenant = tenantRepository.save(tenant);

        assignCoaches(tenant, request.coachIds());

        if (isDevLoginEnabled()) {
            // Dev mode: create user directly with default password — no invitation, no email
            User owner = new User();
            owner.setEmail(email);
            owner.setFirstName(request.ownerFirstName().trim());
            owner.setLastName(request.ownerLastName().trim());
            owner.setPasswordHash(passwordEncoder.encode(DEV_DEFAULT_PASSWORD));
            owner.setRole(UserRole.TENANT_ADMIN);
            owner.setTenant(tenant);
            owner.setActive(true);
            userRepository.save(owner);

            auditService.log("CREATE", "Tenant", tenant.getId(),
                    tenant.getName() + " (dev-mode: owner created directly: " + email + ")");
            log.info("Created tenant with direct owner (dev mode): slug={} owner={}", tenant.getSlug(), email);

            return ResponseEntity
                    .created(URI.create("/api/admin/tenants/" + tenant.getId()))
                    .body(Map.of("tenant", tenant, "owner", Map.of(
                            "email", email,
                            "role", UserRole.TENANT_ADMIN.name(),
                            "status", "CREATED",
                            "defaultPassword", DEV_DEFAULT_PASSWORD
                    )));
        }

        // Production: send invitation email
        var inviter = userRepository.findById(principal.id()).orElseThrow();
        String token = generateSecureToken();

        Invitation invitation = new Invitation();
        invitation.setEmail(email);
        invitation.setToken(token);
        invitation.setRole(UserRole.TENANT_ADMIN);
        invitation.setTenant(tenant);
        invitation.setInvitedBy(inviter);
        invitation.setStatus(InvitationStatus.PENDING);
        invitation.setExpiresAt(Instant.now().plus(7, ChronoUnit.DAYS));
        invitationRepository.save(invitation);

        emailService.sendInvitation(email, principal.getFullName(), tenant.getName(), token);

        auditService.log("CREATE", "Tenant", tenant.getId(),
                tenant.getName() + " (invitation sent to: " + email + ")");
        log.info("Created tenant with invitation: slug={} invitee={}", tenant.getSlug(), email);

        return ResponseEntity
                .created(URI.create("/api/admin/tenants/" + tenant.getId()))
                .body(Map.of("tenant", tenant, "invitation", Map.of(
                        "email", email,
                        "role", UserRole.TENANT_ADMIN.name(),
                        "status", "PENDING"
                )));
    }

    private static String generateSecureToken() {
        byte[] bytes = new byte[32];
        SECURE_RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasRole('PLATFORM_ADMIN')")
    @Transactional
    public ResponseEntity<Tenant> update(@PathVariable UUID id,
                                          @Valid @RequestBody UpdateTenantRequest request) {
        return tenantRepository.findById(id)
                .map(tenant -> {
                    if (request.name() != null) tenant.setName(request.name().trim());
                    if (request.active() != null) {
                        tenant.setActive(request.active());
                        log.info("Tenant {} {} by platform admin", tenant.getSlug(),
                                request.active() ? "activated" : "deactivated");
                    }
                    if (request.brandName() != null) tenant.setBrandName(request.brandName().trim());
                    if (request.logoUrl() != null) tenant.setLogoUrl(request.logoUrl().trim());
                    if (request.themeConfig() != null) tenant.setThemeConfig(request.themeConfig());
                    if (request.featureConfig() != null) tenant.setFeatureConfig(request.featureConfig());
                    if (request.openToAllCoaches() != null) tenant.setOpenToAllCoaches(request.openToAllCoaches());
                    tenant = tenantRepository.save(tenant);
                    auditService.log("UPDATE", "Tenant", tenant.getId(), tenant.getName());
                    return ResponseEntity.ok(tenant);
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping("/{id}/logo")
    @PreAuthorize("hasRole('PLATFORM_ADMIN')")
    @Transactional
    public ResponseEntity<?> uploadLogo(@PathVariable UUID id,
                                         @RequestParam("file") MultipartFile file) {
        var tenant = tenantRepository.findById(id).orElse(null);
        if (tenant == null) return ResponseEntity.notFound().build();

        if (file.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("status", 400, "message", "File is empty"));
        }
        if (file.getSize() > MAX_LOGO_SIZE) {
            return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE)
                    .body(Map.of("status", 413, "message", "Logo must be under 2MB"));
        }
        String contentType = file.getContentType();
        if (contentType == null || !ALLOWED_IMAGE_TYPES.contains(contentType)) {
            return ResponseEntity.status(HttpStatus.UNSUPPORTED_MEDIA_TYPE)
                    .body(Map.of("status", 415, "message", "Allowed types: PNG, JPG, SVG, WEBP"));
        }

        try {
            String ext = contentType.equals("image/svg+xml") ? ".svg"
                    : contentType.equals("image/webp") ? ".webp"
                    : contentType.equals("image/png") ? ".png" : ".jpg";
            String storageName = "logo_" + UUID.randomUUID() + ext;
            Path storagePath = Paths.get(basePath, "tenants", id.toString());
            Files.createDirectories(storagePath);
            Path resolvedFile = storagePath.resolve(storageName);
            Files.copy(file.getInputStream(), resolvedFile);

            String logoUrl = "/api/admin/tenants/" + id + "/logo/file";
            tenant.setLogoUrl(logoUrl);
            tenantRepository.save(tenant);

            auditService.log("UPLOAD_LOGO", "Tenant", tenant.getId(), tenant.getName());
            return ResponseEntity.ok(Map.of("logoUrl", logoUrl));
        } catch (IOException e) {
            log.error("Logo upload failed for tenant {}: {}", id, e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("status", 500, "message", "Failed to store logo"));
        }
    }

    // --- Coach assignment endpoints ---

    @GetMapping("/{id}/coaches")
    public ResponseEntity<List<CoachDto>> listCoaches(@PathVariable UUID id) {
        if (!tenantRepository.existsById(id)) return ResponseEntity.notFound().build();
        List<CoachDto> coaches = assignmentRepository.findByTenantIdAndActiveTrue(id).stream()
                .map(a -> toCoachDto(a.getPlatformUser()))
                .toList();
        return ResponseEntity.ok(coaches);
    }

    @PostMapping("/{id}/coaches")
    @PreAuthorize("hasRole('PLATFORM_ADMIN')")
    @Transactional
    public ResponseEntity<?> assignCoach(@PathVariable UUID id,
                                          @RequestBody AssignCoachRequest request) {
        var tenant = tenantRepository.findById(id).orElse(null);
        if (tenant == null) return ResponseEntity.notFound().build();
        var user = userRepository.findById(request.userId()).orElse(null);
        if (user == null) return ResponseEntity.badRequest().body(Map.of("message", "User not found"));
        if (!user.getRole().name().startsWith("PLATFORM_")) {
            return ResponseEntity.badRequest().body(Map.of("message", "User must be a platform user"));
        }
        var existing = assignmentRepository.findByTenantId(id).stream()
                .filter(a -> a.getPlatformUser().getId().equals(request.userId()))
                .findFirst();
        if (existing.isPresent()) {
            existing.get().setActive(true);
            assignmentRepository.save(existing.get());
        } else {
            PlatformAssignment pa = new PlatformAssignment();
            pa.setPlatformUser(user);
            pa.setTenant(tenant);
            pa.setActive(true);
            assignmentRepository.save(pa);
        }
        auditService.log("ASSIGN_COACH", "Tenant", id, user.getFullName());
        return ResponseEntity.ok(toCoachDto(user));
    }

    @DeleteMapping("/{id}/coaches/{userId}")
    @PreAuthorize("hasRole('PLATFORM_ADMIN')")
    @Transactional
    public ResponseEntity<Void> unassignCoach(@PathVariable UUID id, @PathVariable UUID userId) {
        assignmentRepository.findByTenantId(id).stream()
                .filter(a -> a.getPlatformUser().getId().equals(userId))
                .forEach(a -> { a.setActive(false); assignmentRepository.save(a); });
        auditService.log("UNASSIGN_COACH", "Tenant", id, userId.toString());
        return ResponseEntity.noContent().build();
    }

    private void assignCoaches(Tenant tenant, List<UUID> coachIds) {
        if (coachIds == null || coachIds.isEmpty()) return;
        for (UUID coachId : coachIds) {
            userRepository.findById(coachId).ifPresent(user -> {
                if (!assignmentRepository.existsByPlatformUserIdAndTenantId(coachId, tenant.getId())) {
                    PlatformAssignment pa = new PlatformAssignment();
                    pa.setPlatformUser(user);
                    pa.setTenant(tenant);
                    pa.setActive(true);
                    assignmentRepository.save(pa);
                }
            });
        }
    }

    private boolean isDevLoginEnabled() {
        for (String profile : environment.getActiveProfiles()) {
            if ("devlogin".equals(profile)) return true;
        }
        return false;
    }

    private CoachDto toCoachDto(User user) {
        return new CoachDto(user.getId(), user.getFirstName(), user.getLastName(), user.getEmail());
    }

    @GetMapping("/{id}/logo/file")
    @PreAuthorize("permitAll()")
    public ResponseEntity<Resource> serveLogo(@PathVariable UUID id) {
        var tenant = tenantRepository.findById(id).orElse(null);
        if (tenant == null || tenant.getLogoUrl() == null) {
            return ResponseEntity.notFound().build();
        }

        try {
            Path tenantDir = Paths.get(basePath, "tenants", id.toString());
            if (!Files.exists(tenantDir)) return ResponseEntity.notFound().build();

            // Find the latest logo file
            var logoFile = Files.list(tenantDir)
                    .filter(p -> p.getFileName().toString().startsWith("logo_"))
                    .reduce((a, b) -> b) // last one (most recent)
                    .orElse(null);

            if (logoFile == null || !Files.exists(logoFile)) {
                return ResponseEntity.notFound().build();
            }

            String filename = logoFile.getFileName().toString();
            String contentType = filename.endsWith(".svg") ? "image/svg+xml"
                    : filename.endsWith(".webp") ? "image/webp"
                    : filename.endsWith(".png") ? "image/png" : "image/jpeg";

            return ResponseEntity.ok()
                    .contentType(MediaType.parseMediaType(contentType))
                    .header(HttpHeaders.CACHE_CONTROL, "public, max-age=3600")
                    .body(new InputStreamResource(Files.newInputStream(logoFile)));
        } catch (IOException e) {
            log.error("Failed to serve logo for tenant {}: {}", id, e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }
}
