package com.mxsuite.controller;

import com.mxsuite.audit.AuditService;
import com.mxsuite.model.Project;
import com.mxsuite.repository.ProjectRepository;
import com.mxsuite.repository.TenantRepository;
import com.mxsuite.repository.UserRepository;
import com.mxsuite.security.TenantContext;
import com.mxsuite.security.UserPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
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
@RequestMapping("/api/projects")
@Transactional(readOnly = true)
public class ProjectController {

    private static final Logger log = LoggerFactory.getLogger(ProjectController.class);

    private final ProjectRepository projectRepository;
    private final TenantRepository tenantRepository;
    private final UserRepository userRepository;
    private final AuditService auditService;

    public ProjectController(ProjectRepository projectRepository, TenantRepository tenantRepository,
                             UserRepository userRepository, AuditService auditService) {
        this.projectRepository = projectRepository;
        this.tenantRepository = tenantRepository;
        this.userRepository = userRepository;
        this.auditService = auditService;
    }

    public record CreateProjectRequest(
            @NotBlank @Size(min = 1, max = 200) String name,
            @Size(max = 1000) String description) {}

    public record UpdateProjectRequest(
            @Size(min = 1, max = 200) String name,
            @Size(max = 1000) String description) {}

    @GetMapping
    public Page<Project> list(@RequestParam(required = false) UUID workspaceId,
                              Pageable pageable) {
        if (workspaceId != null) {
            return projectRepository.findByWorkspaceId(workspaceId, pageable);
        }
        UUID tenantId = TenantContext.getCurrentTenantId();
        if (tenantId == null) {
            log.error("No tenant context set for project listing");
            return Page.empty(pageable);
        }
        return projectRepository.findByTenantId(tenantId, pageable);
    }

    @GetMapping("/{id}")
    public ResponseEntity<?> get(@PathVariable UUID id,
                                  @AuthenticationPrincipal UserPrincipal principal) {
        return projectRepository.findByIdWithTenant(id)
                .map(project -> {
                    if (!hasProjectAccess(project, principal)) {
                        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of(
                                "status", 403, "message", "Access denied"));
                    }
                    return ResponseEntity.ok((Object) project);
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping
    @Transactional
    public ResponseEntity<Project> create(@AuthenticationPrincipal UserPrincipal principal,
                                           @Valid @RequestBody CreateProjectRequest request) {
        UUID tenantId = TenantContext.getCurrentTenantId();
        var tenant = tenantRepository.findById(tenantId).orElseThrow();
        var owner = userRepository.findById(principal.id()).orElseThrow();

        Project project = new Project();
        project.setName(request.name().trim());
        project.setDescription(request.description() != null ? request.description().trim() : null);
        project.setTenant(tenant);
        project.setOwner(owner);
        project = projectRepository.save(project);

        auditService.log("CREATE", "Project", project.getId(), project.getName());
        log.info("Created project: name='{}' tenant={}", project.getName(), tenant.getSlug());

        return ResponseEntity
                .created(URI.create("/api/projects/" + project.getId()))
                .body(project);
    }

    @PutMapping("/{id}")
    @Transactional
    public ResponseEntity<?> update(@PathVariable UUID id,
                                     @AuthenticationPrincipal UserPrincipal principal,
                                     @Valid @RequestBody UpdateProjectRequest request) {
        return projectRepository.findByIdWithTenant(id)
                .map(project -> {
                    if (!hasProjectAccess(project, principal)) {
                        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of(
                                "status", 403, "message", "Access denied"));
                    }
                    if (request.name() != null) project.setName(request.name().trim());
                    if (request.description() != null) project.setDescription(request.description().trim());
                    project = projectRepository.save(project);
                    auditService.log("UPDATE", "Project", project.getId(), project.getName());
                    return ResponseEntity.ok((Object) project);
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @DeleteMapping("/{id}")
    @Transactional
    public ResponseEntity<?> delete(@PathVariable UUID id,
                                     @AuthenticationPrincipal UserPrincipal principal) {
        return projectRepository.findByIdWithTenant(id)
                .map(project -> {
                    if (!hasProjectAccess(project, principal)) {
                        return ResponseEntity.status(HttpStatus.FORBIDDEN).<Void>body(null);
                    }
                    auditService.log("DELETE", "Project", project.getId(), project.getName());
                    projectRepository.delete(project);
                    log.info("Deleted project: id={} name='{}'", id, project.getName());
                    return ResponseEntity.noContent().<Void>build();
                })
                .orElse(ResponseEntity.notFound().build());
    }

    private boolean hasProjectAccess(Project project, UserPrincipal principal) {
        if (principal.isPlatformUser()) return true;
        UUID tenantId = TenantContext.getCurrentTenantId();
        return project.getTenant().getId().equals(tenantId);
    }
}
