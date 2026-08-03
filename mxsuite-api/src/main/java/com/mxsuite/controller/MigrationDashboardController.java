package com.mxsuite.controller;

import com.mxsuite.audit.AuditService;
import com.mxsuite.model.MigrationBlueprint;
import com.mxsuite.model.PhaseGate;
import com.mxsuite.model.PhaseTimeEntry;
import com.mxsuite.model.Project;
import com.mxsuite.model.ProjectDataUpload;
import com.mxsuite.model.enums.GateApprovalMode;
import com.mxsuite.model.enums.GateStatus;
import com.mxsuite.model.enums.MigrationPhase;
import com.mxsuite.model.enums.MigrationStatus;
import com.mxsuite.repository.MigrationBlueprintRepository;
import com.mxsuite.repository.PhaseGateRepository;
import com.mxsuite.repository.PhaseTimeEntryRepository;
import com.mxsuite.repository.PlatformAssignmentRepository;
import com.mxsuite.repository.ProjectDataUploadRepository;
import com.mxsuite.repository.ProjectRepository;
import com.mxsuite.repository.ReconciliationReportRepository;
import com.mxsuite.repository.TenantRepository;
import com.mxsuite.security.TenantContext;
import com.mxsuite.security.UserPrincipal;
import com.mxsuite.service.DataValidationService;
import com.mxsuite.service.PhaseGateService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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

    private static final Logger log = LoggerFactory.getLogger(MigrationDashboardController.class);

    private final ProjectRepository projectRepository;
    private final PhaseGateRepository phaseGateRepository;
    private final PhaseTimeEntryRepository phaseTimeEntryRepository;
    private final MigrationBlueprintRepository blueprintRepository;
    private final PlatformAssignmentRepository assignmentRepository;
    private final ProjectDataUploadRepository uploadRepository;
    private final TenantRepository tenantRepository;
    private final ReconciliationReportRepository reconRepository;
    private final AuditService auditService;
    private final DataValidationService dataValidationService;
    private final PhaseGateService phaseGateService;

    public MigrationDashboardController(ProjectRepository projectRepository,
                                         PhaseGateRepository phaseGateRepository,
                                         PhaseTimeEntryRepository phaseTimeEntryRepository,
                                         MigrationBlueprintRepository blueprintRepository,
                                         PlatformAssignmentRepository assignmentRepository,
                                         ProjectDataUploadRepository uploadRepository,
                                         TenantRepository tenantRepository,
                                         ReconciliationReportRepository reconRepository,
                                         AuditService auditService,
                                         DataValidationService dataValidationService,
                                         PhaseGateService phaseGateService) {
        this.projectRepository = projectRepository;
        this.phaseGateRepository = phaseGateRepository;
        this.phaseTimeEntryRepository = phaseTimeEntryRepository;
        this.blueprintRepository = blueprintRepository;
        this.assignmentRepository = assignmentRepository;
        this.uploadRepository = uploadRepository;
        this.tenantRepository = tenantRepository;
        this.reconRepository = reconRepository;
        this.auditService = auditService;
        this.dataValidationService = dataValidationService;
        this.phaseGateService = phaseGateService;
    }

    // --- DTOs ---

    public record MigrationProjectDto(
            UUID id, String name, String sourceSystem, String targetSystem,
            MigrationPhase migrationPhase, MigrationStatus migrationStatus,
            BigDecimal reconciliationPct, String ownerName,
            UUID tenantId, String tenantName,
            List<PhaseGateDto> phaseGates, List<PhaseTimeDto> phaseTimes,
            Instant createdAt) {}

    public record PhaseGateDto(
            UUID id, MigrationPhase phase, GateStatus gateStatus,
            String clearedByName, Instant clearedAt, String blockedReason,
            GateApprovalMode approvalMode) {}

    public record UpdateApprovalModeRequest(GateApprovalMode approvalMode) {}

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

    public record PhaseTimeDto(
            MigrationPhase phase, Instant startedAt, Instant completedAt,
            long durationMinutes, boolean active) {}

    // --- Endpoints ---

    @GetMapping("/projects")
    public Page<MigrationProjectDto> listProjects(@AuthenticationPrincipal UserPrincipal principal,
                                                   Pageable pageable,
                                                   @RequestParam(required = false) String search,
                                                   @RequestParam(required = false) String letter) {
        boolean hasSearch = search != null && !search.isBlank();
        boolean hasLetter = letter != null && !letter.isBlank();
        String s = hasSearch ? search.trim() : null;
        String l = hasLetter ? letter.trim().toLowerCase() : null;

        if (principal != null && principal.isPlatformAdmin()) {
            if (hasSearch) return projectRepository.findAllMigrationProjectsBySearch(s, pageable).map(this::toMigrationProjectDto);
            if (hasLetter) return projectRepository.findAllMigrationProjectsByLetter(l, pageable).map(this::toMigrationProjectDto);
            return projectRepository.findAllMigrationProjects(pageable).map(this::toMigrationProjectDto);
        }
        if (principal != null && (principal.isCoachAdmin() || principal.isPlatformSupport())) {
            List<UUID> tenantIds = visibleTenantIds(principal);
            if (tenantIds.isEmpty()) return org.springframework.data.domain.Page.empty(pageable);
            if (hasSearch) return projectRepository.findMigrationProjectsByTenantIdsAndSearch(tenantIds, s, pageable).map(this::toMigrationProjectDto);
            if (hasLetter) return projectRepository.findMigrationProjectsByTenantIdsAndLetter(tenantIds, l, pageable).map(this::toMigrationProjectDto);
            return projectRepository.findMigrationProjectsByTenantIds(tenantIds, pageable).map(this::toMigrationProjectDto);
        }
        UUID tenantId = TenantContext.getCurrentTenantId();
        if (hasSearch) return projectRepository.findMigrationProjectsByTenantIdAndSearch(tenantId, s, pageable).map(this::toMigrationProjectDto);
        if (hasLetter) return projectRepository.findMigrationProjectsByTenantIdAndLetter(tenantId, l, pageable).map(this::toMigrationProjectDto);
        return projectRepository.findMigrationProjectsByTenantId(tenantId, pageable).map(this::toMigrationProjectDto);
    }

    @GetMapping("/stats")
    public MigrationStatsDto getStats(@AuthenticationPrincipal UserPrincipal principal) {
        long active;
        long gatesPending;
        if (principal != null && (principal.isPlatformAdmin() || principal.isCoachAdmin())) {
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

        Double avgDays = phaseTimeEntryRepository.computeAvgCycleTimeDays();
        double avgCycleTime = avgDays != null ? avgDays : 0.0;

        double reconPassRate;
        if (principal != null && (principal.isPlatformAdmin() || principal.isCoachAdmin())) {
            reconPassRate = reconRepository.computeGlobalPassRate();
        } else if (principal != null && principal.isPlatformSupport()) {
            List<UUID> tenantIds = visibleTenantIds(principal);
            reconPassRate = tenantIds.isEmpty() ? 0.0 : reconRepository.computePassRateByTenants(tenantIds);
        } else {
            reconPassRate = reconRepository.computePassRateByTenant(TenantContext.getCurrentTenantId());
        }

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

                    // Phase time tracking: complete current phase timer, start next
                    Instant now = Instant.now();
                    phaseTimeEntryRepository.findByProjectIdAndPhase(id, current)
                            .ifPresentOrElse(
                                    entry -> { entry.setCompletedAt(now); phaseTimeEntryRepository.save(entry); },
                                    () -> {
                                        // Backfill for pre-existing projects without a timer
                                        PhaseTimeEntry backfill = new PhaseTimeEntry();
                                        backfill.setProject(project);
                                        backfill.setPhase(current);
                                        backfill.setStartedAt(project.getCreatedAt());
                                        backfill.setCompletedAt(now);
                                        phaseTimeEntryRepository.save(backfill);
                                    });
                    PhaseTimeEntry nextEntry = new PhaseTimeEntry();
                    nextEntry.setProject(project);
                    nextEntry.setPhase(phases[idx + 1]);
                    nextEntry.setStartedAt(now);
                    phaseTimeEntryRepository.save(nextEntry);

                    auditService.log("ADVANCE_PHASE", "Project", project.getId(),
                            current + " → " + phases[idx + 1]);

                    // Auto-trigger validation when entering GENERATE phase
                    if (phases[idx + 1] == MigrationPhase.GENERATE) {
                        autoTriggerValidation(project, principal);
                    }

                    // Auto-evaluate DRY_RUN gate when entering DRY_RUN phase
                    if (phases[idx + 1] == MigrationPhase.DRY_RUN) {
                        phaseGateService.evaluateDryRunGate(project.getId());
                    }

                    // Auto-evaluate MIGRATE gate when entering MIGRATE phase
                    if (phases[idx + 1] == MigrationPhase.MIGRATE) {
                        phaseGateService.evaluateMigrateGate(project.getId());
                    }

                    // Auto-open CUT_OVER gate when entering CUT_OVER phase
                    if (phases[idx + 1] == MigrationPhase.CUT_OVER) {
                        phaseGateService.evaluateCutOverGate(project.getId());
                    }

                    return ResponseEntity.ok(toMigrationProjectDto(project));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @PutMapping("/projects/{id}")
    @Transactional
    @PreAuthorize("hasAnyRole('PLATFORM_ADMIN','COACH_ADMIN','PLATFORM_SUPPORT')")
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

    @GetMapping("/projects/{id}/phase-times")
    public ResponseEntity<?> getProjectPhaseTimes(@PathVariable UUID id,
                                                    @AuthenticationPrincipal UserPrincipal principal) {
        return projectRepository.findById(id)
                .map(project -> {
                    if (!hasAccess(project, principal)) {
                        return ResponseEntity.status(403).body(Map.of("message", "Access denied"));
                    }
                    Instant now = Instant.now();
                    List<PhaseTimeDto> times = phaseTimeEntryRepository
                            .findByProjectIdOrderByStartedAt(id).stream()
                            .map(entry -> {
                                boolean active = entry.getCompletedAt() == null;
                                Instant end = active ? now : entry.getCompletedAt();
                                long minutes = java.time.Duration.between(entry.getStartedAt(), end).toMinutes();
                                return new PhaseTimeDto(entry.getPhase(), entry.getStartedAt(),
                                        entry.getCompletedAt(), minutes, active);
                            })
                            .toList();
                    return ResponseEntity.ok(times);
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @PutMapping("/projects/{projectId}/gates/{phase}/approval-mode")
    @Transactional
    @PreAuthorize("hasAnyRole('PLATFORM_ADMIN','COACH_ADMIN')")
    public ResponseEntity<?> updateGateApprovalMode(@PathVariable UUID projectId,
                                                     @PathVariable MigrationPhase phase,
                                                     @RequestBody UpdateApprovalModeRequest req) {
        return phaseGateRepository.findByProjectIdAndPhase(projectId, phase)
                .map(gate -> {
                    gate.setApprovalMode(req.approvalMode());
                    phaseGateRepository.save(gate);
                    auditService.log("UPDATE_GATE_APPROVAL_MODE", "PhaseGate", gate.getId(),
                            phase + " → " + req.approvalMode());
                    return ResponseEntity.ok(toPhaseGateDto(gate));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    // --- Helpers ---

    private MigrationProjectDto toMigrationProjectDto(Project project) {
        List<PhaseGateDto> gates = phaseGateRepository.findByProjectIdOrderByPhase(project.getId())
                .stream().map(this::toPhaseGateDto).toList();
        Instant now = Instant.now();
        List<PhaseTimeDto> times = phaseTimeEntryRepository
                .findByProjectIdOrderByStartedAt(project.getId()).stream()
                .map(entry -> {
                    boolean active = entry.getCompletedAt() == null;
                    Instant end = active ? now : entry.getCompletedAt();
                    long minutes = java.time.Duration.between(entry.getStartedAt(), end).toMinutes();
                    return new PhaseTimeDto(entry.getPhase(), entry.getStartedAt(),
                            entry.getCompletedAt(), minutes, active);
                })
                .toList();
        String ownerName = project.getOwner() != null
                ? project.getOwner().getFirstName() + " " + project.getOwner().getLastName()
                : null;
        UUID tenantId = project.getTenant() != null ? project.getTenant().getId() : null;
        String tenantName = project.getTenant() != null ? project.getTenant().getName() : null;
        return new MigrationProjectDto(
                project.getId(), project.getName(),
                project.getSourceSystem(), project.getTargetSystem(),
                project.getMigrationPhase(), project.getMigrationStatus(),
                project.getReconciliationPct(), ownerName, tenantId, tenantName,
                gates, times, project.getCreatedAt());
    }

    private PhaseGateDto toPhaseGateDto(PhaseGate gate) {
        return new PhaseGateDto(
                gate.getId(), gate.getPhase(), gate.getGateStatus(),
                null, gate.getClearedAt(), gate.getBlockedReason(),
                gate.getApprovalMode());
    }

    private BlueprintDto toBlueprintDto(MigrationBlueprint bp) {
        return new BlueprintDto(
                bp.getId(), bp.getName(), bp.getDescription(),
                bp.getSourceSystem(), bp.getTargetSystem(),
                bp.isProven(), bp.getCreatedAt());
    }

    private boolean hasAccess(Project project, UserPrincipal principal) {
        if (principal.isPlatformAdmin() || principal.isCoachAdmin()) return true;
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

    /**
     * Auto-trigger data validation when a project enters the GENERATE phase.
     * Finds the latest parsed upload and kicks off async validation.
     */
    private void autoTriggerValidation(Project project, UserPrincipal principal) {
        try {
            ProjectDataUpload upload = uploadRepository
                    .findFirstByProjectIdOrderByCreatedAtDesc(project.getId())
                    .orElse(null);
            if (upload == null || upload.getStoragePath() == null) {
                log.warn("No upload found for project={} — skipping auto-validation", project.getId());
                return;
            }
            log.info("Auto-triggering validation for project={} upload={}", project.getId(), upload.getId());
            dataValidationService.runValidation(
                    project.getId(), upload.getId(), principal.id(), principal.tenantId());
        } catch (Exception e) {
            log.warn("Failed to auto-trigger validation for project={}: {}",
                    project.getId(), e.getMessage());
        }
    }
}
