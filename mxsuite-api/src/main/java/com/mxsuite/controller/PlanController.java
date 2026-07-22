package com.mxsuite.controller;

import com.mxsuite.audit.AuditService;
import com.mxsuite.model.Plan;
import com.mxsuite.model.PlanRun;
import com.mxsuite.model.enums.PlanStatus;
import com.mxsuite.model.enums.RunStatus;
import com.mxsuite.model.enums.RunType;
import com.mxsuite.repository.PlanRepository;
import com.mxsuite.repository.PlanRunRepository;
import com.mxsuite.repository.ProjectRepository;
import com.mxsuite.repository.UserRepository;
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
@RequestMapping("/api/projects/{projectId}/plans")
@Transactional(readOnly = true)
public class PlanController {

    private static final Logger log = LoggerFactory.getLogger(PlanController.class);

    private final PlanRepository planRepository;
    private final PlanRunRepository runRepository;
    private final ProjectRepository projectRepository;
    private final UserRepository userRepository;
    private final AuditService auditService;

    public PlanController(PlanRepository planRepository, PlanRunRepository runRepository,
                          ProjectRepository projectRepository, UserRepository userRepository,
                          AuditService auditService) {
        this.planRepository = planRepository;
        this.runRepository = runRepository;
        this.projectRepository = projectRepository;
        this.userRepository = userRepository;
        this.auditService = auditService;
    }

    public record CreatePlanRequest(
            @NotBlank @Size(min = 1, max = 200) String name,
            @Size(max = 1000) String description) {}

    public record UpdateDefinitionRequest(@NotNull Map<String, Object> definition) {}
    public record ExecutePlanRequest(@NotNull RunType runType) {}

    @GetMapping
    public ResponseEntity<Page<Plan>> list(@PathVariable UUID projectId,
                                            @AuthenticationPrincipal UserPrincipal principal,
                                            Pageable pageable) {
        var project = projectRepository.findByIdWithTenant(projectId).orElse(null);
        if (project == null) return ResponseEntity.notFound().build();
        if (!hasAccess(project.getTenant().getId(), principal)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
        return ResponseEntity.ok(planRepository.findByProjectId(projectId, pageable));
    }

    @GetMapping("/{planId}")
    public ResponseEntity<?> get(@PathVariable UUID projectId, @PathVariable UUID planId,
                                  @AuthenticationPrincipal UserPrincipal principal) {
        return planRepository.findByIdWithProjectAndTenant(planId)
                .map(plan -> {
                    if (!plan.getProject().getId().equals(projectId)) {
                        return ResponseEntity.notFound().build();
                    }
                    if (!hasAccess(plan.getProject().getTenant().getId(), principal)) {
                        return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
                    }
                    return ResponseEntity.ok((Object) plan);
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping
    @Transactional
    public ResponseEntity<?> create(@PathVariable UUID projectId,
                                     @AuthenticationPrincipal UserPrincipal principal,
                                     @Valid @RequestBody CreatePlanRequest request) {
        var project = projectRepository.findByIdWithTenant(projectId).orElse(null);
        if (project == null) return ResponseEntity.notFound().build();
        if (!hasAccess(project.getTenant().getId(), principal)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }

        Plan plan = new Plan();
        plan.setName(request.name().trim());
        plan.setDescription(request.description() != null ? request.description().trim() : null);
        plan.setProject(project);
        plan.setStatus(PlanStatus.DRAFT);
        plan.setVersion(1);
        plan = planRepository.save(plan);

        auditService.log("CREATE", "Plan", plan.getId(), plan.getName());
        log.info("Created plan: name='{}' project={}", plan.getName(), projectId);

        return ResponseEntity
                .created(URI.create("/api/projects/" + projectId + "/plans/" + plan.getId()))
                .body(plan);
    }

    @PutMapping("/{planId}/definition")
    @Transactional
    public ResponseEntity<?> updateDefinition(@PathVariable UUID projectId,
                                               @PathVariable UUID planId,
                                               @AuthenticationPrincipal UserPrincipal principal,
                                               @Valid @RequestBody UpdateDefinitionRequest request) {
        return planRepository.findByIdWithProjectAndTenant(planId)
                .map(plan -> {
                    if (!plan.getProject().getId().equals(projectId)) {
                        return ResponseEntity.notFound().build();
                    }
                    if (!hasAccess(plan.getProject().getTenant().getId(), principal)) {
                        return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
                    }
                    if (plan.getStatus() != PlanStatus.DRAFT) {
                        return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of(
                                "status", 409,
                                "message", "Only DRAFT plans can be modified"
                        ));
                    }
                    plan.setDefinition(request.definition());
                    plan.setVersion(plan.getVersion() + 1);
                    plan = planRepository.save(plan);
                    auditService.log("UPDATE_DEFINITION", "Plan", plan.getId(), plan.getName());
                    return ResponseEntity.ok((Object) plan);
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping("/{planId}/publish")
    @Transactional
    public ResponseEntity<?> publish(@PathVariable UUID projectId, @PathVariable UUID planId,
                                      @AuthenticationPrincipal UserPrincipal principal) {
        return planRepository.findByIdWithProjectAndTenant(planId)
                .map(plan -> {
                    if (!plan.getProject().getId().equals(projectId)) {
                        return ResponseEntity.notFound().build();
                    }
                    if (!hasAccess(plan.getProject().getTenant().getId(), principal)) {
                        return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
                    }
                    if (plan.getStatus() != PlanStatus.DRAFT) {
                        return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of(
                                "status", 409,
                                "message", "Only DRAFT plans can be published"
                        ));
                    }
                    plan.setStatus(PlanStatus.PUBLISHED);
                    plan = planRepository.save(plan);
                    auditService.log("PUBLISH", "Plan", plan.getId(), plan.getName());
                    log.info("Published plan: id={} name='{}'", planId, plan.getName());
                    return ResponseEntity.ok((Object) plan);
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping("/{planId}/archive")
    @Transactional
    public ResponseEntity<?> archive(@PathVariable UUID projectId, @PathVariable UUID planId,
                                      @AuthenticationPrincipal UserPrincipal principal) {
        return planRepository.findByIdWithProjectAndTenant(planId)
                .map(plan -> {
                    if (!plan.getProject().getId().equals(projectId)) {
                        return ResponseEntity.notFound().build();
                    }
                    if (!hasAccess(plan.getProject().getTenant().getId(), principal)) {
                        return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
                    }
                    if (plan.getStatus() == PlanStatus.ARCHIVED) {
                        return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of(
                                "status", 409,
                                "message", "Plan is already archived"
                        ));
                    }
                    plan.setStatus(PlanStatus.ARCHIVED);
                    plan = planRepository.save(plan);
                    auditService.log("ARCHIVE", "Plan", plan.getId(), plan.getName());
                    return ResponseEntity.ok((Object) plan);
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping("/{planId}/execute")
    @Transactional
    public ResponseEntity<?> execute(@PathVariable UUID projectId,
                                      @PathVariable UUID planId,
                                      @AuthenticationPrincipal UserPrincipal principal,
                                      @Valid @RequestBody ExecutePlanRequest request) {
        var plan = planRepository.findByIdWithProjectAndTenant(planId).orElse(null);
        if (plan == null) return ResponseEntity.notFound().build();

        if (!plan.getProject().getId().equals(projectId)) {
            return ResponseEntity.notFound().build();
        }
        if (!hasAccess(plan.getProject().getTenant().getId(), principal)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
        if (plan.getStatus() != PlanStatus.PUBLISHED) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of(
                    "status", 409,
                    "message", "Only PUBLISHED plans can be executed"
            ));
        }

        var user = userRepository.findById(principal.id()).orElseThrow();

        PlanRun run = new PlanRun();
        run.setPlan(plan);
        run.setRunType(request.runType());
        run.setStatus(RunStatus.QUEUED);
        run.setTriggeredBy(user);
        run.setPlanVersion(plan.getVersion());
        run = runRepository.save(run);

        auditService.log("EXECUTE_" + request.runType(), "PlanRun", run.getId(), plan.getName());
        log.info("Queued {} run for plan '{}' (v{}) by user {}", request.runType(),
                plan.getName(), plan.getVersion(), principal.email());

        return ResponseEntity.accepted().body(run);
    }

    @GetMapping("/{planId}/runs")
    public ResponseEntity<Page<PlanRun>> listRuns(@PathVariable UUID projectId,
                                                   @PathVariable UUID planId,
                                                   @AuthenticationPrincipal UserPrincipal principal,
                                                   Pageable pageable) {
        var plan = planRepository.findByIdWithProjectAndTenant(planId).orElse(null);
        if (plan == null || !plan.getProject().getId().equals(projectId)) {
            return ResponseEntity.notFound().build();
        }
        if (!hasAccess(plan.getProject().getTenant().getId(), principal)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
        return ResponseEntity.ok(runRepository.findByPlanId(planId, pageable));
    }

    private boolean hasAccess(UUID projectTenantId, UserPrincipal principal) {
        if (principal.isPlatformUser()) return true;
        UUID tenantId = TenantContext.getCurrentTenantId();
        return projectTenantId.equals(tenantId);
    }
}
