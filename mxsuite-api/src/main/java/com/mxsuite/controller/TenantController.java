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
import com.mxsuite.model.PhaseGate;
import com.mxsuite.model.PhaseTimeEntry;
import com.mxsuite.model.Project;
import com.mxsuite.model.enums.GateApprovalMode;
import com.mxsuite.model.enums.GateStatus;
import com.mxsuite.model.enums.MigrationPhase;
import com.mxsuite.model.enums.MigrationStatus;
import com.mxsuite.repository.PhaseGateRepository;
import com.mxsuite.repository.PhaseTimeEntryRepository;
import com.mxsuite.repository.ProjectRepository;
import com.mxsuite.service.EmailService;
import java.math.BigDecimal;
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

import jakarta.persistence.EntityManager;

import java.io.IOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@RestController
@RequestMapping("/api/admin/tenants")
@PreAuthorize("hasAnyRole('PLATFORM_ADMIN', 'COACH_ADMIN', 'PLATFORM_SUPPORT')")
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
    private final EntityManager entityManager;
    private final com.mxsuite.service.NotificationService notificationService;
    private final ProjectRepository projectRepository;
    private final PhaseGateRepository phaseGateRepository;
    private final PhaseTimeEntryRepository phaseTimeEntryRepository;
    private final String basePath;

    private static final String DEV_DEFAULT_PASSWORD = "Admin123!";

    public TenantController(TenantRepository tenantRepository, UserRepository userRepository,
                            InvitationRepository invitationRepository,
                            PlatformAssignmentRepository assignmentRepository,
                            EmailService emailService,
                            AuditService auditService,
                            PasswordEncoder passwordEncoder,
                            Environment environment,
                            EntityManager entityManager,
                            com.mxsuite.service.NotificationService notificationService,
                            ProjectRepository projectRepository,
                            PhaseGateRepository phaseGateRepository,
                            PhaseTimeEntryRepository phaseTimeEntryRepository,
                            @Value("${mxsuite.storage.local.base-path}") String basePath) {
        this.tenantRepository = tenantRepository;
        this.userRepository = userRepository;
        this.invitationRepository = invitationRepository;
        this.assignmentRepository = assignmentRepository;
        this.emailService = emailService;
        this.auditService = auditService;
        this.passwordEncoder = passwordEncoder;
        this.environment = environment;
        this.entityManager = entityManager;
        this.notificationService = notificationService;
        this.projectRepository = projectRepository;
        this.phaseGateRepository = phaseGateRepository;
        this.phaseTimeEntryRepository = phaseTimeEntryRepository;
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
            Map<String, Object> aiConfig,
            Boolean openToAllCoaches,
            Boolean chatFilesEnabled) {}

    public record CreateTenantWithOwnerRequest(
            @NotBlank @Size(min = 2, max = 100) String name,
            @NotBlank @Size(min = 2, max = 50) @Pattern(regexp = "^[a-z0-9-]+$",
                    message = "Slug must contain only lowercase letters, numbers, and hyphens") String slug,
            @NotBlank @Email String ownerEmail,
            @NotBlank @Size(min = 1, max = 100) String ownerFirstName,
            @NotBlank @Size(min = 1, max = 100) String ownerLastName,
            List<UUID> coachIds) {}

    @GetMapping
    public Page<Tenant> list(@AuthenticationPrincipal UserPrincipal principal,
                             Pageable pageable,
                             @RequestParam(required = false) String search,
                             @RequestParam(required = false) String letter,
                             @RequestParam(required = false) TenantType tenantType) {
        boolean hasSearch = search != null && !search.isBlank();
        boolean hasLetter = letter != null && !letter.isBlank();

        // Coaches (PLATFORM_SUPPORT and COACH_ADMIN) only see their assigned tenants + open-to-all
        if (principal.role() == UserRole.PLATFORM_SUPPORT || principal.role() == UserRole.COACH_ADMIN) {
            TenantType type = tenantType != null ? tenantType : TenantType.CUSTOMER;
            if (hasSearch) {
                return tenantRepository.findByTenantTypeAndCoachAndSearch(type, principal.id(), search.trim(), pageable);
            }
            if (hasLetter) {
                return tenantRepository.findByTenantTypeAndCoachAndLetter(type, principal.id(), letter.trim(), pageable);
            }
            return tenantRepository.findByTenantTypeAndCoach(type, principal.id(), pageable);
        }

        if (tenantType != null && hasSearch) {
            return tenantRepository.findByTenantTypeAndNameContainingIgnoreCase(tenantType, search.trim(), pageable);
        }
        if (tenantType != null && hasLetter) {
            return tenantRepository.findByTenantTypeAndNameStartingWithIgnoreCase(tenantType, letter.trim(), pageable);
        }
        if (tenantType != null) {
            return tenantRepository.findByTenantType(tenantType, pageable);
        }
        if (hasSearch) {
            return tenantRepository.findByNameContainingIgnoreCase(search.trim(), pageable);
        }
        if (hasLetter) {
            return tenantRepository.findByNameStartingWithIgnoreCase(letter.trim(), pageable);
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
        tenant.setOpenToAllCoaches(false);
        tenant = tenantRepository.save(tenant);

        assignCoaches(tenant, request.coachIds());
        auditService.log("CREATE", "Tenant", tenant.getId(), tenant.getName());
        log.info("Created tenant: slug={} id={}", tenant.getSlug(), tenant.getId());

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
        tenant.setOpenToAllCoaches(false);
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

            // Auto-create the onboarding project so it appears in the pipeline immediately
            initOnboardingProject(tenant, owner);

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
                    if (request.aiConfig() != null) tenant.setAiConfig(request.aiConfig());
                    if (request.openToAllCoaches() != null) tenant.setOpenToAllCoaches(request.openToAllCoaches());
                    if (request.chatFilesEnabled() != null) tenant.setChatFilesEnabled(request.chatFilesEnabled());
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
    @PreAuthorize("hasAnyRole('PLATFORM_ADMIN', 'COACH_ADMIN')")
    @Transactional
    public ResponseEntity<?> assignCoach(@PathVariable UUID id,
                                          @RequestBody AssignCoachRequest request,
                                          @AuthenticationPrincipal UserPrincipal principal) {
        var tenant = tenantRepository.findById(id).orElse(null);
        if (tenant == null) return ResponseEntity.notFound().build();
        var user = userRepository.findById(request.userId()).orElse(null);
        if (user == null) return ResponseEntity.badRequest().body(Map.of("message", "User not found"));
        if (user.getRole() != UserRole.COACH_ADMIN && user.getRole() != UserRole.PLATFORM_SUPPORT) {
            return ResponseEntity.badRequest().body(Map.of("message", "Only coach admins and coaches can be assigned to organizations"));
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
        String assignerName = userRepository.findById(principal.id())
                .map(User::getFullName).orElse("An administrator");
        UUID notifyUserId = user.getId();
        String notifyTenantName = tenant.getName();
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override public void afterCommit() {
                notificationService.notifyCoachAssigned(notifyUserId, id, notifyTenantName, assignerName);
            }
        });
        return ResponseEntity.ok(toCoachDto(user));
    }

    @DeleteMapping("/{id}/coaches/{userId}")
    @PreAuthorize("hasAnyRole('PLATFORM_ADMIN', 'COACH_ADMIN', 'PLATFORM_SUPPORT')")
    @Transactional
    public ResponseEntity<Void> unassignCoach(@PathVariable UUID id, @PathVariable UUID userId,
                                               @AuthenticationPrincipal UserPrincipal principal) {
        // Coaches (PLATFORM_SUPPORT) can only remove themselves
        if (principal.role() == UserRole.PLATFORM_SUPPORT && !principal.id().equals(userId)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
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
                if (user.getRole() != UserRole.COACH_ADMIN && user.getRole() != UserRole.PLATFORM_SUPPORT) return;
                if (!assignmentRepository.existsByPlatformUserIdAndTenantId(coachId, tenant.getId())) {
                    PlatformAssignment pa = new PlatformAssignment();
                    pa.setPlatformUser(user);
                    pa.setTenant(tenant);
                    pa.setActive(true);
                    assignmentRepository.save(pa);
                    UUID tId = tenant.getId();
                    String tName = tenant.getName();
                    TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                        @Override public void afterCommit() {
                            notificationService.notifyCoachAssigned(coachId, tId, tName, "An administrator");
                        }
                    });
                }
            });
        }
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('PLATFORM_ADMIN')")
    @Transactional
    public ResponseEntity<?> delete(@PathVariable UUID id) {
        var tenant = tenantRepository.findById(id).orElse(null);
        if (tenant == null) return ResponseEntity.notFound().build();

        if (tenant.getTenantType() == TenantType.PLATFORM) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of(
                    "message", "Cannot delete the platform organization"));
        }

        String name = tenant.getName();

        // Clear onboarding project FK on tenant before deleting projects
        entityManager.createNativeQuery("UPDATE tenants SET onboarding_project_id = NULL WHERE id = :tid")
                .setParameter("tid", id).executeUpdate();
        entityManager.flush();

        // Delete all related records in dependency order
        // 1. Records referencing projects owned by this tenant
        entityManager.createNativeQuery(
                "DELETE FROM mapping_candidates WHERE field_mapping_id IN " +
                "(SELECT id FROM field_mapping_entries WHERE project_id IN (SELECT id FROM projects WHERE tenant_id = :tid))")
                .setParameter("tid", id).executeUpdate();
        entityManager.createNativeQuery(
                "DELETE FROM mapping_versions WHERE project_id IN (SELECT id FROM projects WHERE tenant_id = :tid)")
                .setParameter("tid", id).executeUpdate();
        entityManager.createNativeQuery(
                "DELETE FROM field_mapping_entries WHERE project_id IN (SELECT id FROM projects WHERE tenant_id = :tid)")
                .setParameter("tid", id).executeUpdate();
        entityManager.createNativeQuery(
                "DELETE FROM source_schema_nodes WHERE project_id IN (SELECT id FROM projects WHERE tenant_id = :tid)")
                .setParameter("tid", id).executeUpdate();
        entityManager.createNativeQuery(
                "DELETE FROM project_data_uploads WHERE project_id IN (SELECT id FROM projects WHERE tenant_id = :tid)")
                .setParameter("tid", id).executeUpdate();
        entityManager.createNativeQuery(
                "DELETE FROM project_assets WHERE project_id IN (SELECT id FROM projects WHERE tenant_id = :tid)")
                .setParameter("tid", id).executeUpdate();
        entityManager.createNativeQuery(
                "DELETE FROM project_access WHERE project_id IN (SELECT id FROM projects WHERE tenant_id = :tid)")
                .setParameter("tid", id).executeUpdate();
        entityManager.createNativeQuery(
                "DELETE FROM phase_gates WHERE project_id IN (SELECT id FROM projects WHERE tenant_id = :tid)")
                .setParameter("tid", id).executeUpdate();
        entityManager.createNativeQuery(
                "DELETE FROM plan_runs WHERE plan_id IN " +
                "(SELECT id FROM plans WHERE project_id IN (SELECT id FROM projects WHERE tenant_id = :tid))")
                .setParameter("tid", id).executeUpdate();
        entityManager.createNativeQuery(
                "DELETE FROM plans WHERE project_id IN (SELECT id FROM projects WHERE tenant_id = :tid)")
                .setParameter("tid", id).executeUpdate();
        entityManager.createNativeQuery(
                "DELETE FROM approval_requests WHERE project_id IN (SELECT id FROM projects WHERE tenant_id = :tid)")
                .setParameter("tid", id).executeUpdate();

        // 2. Records referencing tenant directly
        entityManager.createNativeQuery("DELETE FROM reconciliation_reports WHERE tenant_id = :tid")
                .setParameter("tid", id).executeUpdate();
        entityManager.createNativeQuery("DELETE FROM semantic_decisions WHERE tenant_id = :tid")
                .setParameter("tid", id).executeUpdate();
        entityManager.createNativeQuery("DELETE FROM migration_blueprints WHERE tenant_id = :tid")
                .setParameter("tid", id).executeUpdate();
        entityManager.createNativeQuery("DELETE FROM onboardings WHERE tenant_id = :tid")
                .setParameter("tid", id).executeUpdate();
        entityManager.createNativeQuery("DELETE FROM invitations WHERE tenant_id = :tid")
                .setParameter("tid", id).executeUpdate();
        entityManager.createNativeQuery("DELETE FROM platform_assignments WHERE tenant_id = :tid")
                .setParameter("tid", id).executeUpdate();
        entityManager.createNativeQuery("DELETE FROM notifications WHERE tenant_id = :tid")
                .setParameter("tid", id).executeUpdate();
        entityManager.createNativeQuery("DELETE FROM audit_events WHERE tenant_id = :tid")
                .setParameter("tid", id).executeUpdate();

        // 3. User-owned records, then users
        entityManager.createNativeQuery(
                "DELETE FROM password_reset_tokens WHERE user_id IN (SELECT id FROM users WHERE tenant_id = :tid)")
                .setParameter("tid", id).executeUpdate();
        entityManager.createNativeQuery(
                "DELETE FROM workspace_access WHERE user_id IN (SELECT id FROM users WHERE tenant_id = :tid)")
                .setParameter("tid", id).executeUpdate();
        entityManager.createNativeQuery(
                "DELETE FROM workspace_access WHERE workspace_id IN " +
                "(SELECT id FROM workspaces WHERE tenant_id = :tid)")
                .setParameter("tid", id).executeUpdate();
        entityManager.createNativeQuery("DELETE FROM workspaces WHERE tenant_id = :tid")
                .setParameter("tid", id).executeUpdate();

        // 4. Projects and users (cascade from Tenant entity)
        entityManager.createNativeQuery("DELETE FROM projects WHERE tenant_id = :tid")
                .setParameter("tid", id).executeUpdate();
        entityManager.createNativeQuery("DELETE FROM users WHERE tenant_id = :tid")
                .setParameter("tid", id).executeUpdate();

        // 5. Finally delete the tenant
        entityManager.createNativeQuery("DELETE FROM tenants WHERE id = :tid")
                .setParameter("tid", id).executeUpdate();

        log.info("DEV MODE: Deleted organization '{}' ({}) and all related data", name, id);
        return ResponseEntity.ok(Map.of("deleted", name));
    }

    @DeleteMapping("/reset-demo")
    @PreAuthorize("hasRole('PLATFORM_ADMIN')")
    @Transactional
    public ResponseEntity<?> resetDemo() {
        if (!isDevLoginEnabled()) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of(
                    "message", "Reset is only available in devlogin mode"));
        }

        // Find all non-platform tenants
        var tenants = tenantRepository.findAll().stream()
                .filter(t -> t.getTenantType() != TenantType.PLATFORM)
                .toList();

        int orgCount = 0;
        for (var tenant : tenants) {
            UUID tid = tenant.getId();

            // Same cascade as single delete
            entityManager.createNativeQuery("UPDATE tenants SET onboarding_project_id = NULL WHERE id = :tid")
                    .setParameter("tid", tid).executeUpdate();
            entityManager.flush();

            entityManager.createNativeQuery(
                    "DELETE FROM mapping_candidates WHERE field_mapping_id IN " +
                    "(SELECT id FROM field_mapping_entries WHERE project_id IN (SELECT id FROM projects WHERE tenant_id = :tid))")
                    .setParameter("tid", tid).executeUpdate();
            entityManager.createNativeQuery(
                    "DELETE FROM mapping_versions WHERE project_id IN (SELECT id FROM projects WHERE tenant_id = :tid)")
                    .setParameter("tid", tid).executeUpdate();
            entityManager.createNativeQuery(
                    "DELETE FROM field_mapping_entries WHERE project_id IN (SELECT id FROM projects WHERE tenant_id = :tid)")
                    .setParameter("tid", tid).executeUpdate();
            entityManager.createNativeQuery(
                    "DELETE FROM source_schema_nodes WHERE project_id IN (SELECT id FROM projects WHERE tenant_id = :tid)")
                    .setParameter("tid", tid).executeUpdate();
            entityManager.createNativeQuery(
                    "DELETE FROM project_data_uploads WHERE project_id IN (SELECT id FROM projects WHERE tenant_id = :tid)")
                    .setParameter("tid", tid).executeUpdate();
            entityManager.createNativeQuery(
                    "DELETE FROM project_assets WHERE project_id IN (SELECT id FROM projects WHERE tenant_id = :tid)")
                    .setParameter("tid", tid).executeUpdate();
            entityManager.createNativeQuery(
                    "DELETE FROM project_access WHERE project_id IN (SELECT id FROM projects WHERE tenant_id = :tid)")
                    .setParameter("tid", tid).executeUpdate();
            entityManager.createNativeQuery(
                    "DELETE FROM phase_gates WHERE project_id IN (SELECT id FROM projects WHERE tenant_id = :tid)")
                    .setParameter("tid", tid).executeUpdate();
            entityManager.createNativeQuery(
                    "DELETE FROM plan_runs WHERE plan_id IN " +
                    "(SELECT id FROM plans WHERE project_id IN (SELECT id FROM projects WHERE tenant_id = :tid))")
                    .setParameter("tid", tid).executeUpdate();
            entityManager.createNativeQuery(
                    "DELETE FROM plans WHERE project_id IN (SELECT id FROM projects WHERE tenant_id = :tid)")
                    .setParameter("tid", tid).executeUpdate();
            entityManager.createNativeQuery(
                    "DELETE FROM approval_requests WHERE project_id IN (SELECT id FROM projects WHERE tenant_id = :tid)")
                    .setParameter("tid", tid).executeUpdate();

            entityManager.createNativeQuery("DELETE FROM reconciliation_reports WHERE tenant_id = :tid")
                    .setParameter("tid", tid).executeUpdate();
            entityManager.createNativeQuery("DELETE FROM semantic_decisions WHERE tenant_id = :tid")
                    .setParameter("tid", tid).executeUpdate();
            entityManager.createNativeQuery("DELETE FROM migration_blueprints WHERE tenant_id = :tid")
                    .setParameter("tid", tid).executeUpdate();
            entityManager.createNativeQuery("DELETE FROM onboardings WHERE tenant_id = :tid")
                    .setParameter("tid", tid).executeUpdate();
            entityManager.createNativeQuery("DELETE FROM invitations WHERE tenant_id = :tid")
                    .setParameter("tid", tid).executeUpdate();
            entityManager.createNativeQuery("DELETE FROM platform_assignments WHERE tenant_id = :tid")
                    .setParameter("tid", tid).executeUpdate();
            entityManager.createNativeQuery("DELETE FROM notifications WHERE tenant_id = :tid")
                    .setParameter("tid", tid).executeUpdate();
            entityManager.createNativeQuery("DELETE FROM audit_events WHERE tenant_id = :tid")
                    .setParameter("tid", tid).executeUpdate();

            entityManager.createNativeQuery(
                    "DELETE FROM password_reset_tokens WHERE user_id IN (SELECT id FROM users WHERE tenant_id = :tid)")
                    .setParameter("tid", tid).executeUpdate();
            entityManager.createNativeQuery(
                    "DELETE FROM workspace_access WHERE user_id IN (SELECT id FROM users WHERE tenant_id = :tid)")
                    .setParameter("tid", tid).executeUpdate();
            entityManager.createNativeQuery(
                    "DELETE FROM workspace_access WHERE workspace_id IN " +
                    "(SELECT id FROM workspaces WHERE tenant_id = :tid)")
                    .setParameter("tid", tid).executeUpdate();
            entityManager.createNativeQuery("DELETE FROM workspaces WHERE tenant_id = :tid")
                    .setParameter("tid", tid).executeUpdate();

            entityManager.createNativeQuery("DELETE FROM projects WHERE tenant_id = :tid")
                    .setParameter("tid", tid).executeUpdate();
            entityManager.createNativeQuery("DELETE FROM users WHERE tenant_id = :tid")
                    .setParameter("tid", tid).executeUpdate();
            entityManager.createNativeQuery("DELETE FROM tenants WHERE id = :tid")
                    .setParameter("tid", tid).executeUpdate();

            orgCount++;
        }

        log.info("Demo reset: deleted {} organization(s) and all related data", orgCount);
        return ResponseEntity.ok(Map.of("deletedOrganizations", orgCount));
    }

    /** Creates the onboarding project + phase gates + DISCOVER timer for a newly provisioned tenant. */
    private void initOnboardingProject(Tenant tenant, User owner) {
        try {
            Project project = new Project();
            project.setName(tenant.getName() + " Onboarding");
            project.setTenant(tenant);
            project.setOwner(owner);
            project.setMigrationPhase(MigrationPhase.DISCOVER);
            project.setMigrationStatus(MigrationStatus.ACTIVE);
            project.setTargetSystem("GrowthZone");
            project.setReconciliationPct(BigDecimal.ZERO);
            project = projectRepository.save(project);

            for (MigrationPhase phase : MigrationPhase.values()) {
                PhaseGate gate = new PhaseGate();
                gate.setProject(project);
                gate.setPhase(phase);
                gate.setGateStatus(GateStatus.PENDING);
                gate.setApprovalMode(switch (phase) {
                    case DISCOVER -> GateApprovalMode.AUTO;
                    case MAP      -> GateApprovalMode.BOTH;
                    case GENERATE -> GateApprovalMode.COACH_ONLY;
                    case DRY_RUN  -> GateApprovalMode.BOTH;
                    case MIGRATE  -> GateApprovalMode.COACH_ONLY;
                    case CUT_OVER -> GateApprovalMode.COACH_ONLY;
                });
                phaseGateRepository.save(gate);
            }

            PhaseTimeEntry timer = new PhaseTimeEntry();
            timer.setProject(project);
            timer.setPhase(MigrationPhase.DISCOVER);
            timer.setStartedAt(Instant.now());
            phaseTimeEntryRepository.save(timer);

            tenant.setOnboardingProject(project);
            tenantRepository.save(tenant);

            log.info("Auto-created onboarding project for tenant={}: project={}", tenant.getId(), project.getId());
        } catch (Exception e) {
            log.error("Failed to auto-create onboarding project for tenant={}: {}", tenant.getId(), e.getMessage(), e);
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
