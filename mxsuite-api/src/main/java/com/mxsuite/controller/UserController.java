package com.mxsuite.controller;

import com.mxsuite.audit.AuditService;
import com.mxsuite.model.User;
import com.mxsuite.model.enums.UserRole;
import com.mxsuite.repository.TenantRepository;
import com.mxsuite.repository.UserRepository;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.net.URI;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/admin/users")
@PreAuthorize("hasAnyRole('PLATFORM_ADMIN', 'PLATFORM_SUPPORT')")
@Transactional(readOnly = true)
public class UserController {

    private static final Logger log = LoggerFactory.getLogger(UserController.class);

    private final UserRepository userRepository;
    private final TenantRepository tenantRepository;
    private final PasswordEncoder passwordEncoder;
    private final AuditService auditService;

    public UserController(UserRepository userRepository, TenantRepository tenantRepository,
                          PasswordEncoder passwordEncoder, AuditService auditService) {
        this.userRepository = userRepository;
        this.tenantRepository = tenantRepository;
        this.passwordEncoder = passwordEncoder;
        this.auditService = auditService;
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
        return userRepository.findByRoleIn(List.of(UserRole.PLATFORM_ADMIN, UserRole.PLATFORM_SUPPORT))
                .stream().filter(User::isActive).map(this::toResponse).toList();
    }

    @GetMapping
    public Page<UserResponse> list(Pageable pageable, @RequestParam(required = false) UUID tenantId) {
        Page<User> users;
        if (tenantId != null) {
            users = userRepository.findByTenantId(tenantId, pageable);
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
