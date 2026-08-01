package com.mxsuite.controller;

import com.mxsuite.audit.AuditService;
import com.mxsuite.model.User;
import com.mxsuite.model.Tenant;
import com.mxsuite.model.enums.TenantType;
import com.mxsuite.model.enums.UserRole;
import com.mxsuite.repository.PlatformAssignmentRepository;
import com.mxsuite.repository.TenantRepository;
import com.mxsuite.repository.UserRepository;
import com.mxsuite.security.UserPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.env.Environment;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import jakarta.persistence.EntityManager;

import java.net.URI;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Stream;

import org.springframework.security.core.annotation.AuthenticationPrincipal;

@RestController
@RequestMapping("/api/admin/users")
@PreAuthorize("hasAnyRole('PLATFORM_ADMIN', 'COACH_ADMIN', 'PLATFORM_SUPPORT')")
@Transactional(readOnly = true)
public class UserController {

    private static final Logger log = LoggerFactory.getLogger(UserController.class);

    private final UserRepository userRepository;
    private final TenantRepository tenantRepository;
    private final PlatformAssignmentRepository assignmentRepository;
    private final PasswordEncoder passwordEncoder;
    private final AuditService auditService;
    private final Environment environment;
    private final EntityManager entityManager;

    public UserController(UserRepository userRepository, TenantRepository tenantRepository,
                          PlatformAssignmentRepository assignmentRepository,
                          PasswordEncoder passwordEncoder, AuditService auditService,
                          Environment environment, EntityManager entityManager) {
        this.userRepository = userRepository;
        this.tenantRepository = tenantRepository;
        this.assignmentRepository = assignmentRepository;
        this.passwordEncoder = passwordEncoder;
        this.auditService = auditService;
        this.environment = environment;
        this.entityManager = entityManager;
    }

    public record CreateUserRequest(
        @NotBlank @Email @Size(max = 255) String email,
        @NotBlank @Size(min = 1, max = 100) String firstName,
        @NotBlank @Size(min = 1, max = 100) String lastName,
        @NotBlank @Size(min = 8, max = 128) String password,
        @NotNull UserRole role,
        @NotNull UUID tenantId
    ) {}

    public record UpdateUserRequest(
            @Size(min = 1, max = 100) String firstName,
            @Size(min = 1, max = 100) String lastName,
            UserRole role,
            Boolean active) {}

    public record UserResponse(String id, String email, String firstName, String lastName,
                                String role, String tenantId, boolean active, String avatarUrl) {}

    @GetMapping("/coaches")
    public List<UserResponse> listCoaches() {
        return userRepository.findByRoleIn(List.of(UserRole.PLATFORM_SUPPORT, UserRole.COACH_ADMIN))
                .stream().filter(User::isActive).map(this::toResponse).toList();
    }

    @GetMapping
    public Page<UserResponse> list(@AuthenticationPrincipal UserPrincipal principal,
                                    Pageable pageable,
                                    @RequestParam(required = false) UUID tenantId,
                                    @RequestParam(required = false) String search,
                                    @RequestParam(required = false) String letter,
                                    @RequestParam(required = false) UserRole role) {
        Page<User> users;
        boolean hasSearch = search != null && !search.isBlank();
        boolean hasLetter = letter != null && !letter.isBlank();

        // Coach-scoped: COACH_ADMIN and PLATFORM_SUPPORT only see users from assigned orgs
        if (principal.role() == UserRole.COACH_ADMIN || principal.role() == UserRole.PLATFORM_SUPPORT) {
            List<UUID> visibleIds = visibleTenantIds(principal);
            if (visibleIds.isEmpty()) return Page.<User>empty(pageable).map(this::toResponse);

            // If a specific tenantId is requested, verify the coach has access
            List<UUID> scopeIds = (tenantId != null && visibleIds.contains(tenantId))
                    ? List.of(tenantId) : (tenantId != null ? List.of() : visibleIds);
            if (scopeIds.isEmpty()) return Page.<User>empty(pageable).map(this::toResponse);

            if (role != null) {
                if (hasSearch) {
                    users = userRepository.findByTenantIdInAndRoleAndNotPlatformAdminAndSearch(scopeIds, role, search.trim(), pageable);
                } else if (hasLetter) {
                    users = userRepository.findByTenantIdInAndRoleAndNotPlatformAdminAndLetter(scopeIds, role, letter.trim(), pageable);
                } else {
                    users = userRepository.findByTenantIdInAndRoleAndNotPlatformAdmin(scopeIds, role, pageable);
                }
            } else if (hasSearch) {
                users = userRepository.findByTenantIdInAndNotPlatformAdminAndSearch(scopeIds, search.trim(), pageable);
            } else if (hasLetter) {
                users = userRepository.findByTenantIdInAndNotPlatformAdminAndLetter(scopeIds, letter.trim(), pageable);
            } else {
                users = userRepository.findByTenantIdInAndNotPlatformAdmin(scopeIds, pageable);
            }
            return users.map(this::toResponse);
        }

        // Platform admin: unrestricted access
        if (role != null) {
            if (hasSearch) {
                users = userRepository.findByRoleAndSearch(role, search.trim(), pageable);
            } else if (hasLetter) {
                users = userRepository.findByRoleAndLastNameStartingWithIgnoreCase(role, letter.trim(), pageable);
            } else if (tenantId != null) {
                users = userRepository.findByTenantIdAndRole(tenantId, role, pageable);
            } else {
                users = userRepository.findByRole(role, pageable);
            }
        } else if (tenantId != null && hasSearch) {
            users = userRepository.findByTenantIdAndSearch(tenantId, search.trim(), pageable);
        } else if (tenantId != null && hasLetter) {
            users = userRepository.findByTenantIdAndLastNameStartingWithIgnoreCase(tenantId, letter.trim(), pageable);
        } else if (tenantId != null) {
            users = userRepository.findByTenantId(tenantId, pageable);
        } else if (hasSearch) {
            users = userRepository.findBySearch(search.trim(), pageable);
        } else if (hasLetter) {
            users = userRepository.findByLastNameStartingWithIgnoreCase(letter.trim(), pageable);
        } else {
            users = userRepository.findAll(pageable);
        }
        return users.map(this::toResponse);
    }

    @GetMapping("/{id}")
    public ResponseEntity<UserResponse> get(@PathVariable UUID id) {
        return userRepository.findById(id)
                .map(u -> ResponseEntity.ok(toResponse(u)))
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping
    @PreAuthorize("hasRole('PLATFORM_ADMIN')")
    @Transactional
    public ResponseEntity<?> create(@Valid @RequestBody CreateUserRequest request) {
        if (userRepository.existsByEmail(request.email().toLowerCase().trim())) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of(
                    "status", 409,
                    "message", "A user with this email already exists"
            ));
        }

        var tenant = tenantRepository.findById(request.tenantId());
        if (tenant.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "status", 400,
                    "message", "Tenant not found"
            ));
        }

        // Coaches and coach admins must belong to the platform tenant
        boolean isPlatformRole = request.role() == UserRole.PLATFORM_ADMIN
                || request.role() == UserRole.COACH_ADMIN
                || request.role() == UserRole.PLATFORM_SUPPORT;
        if (isPlatformRole && tenant.get().getTenantType() != TenantType.PLATFORM) {
            return ResponseEntity.badRequest().body(Map.of(
                    "status", 400,
                    "message", "Platform roles (Admin, Coach Admin, Coach) can only be created in the platform organization"
            ));
        }

        User user = new User();
        user.setEmail(request.email().toLowerCase().trim());
        user.setFirstName(request.firstName().trim());
        user.setLastName(request.lastName().trim());
        user.setPasswordHash(passwordEncoder.encode(request.password()));
        user.setRole(request.role());
        user.setTenant(tenant.get());
        user.setActive(true);
        user = userRepository.save(user);

        auditService.log("CREATE", "User", user.getId(), user.getFullName());
        log.info("Created user: email={} role={} tenant={}", user.getEmail(), user.getRole(), tenant.get().getSlug());

        return ResponseEntity
                .created(URI.create("/api/admin/users/" + user.getId()))
                .body(toResponse(user));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasRole('PLATFORM_ADMIN')")
    @Transactional
    public ResponseEntity<UserResponse> update(@PathVariable UUID id,
                                                @Valid @RequestBody UpdateUserRequest request) {
        return userRepository.findById(id)
                .map(user -> {
                    if (request.firstName() != null) user.setFirstName(request.firstName().trim());
                    if (request.lastName() != null) user.setLastName(request.lastName().trim());
                    if (request.role() != null) user.setRole(request.role());
                    if (request.active() != null) {
                        user.setActive(request.active());
                        log.info("User {} {} by platform admin", user.getEmail(),
                                request.active() ? "activated" : "deactivated");
                    }
                    user = userRepository.save(user);
                    auditService.log("UPDATE", "User", user.getId(), user.getFullName());
                    return ResponseEntity.ok(toResponse(user));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('PLATFORM_ADMIN')")
    @Transactional
    public ResponseEntity<?> delete(@PathVariable UUID id) {
        var user = userRepository.findById(id).orElse(null);
        if (user == null) return ResponseEntity.notFound().build();

        String email = user.getEmail();

        // Nullify nullable FK references to this user
        entityManager.createNativeQuery("UPDATE invitations SET invited_by = NULL WHERE invited_by = :uid")
                .setParameter("uid", id).executeUpdate();
        entityManager.createNativeQuery("UPDATE onboardings SET assigned_to = NULL WHERE assigned_to = :uid")
                .setParameter("uid", id).executeUpdate();
        entityManager.createNativeQuery("UPDATE project_assets SET uploaded_by = NULL WHERE uploaded_by = :uid")
                .setParameter("uid", id).executeUpdate();
        entityManager.createNativeQuery("UPDATE plan_runs SET triggered_by = NULL WHERE triggered_by = :uid")
                .setParameter("uid", id).executeUpdate();

        // Clear tenant onboarding_project FK before deleting projects
        entityManager.createNativeQuery(
                "UPDATE tenants SET onboarding_project_id = NULL WHERE onboarding_project_id IN (SELECT id FROM projects WHERE owner_id = :uid)")
                .setParameter("uid", id).executeUpdate();
        entityManager.flush();

        // Cascade-delete projects owned by this user (owner_id is NOT NULL)
        entityManager.createNativeQuery(
                "DELETE FROM mapping_candidates WHERE field_mapping_id IN " +
                "(SELECT id FROM field_mapping_entries WHERE project_id IN (SELECT id FROM projects WHERE owner_id = :uid))")
                .setParameter("uid", id).executeUpdate();
        entityManager.createNativeQuery(
                "DELETE FROM mapping_versions WHERE project_id IN (SELECT id FROM projects WHERE owner_id = :uid)")
                .setParameter("uid", id).executeUpdate();
        entityManager.createNativeQuery(
                "DELETE FROM field_mapping_entries WHERE project_id IN (SELECT id FROM projects WHERE owner_id = :uid)")
                .setParameter("uid", id).executeUpdate();
        entityManager.createNativeQuery(
                "DELETE FROM source_schema_nodes WHERE project_id IN (SELECT id FROM projects WHERE owner_id = :uid)")
                .setParameter("uid", id).executeUpdate();
        entityManager.createNativeQuery(
                "DELETE FROM project_data_uploads WHERE project_id IN (SELECT id FROM projects WHERE owner_id = :uid)")
                .setParameter("uid", id).executeUpdate();
        entityManager.createNativeQuery(
                "DELETE FROM project_assets WHERE project_id IN (SELECT id FROM projects WHERE owner_id = :uid)")
                .setParameter("uid", id).executeUpdate();
        entityManager.createNativeQuery(
                "DELETE FROM project_access WHERE project_id IN (SELECT id FROM projects WHERE owner_id = :uid)")
                .setParameter("uid", id).executeUpdate();
        entityManager.createNativeQuery(
                "DELETE FROM phase_gates WHERE project_id IN (SELECT id FROM projects WHERE owner_id = :uid)")
                .setParameter("uid", id).executeUpdate();
        entityManager.createNativeQuery(
                "DELETE FROM plan_runs WHERE plan_id IN " +
                "(SELECT id FROM plans WHERE project_id IN (SELECT id FROM projects WHERE owner_id = :uid))")
                .setParameter("uid", id).executeUpdate();
        entityManager.createNativeQuery(
                "DELETE FROM plans WHERE project_id IN (SELECT id FROM projects WHERE owner_id = :uid)")
                .setParameter("uid", id).executeUpdate();
        entityManager.createNativeQuery(
                "DELETE FROM approval_requests WHERE project_id IN (SELECT id FROM projects WHERE owner_id = :uid)")
                .setParameter("uid", id).executeUpdate();
        entityManager.createNativeQuery("DELETE FROM projects WHERE owner_id = :uid")
                .setParameter("uid", id).executeUpdate();

        // Delete other owned records
        entityManager.createNativeQuery("DELETE FROM password_reset_tokens WHERE user_id = :uid")
                .setParameter("uid", id).executeUpdate();
        entityManager.createNativeQuery("DELETE FROM platform_assignments WHERE user_id = :uid")
                .setParameter("uid", id).executeUpdate();
        entityManager.createNativeQuery("DELETE FROM workspace_access WHERE user_id = :uid")
                .setParameter("uid", id).executeUpdate();
        entityManager.createNativeQuery("DELETE FROM project_access WHERE user_id = :uid")
                .setParameter("uid", id).executeUpdate();
        // Workspaces owned by this user — delete access first, then workspace
        entityManager.createNativeQuery(
                "DELETE FROM workspace_access WHERE workspace_id IN (SELECT id FROM workspaces WHERE owner_id = :uid)")
                .setParameter("uid", id).executeUpdate();
        entityManager.createNativeQuery("DELETE FROM workspaces WHERE owner_id = :uid")
                .setParameter("uid", id).executeUpdate();

        userRepository.delete(user);

        log.info("DEV MODE: Deleted user {} ({})", email, id);
        return ResponseEntity.ok(Map.of("deleted", email));
    }

    private List<UUID> visibleTenantIds(UserPrincipal principal) {
        List<UUID> assigned = assignmentRepository.findByPlatformUserIdAndActiveTrue(principal.id())
                .stream().map(a -> a.getTenant().getId()).toList();
        List<UUID> openToAll = tenantRepository.findByOpenToAllCoachesTrue()
                .stream().map(Tenant::getId).toList();
        return Stream.concat(assigned.stream(), openToAll.stream()).distinct().toList();
    }

    private boolean isDevLoginEnabled() {
        for (String profile : environment.getActiveProfiles()) {
            if ("devlogin".equals(profile)) return true;
        }
        return false;
    }

    private UserResponse toResponse(User user) {
        return new UserResponse(
                user.getId().toString(),
                user.getEmail(),
                user.getFirstName(),
                user.getLastName(),
                user.getRole().name(),
                user.getTenant().getId().toString(),
                user.isActive(),
                user.getAvatarUrl()
        );
    }
}
