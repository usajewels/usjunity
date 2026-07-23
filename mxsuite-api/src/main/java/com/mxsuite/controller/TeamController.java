package com.mxsuite.controller;

import com.mxsuite.audit.AuditService;
import com.mxsuite.model.User;
import com.mxsuite.model.enums.UserRole;
import com.mxsuite.repository.UserRepository;
import com.mxsuite.security.TenantContext;
import com.mxsuite.security.UserPrincipal;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;

/**
 * Tenant-scoped user management for TENANT_ADMIN users.
 * Allows member admins to view their org's users and toggle active status.
 */
@RestController
@RequestMapping("/api/team")
@PreAuthorize("hasRole('TENANT_ADMIN')")
@Transactional(readOnly = true)
public class TeamController {

    private static final Logger log = LoggerFactory.getLogger(TeamController.class);

    private final UserRepository userRepository;
    private final AuditService auditService;

    public TeamController(UserRepository userRepository, AuditService auditService) {
        this.userRepository = userRepository;
        this.auditService = auditService;
    }

    public record TeamMemberResponse(String id, String email, String firstName, String lastName,
                                      String role, boolean active, String avatarUrl) {}

    @GetMapping
    public Page<TeamMemberResponse> list(@AuthenticationPrincipal UserPrincipal principal,
                                          Pageable pageable) {
        UUID tenantId = TenantContext.getCurrentTenantId();
        return userRepository.findByTenantId(tenantId, pageable).map(this::toResponse);
    }

    @PutMapping("/{id}/active")
    @Transactional
    public ResponseEntity<?> toggleActive(@PathVariable UUID id,
                                           @AuthenticationPrincipal UserPrincipal principal,
                                           @RequestBody Map<String, Boolean> body) {
        UUID tenantId = TenantContext.getCurrentTenantId();
        var userOpt = userRepository.findById(id);
        if (userOpt.isEmpty()) return ResponseEntity.notFound().build();

        User user = userOpt.get();

        // Ensure the user belongs to the same tenant
        if (!user.getTenant().getId().equals(tenantId)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of(
                    "status", 403, "message", "Cannot modify users from other organizations"));
        }

        // Prevent deactivating yourself
        if (user.getId().equals(principal.id())) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of(
                    "status", 409, "message", "Cannot deactivate your own account"));
        }

        // Prevent tenant admins from modifying platform users
        if (user.getRole() == UserRole.PLATFORM_ADMIN || user.getRole() == UserRole.COACH_ADMIN
                || user.getRole() == UserRole.PLATFORM_SUPPORT) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of(
                    "status", 403, "message", "Cannot modify platform users"));
        }

        Boolean active = body.get("active");
        if (active == null) {
            return ResponseEntity.badRequest().body(Map.of(
                    "status", 400, "message", "Missing 'active' field"));
        }

        user.setActive(active);
        userRepository.save(user);

        auditService.log(active ? "ACTIVATE" : "DEACTIVATE", "User", user.getId(), user.getFullName());
        log.info("Team member {} {} by tenant admin {}", user.getEmail(),
                active ? "activated" : "deactivated", principal.email());

        return ResponseEntity.ok(toResponse(user));
    }

    @DeleteMapping("/{id}")
    @Transactional
    public ResponseEntity<?> remove(@PathVariable UUID id,
                                     @AuthenticationPrincipal UserPrincipal principal) {
        UUID tenantId = TenantContext.getCurrentTenantId();
        var userOpt = userRepository.findById(id);
        if (userOpt.isEmpty()) return ResponseEntity.notFound().build();

        User user = userOpt.get();

        if (!user.getTenant().getId().equals(tenantId)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of(
                    "status", 403, "message", "Cannot remove users from other organizations"));
        }

        if (user.getId().equals(principal.id())) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of(
                    "status", 409, "message", "Cannot remove your own account"));
        }

        if (user.getRole() == UserRole.PLATFORM_ADMIN || user.getRole() == UserRole.PLATFORM_SUPPORT) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of(
                    "status", 403, "message", "Cannot remove platform users"));
        }

        auditService.log("DELETE", "User", user.getId(), user.getFullName());
        log.info("Team member {} removed by tenant admin {}", user.getEmail(), principal.email());
        userRepository.delete(user);

        return ResponseEntity.ok(Map.of("message", "User removed"));
    }

    private TeamMemberResponse toResponse(User user) {
        return new TeamMemberResponse(
                user.getId().toString(),
                user.getEmail(),
                user.getFirstName(),
                user.getLastName(),
                user.getRole().name(),
                user.isActive(),
                user.getAvatarUrl()
        );
    }
}
