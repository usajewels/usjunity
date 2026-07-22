package com.mxsuite.controller;

import com.mxsuite.audit.AuditService;
import com.mxsuite.model.MigrationBlueprint;
import com.mxsuite.model.PhaseGate;
import com.mxsuite.model.Project;
import com.mxsuite.model.enums.GateStatus;
import com.mxsuite.model.enums.MigrationPhase;
import com.mxsuite.model.enums.MigrationStatus;
import com.mxsuite.repository.MigrationBlueprintRepository;
import com.mxsuite.repository.PhaseGateRepository;
import com.mxsuite.repository.PlatformAssignmentRepository;
import com.mxsuite.repository.ProjectRepository;
import com.mxsuite.repository.TenantRepository;
import com.mxsuite.security.TenantContext;
import com.mxsuite.security.UserPrincipal;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;



@RestController
@RequestMapping("/api/migration")
@Transactional(readOnly = true)
public class MigrationDashboardController {

    private final ProjectRepository projectRepository;
    private final PhaseGateRepository phaseGateRepository;
    private final MigrationBlueprintRepository blueprintRepository;
    private final PlatformAssignmentRepository assignmentRepository;
    private final TenantRepository tenantRepository;
    private final AuditService auditService;

    public MigrationDashboardController(ProjectRepository projectRepository,
                                         PhaseGateRepository phaseGateRepository,
                                         MigrationBlueprintRepository blueprintRepository,
                                         PlatformAssignmentRepository assignmentRepository,
                                         TenantRepository tenantRepository,
                                         AuditService auditService) {
        this.projectRepository = projectRepository;
        this.phaseGateRepository = phaseGateRepository;
        this.blueprintRepository = blueprintRepository;
        this.assignmentRepository = assignmentRepository;
        this.tenantRepository = tenantRepository;
        this.auditService = auditService;
    }

    // --- DTOs ---

    public record MigrationProjectDto(
            UUID id, String name, String sourceSystem, String targetSystem,
            MigrationPhase migrationPhase, MigrationStatus migrationStatus,
            BigDecimal reconciliationPct, String ownerName, String tenantName,
            List<PhaseGateDto> phaseGates, Instant createdAt) {}

    public record PhaseGateDto(
            UUID id, MigrationPhase phase, GateStatus gateStatus,
            String clearedByName, Instant clearedAt, String blockedReason) {}

    public record MigrationStatsDto(
            long activeMigrations, long gatesAwaitingApproval,
            double avgCycleTimeDays, double reconciliationPassRate) {}

    public record BlueprintDto(
            UUID id, String name, String description,
            String sourceSystem, String targetSystem,
            boolean proven, Instant createdAt) {}

    public record UpdateMigrationRequest(
            String sourceSystem, String targetSystem,
            MigrationPhase migrationPhase, MigrationStatus migrationStatus) {}

    // --- Endpoints ---

    @GetMapping("/projects")
    public Page<MigrationProjectDto> listProjects(@AuthenticationPrincipal UserPrincipal principal,
                                                   Pageable pageable) {
        if (principal != null && principal.isPlatformAdmin()) {
            return projectRepository.findAllMigrationProjects(pageable)
                    .map(this::toMigrationProjectDto);
        }
        if (principal != null && principal.isPlatformSupport()) {
            List<UUID> tenantIds = visibleTenantIds(principal);
            if (tenantIds.isEmpty()) return org.springframework.data.domain.Page.empty(pageable);
            return projectRepository.findMigrationProjectsByTenantIds(tenantIds, pageable)
                    .map(this::toMigrationProjectDto);
        }
        UUID tenantId = TenantContext.getCurrentTenantId();
        return projectRepository.findMigrationProjectsByTenantId(tenantId, pageable)
                .map(this::toMigrationProjectDto);
    }

    @GetMapping("/stats")
    public MigrationStatsDto getStats(@AuthenticationPrincipal UserPrincipal principal) {
        long active;
        long gatesPending;
        if (principal != null && principal.isPlatformAdmin()) {
            active = projectRepository.countAllActiveMigrations();
            gatesPending = phaseGateRepository.countByGateStatus(GateStatus.PENDING);
        } else if (principal != null && principal.isPlatformSupport()) {
            List<UUID> tenantIds = visibleTenantIds(principal);
            active = tenantIds.isEmpty() ? 0 : projectRepository.countActiveMigrationsByTenantIds(tenantIds);
            gatesPending = tenantIds.isEmpty() ? 0 : tenantIds.stream()
                    .mapToLong(tid -> phaseGateRepository.countByProject_Tenant_IdAndGateStatus(tid, GateStatus.PENDING))
                    .sum();
        } else {
            UUID tenantId = TenantContext.getCurrentTenantId();
            active = projectRepository.countActiveMigrations(tenantId);
            gatesPending = phaseGateRepository.countByProject_Tenant_IdAndGateStatus(tenantId, GateStatus.PENDING);
        }

        // TODO: compute real avg cycle time from completed migrations
        double avgCycleTime = 0.0;
        // TODO: compute real reconciliation pass rate
        double reconPassRate = 0.0;

        return new MigrationStatsDto(active, gatesPending, avgCycleTime, reconPassRate);
    }

    @GetMapping("/blueprints")
    public List<BlueprintDto> listBlueprints() {
        UUID tenantId = TenantContext.getCurrentTenantId();
        return blueprintRepository.findByTenantIdOrGlobal(tenantId).stream()
                .map(this::toBlueprintDto)
                .toList();
    }

    @PostMapping("/projects/{id}/advance-phase")
    @Transactional
    public ResponseEntity<?> advancePhase(@PathVariable UUID id,
                                           @AuthenticationPrincipal UserPrincipal principal) {
        return projectRepository.findById(id)
                .map(project -> {
                    if (!hasAccess(project, principal)) {
                        return ResponseEntity.status(403).body(Map.of("message", "Access denied"));
                    }
                    MigrationPhase current = project.getMigrationPhase();
                    if (current == null) {
                        return ResponseEntity.badRequest().body(Map.of("message", "Project has no migration phase set"));
                    }
                    MigrationPhase[] phases = MigrationPhase.values();
                    int idx = current.ordinal();
                    if (idx >= phases.length - 1) {
                        return ResponseEntity.badRequest().body(Map.of("message", "Project is already at the final phase"));
                    }

                    // Check gate is cleared for current phase
                    List<PhaseGate> gates = phaseGateRepository.findByProjectIdOrderByPhase(id);
                    for (PhaseGate gate : gates) {
                        if (gate.getPhase() == current && gate.getGateStatus() != GateStatus.CLEARED
                                && gate.getGateStatus() != GateStatus.SKIPPED) {
                            return ResponseEntity.badRequest().body(Map.of(
                                    "message", "Gate for phase " + current + " must be cleared before advancing"));
                        }
                    }

                    project.setMigrationPhase(phases[idx + 1]);
                    projectRepository.save(project);
                    auditService.log("ADVANCE_PHASE", "Project", project.getId(),
                            current + " → " + phases[idx + 1]);
                    return ResponseEntity.ok(toMigrationProjectDto(project));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @PutMapping("/projects/{id}")
    @Transactional
    @PreAuthorize("hasAnyRole('PLATFORM_ADMIN','PLATFORM_SUPPORT')")
    public ResponseEntity<?> updateMigration(@PathVariable UUID id,
                                              @RequestBody UpdateMigrationRequest request) {
        return projectRepository.findById(id)
                .map(project -> {
                    if (request.sourceSystem() != null) project.setSourceSystem(request.sourceSystem());
                    if (request.targetSystem() != null) project.setTargetSystem(request.targetSystem());
                    if (request.migrationPhase() != null) project.setMigrationPhase(request.migrationPhase());
                    if (request.migrationStatus() != null) project.setMigrationStatus(request.migrationStatus());
                    projectRepository.save(project);
                    auditService.log("UPDATE_MIGRATION", "Project", project.getId(), project.getName());
                    return ResponseEntity.ok(toMigrationProjectDto(project));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    // --- Helpers ---

    private MigrationProjectDto toMigrationProjectDto(Project project) {
        List<PhaseGateDto> gates = phaseGateRepository.findByProjectIdOrderByPhase(project.getId())
                .stream().map(this::toPhaseGateDto).toList();
        String ownerName = project.getOwner() != null
                ? project.getOwner().getFirstName() + " " + project.getOwner().getLastName()
                : null;
        String tenantName = project.getTenant() != null ? project.getTenant().getName() : null;
        return new MigrationProjectDto(
                project.getId(), project.getName(),
                project.getSourceSystem(), project.getTargetSystem(),
                project.getMigrationPhase(), project.getMigrationStatus(),
                project.getReconciliationPct(), ownerName, tenantName,
                gates, project.getCreatedAt());
    }

    private PhaseGateDto toPhaseGateDto(PhaseGate gate) {
        return new PhaseGateDto(
                gate.getId(), gate.getPhase(), gate.getGateStatus(),
                null, gate.getClearedAt(), gate.getBlockedReason());
    }

    private BlueprintDto toBlueprintDto(MigrationBlueprint bp) {
        return new BlueprintDto(
                bp.getId(), bp.getName(), bp.getDescription(),
                bp.getSourceSystem(), bp.getTargetSystem(),
                bp.isProven(), bp.getCreatedAt());
    }

    private boolean hasAccess(Project project, UserPrincipal principal) {
        if (principal.isPlatformAdmin()) return true;
        UUID projectTenantId = project.getTenant().getId();
        if (principal.isPlatformSupport()) {
            if (project.getTenant().isOpenToAllCoaches()) return true;
            return assignmentRepository.existsByPlatformUserIdAndTenantIdAndActiveTrue(
                    principal.id(), projectTenantId);
        }
        return projectTenantId.equals(TenantContext.getCurrentTenantId());
    }

    private List<UUID> visibleTenantIds(UserPrincipal principal) {
        List<UUID> assigned = assignmentRepository.findByPlatformUserIdAndActiveTrue(principal.id())
                .stream().map(a -> a.getTenant().getId()).toList();
        List<UUID> openToAll = tenantRepository.findByOpenToAllCoachesTrue()
                .stream().map(t -> t.getId()).toList();
        return java.util.stream.Stream.concat(assigned.stream(), openToAll.stream())
                .distinct().toList();
    }
}
