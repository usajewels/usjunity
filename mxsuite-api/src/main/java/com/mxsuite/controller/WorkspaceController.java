package com.mxsuite.controller;

import com.mxsuite.audit.AuditService;
import com.mxsuite.model.Project;
import com.mxsuite.model.Workspace;
import com.mxsuite.model.WorkspaceAccess;
import com.mxsuite.model.enums.AccessLevel;
import com.mxsuite.repository.ProjectRepository;
import com.mxsuite.repository.UserRepository;
import com.mxsuite.repository.WorkspaceRepository;
import com.mxsuite.security.TenantContext;
import com.mxsuite.security.UserPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.net.URI;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/workspaces")
@Transactional(readOnly = true)
public class WorkspaceController {

    private static final Logger log = LoggerFactory.getLogger(WorkspaceController.class);

    private final WorkspaceRepository workspaceRepository;
    private final ProjectRepository projectRepository;
    private final UserRepository userRepository;
    private final AuditService auditService;

    public WorkspaceController(WorkspaceRepository workspaceRepository,
                               ProjectRepository projectRepository,
                               UserRepository userRepository, AuditService auditService) {
        this.workspaceRepository = workspaceRepository;
        this.projectRepository = projectRepository;
        this.userRepository = userRepository;
        this.auditService = auditService;
    }

    public record CreateWorkspaceRequest(
            @NotBlank @Size(min = 1, max = 200) String name,
            @Size(max = 1000) String description) {}

    public record UpdateWorkspaceRequest(
            @Size(min = 1, max = 200) String name,
            @Size(max = 1000) String description) {}

    public record ShareWorkspaceRequest(
            @NotNull UUID userId,
            @NotNull AccessLevel accessLevel) {}

    @GetMapping
    public Page<Workspace> list(@AuthenticationPrincipal UserPrincipal principal, Pageable pageable) {
        if (principal.isPlatformUser()) {
            UUID tenantId = TenantContext.getCurrentTenantId();
            if (tenantId != null && !tenantId.equals(principal.tenantId())) {
                return workspaceRepository.findByTenantId(tenantId, pageable);
            }
            return workspaceRepository.findByOwnerId(principal.id(), pageable);
        }
        return workspaceRepository.findAccessibleByUser(principal.id(), pageable);
    }

    @GetMapping("/{id}")
    public ResponseEntity<?> get(@PathVariable UUID id,
                                  @AuthenticationPrincipal UserPrincipal principal) {
        var workspace = workspaceRepository.findByIdWithOwner(id).orElse(null);
        if (workspace == null) return ResponseEntity.notFound().build();
        if (!hasAccess(workspace, principal)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
        return ResponseEntity.ok(workspace);
    }

    @GetMapping("/{id}/projects")
    public ResponseEntity<Page<Project>> listProjects(@PathVariable UUID id,
                                                       @AuthenticationPrincipal UserPrincipal principal,
                                                       Pageable pageable) {
        var workspace = workspaceRepository.findByIdWithOwner(id).orElse(null);
        if (workspace == null) return ResponseEntity.notFound().build();
        if (!hasAccess(workspace, principal)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
        return ResponseEntity.ok(projectRepository.findByWorkspaceId(id, pageable));
    }

    @PostMapping
    @Transactional
    public ResponseEntity<Workspace> create(@AuthenticationPrincipal UserPrincipal principal,
                                             @Valid @RequestBody CreateWorkspaceRequest request) {
        var owner = userRepository.findByIdWithTenant(principal.id()).orElseThrow();
        Workspace workspace = new Workspace();
        workspace.setName(request.name().trim());
        workspace.setDescription(request.description() != null ? request.description().trim() : null);
        workspace.setOwner(owner);
        workspace.setTenant(owner.getTenant());
        workspace.setCrossTenant(principal.isPlatformUser());
        workspace = workspaceRepository.save(workspace);

        auditService.log("CREATE", "Workspace", workspace.getId(), workspace.getName());
        log.info("Created workspace: name='{}' owner={}", workspace.getName(), principal.email());

        return ResponseEntity
                .created(URI.create("/api/workspaces/" + workspace.getId()))
                .body(workspace);
    }

    @PutMapping("/{id}")
    @Transactional
    public ResponseEntity<?> update(@PathVariable UUID id,
                                     @AuthenticationPrincipal UserPrincipal principal,
                                     @Valid @RequestBody UpdateWorkspaceRequest request) {
        var workspace = workspaceRepository.findByIdWithOwner(id).orElse(null);
        if (workspace == null) return ResponseEntity.notFound().build();

        if (!workspace.getOwner().getId().equals(principal.id()) && !principal.isPlatformUser()) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of(
                    "status", 403, "message", "Only the workspace owner can update it"));
        }

        if (request.name() != null) workspace.setName(request.name().trim());
        if (request.description() != null) workspace.setDescription(request.description().trim());
        workspace = workspaceRepository.save(workspace);

        auditService.log("UPDATE", "Workspace", workspace.getId(), workspace.getName());
        log.info("Updated workspace: id={} name='{}' by={}", id, workspace.getName(), principal.email());

        return ResponseEntity.ok(workspace);
    }

    @DeleteMapping("/{id}")
    @Transactional
    public ResponseEntity<?> delete(@PathVariable UUID id,
                                     @AuthenticationPrincipal UserPrincipal principal) {
        var workspace = workspaceRepository.findByIdWithOwner(id).orElse(null);
        if (workspace == null) return ResponseEntity.notFound().build();

        if (!workspace.getOwner().getId().equals(principal.id()) && !principal.isPlatformUser()) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of(
                    "status", 403, "message", "Only the workspace owner can delete it"));
        }

        long projectCount = projectRepository.countByWorkspaceId(id);
        if (projectCount > 0) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of(
                    "status", 409,
                    "message", "Cannot delete workspace with " + projectCount + " project(s). Remove projects first."));
        }

        workspaceRepository.delete(workspace);
        auditService.log("DELETE", "Workspace", id, workspace.getName());
        log.info("Deleted workspace: id={} name='{}' by={}", id, workspace.getName(), principal.email());

        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/share")
    @Transactional
    public ResponseEntity<?> share(@PathVariable UUID id,
                                    @AuthenticationPrincipal UserPrincipal principal,
                                    @Valid @RequestBody ShareWorkspaceRequest request) {
        var workspace = workspaceRepository.findByIdWithOwner(id).orElse(null);
        if (workspace == null) return ResponseEntity.notFound().build();

        // Only owner or platform user can share
        if (!workspace.getOwner().getId().equals(principal.id()) && !principal.isPlatformUser()) {
            log.warn("Unauthorized share attempt on workspace {} by user {}", id, principal.email());
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of(
                    "status", 403,
                    "message", "Only the workspace owner can share it"
            ));
        }

        var user = userRepository.findById(request.userId()).orElse(null);
        if (user == null) {
            return ResponseEntity.badRequest().body(Map.of(
                    "status", 400,
                    "message", "User not found"
            ));
        }

        WorkspaceAccess access = new WorkspaceAccess();
        access.setWorkspace(workspace);
        access.setUser(user);
        access.setAccessLevel(request.accessLevel());
        workspace.getAccessList().add(access);
        workspaceRepository.save(workspace);

        auditService.log("SHARE", "Workspace", workspace.getId(), workspace.getName());
        log.info("Shared workspace '{}' with user {} at level {}", workspace.getName(),
                user.getEmail(), request.accessLevel());

        return ResponseEntity.ok(Map.of("message", "Workspace shared successfully"));
    }

    private boolean hasAccess(Workspace workspace, UserPrincipal principal) {
        if (principal.isPlatformUser()) return true;
        return workspace.getOwner().getId().equals(principal.id());
    }
}
