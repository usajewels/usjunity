package com.mxsuite.service;

import com.mxsuite.audit.AuditService;
import com.mxsuite.model.ApprovalRequest;
import com.mxsuite.model.PhaseGate;
import com.mxsuite.model.Project;
import com.mxsuite.model.ProjectDataUpload;
import com.mxsuite.model.ReconciliationReport;
import com.mxsuite.model.User;
import com.mxsuite.model.ValidationRun;
import com.mxsuite.model.enums.ApprovalStatus;
import com.mxsuite.model.enums.GateApprovalMode;
import com.mxsuite.model.enums.GateStatus;
import com.mxsuite.model.enums.MappingStatus;
import com.mxsuite.model.enums.MigrationPhase;
import com.mxsuite.model.enums.MigrationStatus;
import com.mxsuite.model.enums.UserRole;
import com.mxsuite.repository.ApprovalRequestRepository;
import com.mxsuite.repository.FieldMappingEntryRepository;
import com.mxsuite.repository.PhaseGateRepository;
import com.mxsuite.repository.PlatformAssignmentRepository;
import com.mxsuite.repository.ProjectDataUploadRepository;
import com.mxsuite.repository.ProjectRepository;
import com.mxsuite.repository.ReconciliationReportRepository;
import com.mxsuite.repository.UserRepository;
import com.mxsuite.repository.ValidationRunRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Evaluates and updates PhaseGate statuses based on lifecycle conditions and approval modes.
 *
 * Gate rules (conditions that must be met before clearing or requesting approval):
 *   DISCOVER gate → No blocking condition; triggered by successful CSV upload
 *   MAP gate      → All mappings reviewed (none in NEEDS_REVIEW)
 *   GENERATE gate → Validation completed with zero ERROR-severity issues
 *   DRY_RUN gate  → Reconciliation report exists and is signed off
 *   MIGRATE gate  → Batch import completed successfully (importStatus = COMPLETED)
 *   CUT_OVER gate → No automated blocking condition; pure human sign-off for go-live
 *
 * Approval modes (who must sign off before gate CLEARS):
 *   AUTO       → Clears immediately when conditions are met
 *   COACH_ONLY → COACH_ADMIN must authorize via approvals queue
 *   BOTH       → Member submits first, then coach authorizes; gate clears only when both done
 *
 * Side effect: when the CUT_OVER gate clears, the project is automatically marked COMPLETED.
 */
@Service
public class PhaseGateService {

    private static final Logger log = LoggerFactory.getLogger(PhaseGateService.class);

    private static final String ROLE_MEMBER = "TENANT_ADMIN";
    private static final String ROLE_COACH  = "COACH_ADMIN";

    private final PhaseGateRepository gateRepository;
    private final ValidationRunRepository validationRunRepository;
    private final ReconciliationReportRepository reconRepository;
    private final FieldMappingEntryRepository mappingRepository;
    private final ApprovalRequestRepository approvalRepository;
    private final ProjectDataUploadRepository uploadRepository;
    private final ProjectRepository projectRepository;
    private final UserRepository userRepository;
    private final PlatformAssignmentRepository assignmentRepository;
    private final AuditService auditService;
    private final EmailService emailService;

    // Optional — avoids circular dependency with ChatService
    private ChatService chatService;

    @Autowired(required = false)
    public void setChatService(ChatService chatService) {
        this.chatService = chatService;
    }

    public PhaseGateService(PhaseGateRepository gateRepository,
                            ValidationRunRepository validationRunRepository,
                            ReconciliationReportRepository reconRepository,
                            FieldMappingEntryRepository mappingRepository,
                            ApprovalRequestRepository approvalRepository,
                            ProjectDataUploadRepository uploadRepository,
                            ProjectRepository projectRepository,
                            UserRepository userRepository,
                            PlatformAssignmentRepository assignmentRepository,
                            AuditService auditService,
                            EmailService emailService) {
        this.gateRepository = gateRepository;
        this.validationRunRepository = validationRunRepository;
        this.reconRepository = reconRepository;
        this.mappingRepository = mappingRepository;
        this.approvalRepository = approvalRepository;
        this.uploadRepository = uploadRepository;
        this.projectRepository = projectRepository;
        this.userRepository = userRepository;
        this.assignmentRepository = assignmentRepository;
        this.auditService = auditService;
        this.emailService = emailService;
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /**
     * Evaluate the DISCOVER phase gate.
     * No automated blocking condition — the upload itself is the triggering event.
     * Clears immediately (AUTO) or creates approval requests per the configured approval mode.
     */
    @Transactional
    public GateStatus evaluateDiscoverGate(UUID projectId) {
        PhaseGate gate = gateRepository.findByProjectIdAndPhase(projectId, MigrationPhase.DISCOVER)
                .orElse(null);
        if (gate == null) return GateStatus.PENDING;

        gate.setBlockedReason(null);
        log.info("DISCOVER gate evaluating for project={}", projectId);
        return clearOrRequestApproval(gate,
                "Data Upload Complete",
                "Member has uploaded their source data file. Review to advance to MAP phase.");
    }

    /**
     * Evaluate the MAP phase gate.
     * Clears (or triggers approvals) if all field mappings are reviewed (none in NEEDS_REVIEW).
     */
    @Transactional
    public GateStatus evaluateMapGate(UUID projectId) {
        long needsReview = mappingRepository.countByProjectIdAndMappingStatus(
                projectId, MappingStatus.NEEDS_REVIEW);

        PhaseGate gate = gateRepository.findByProjectIdAndPhase(projectId, MigrationPhase.MAP)
                .orElse(null);
        if (gate == null) return GateStatus.PENDING;

        if (needsReview > 0) {
            GateStatus prev = gate.getGateStatus();
            gate.setGateStatus(GateStatus.BLOCKED);
            gate.setBlockedReason(needsReview + " mapping(s) still need review");
            gateRepository.save(gate);
            if (prev != GateStatus.BLOCKED) {
                notifyGateChange(gate, "Phase MAP is blocked: " + gate.getBlockedReason());
            }
            return GateStatus.BLOCKED;
        }

        // All mappings reviewed — clear or request approval
        gate.setBlockedReason(null);
        return clearOrRequestApproval(gate,
                "Mapping Review Complete",
                "All field mappings have been reviewed. Authorize to advance to the GENERATE phase.");
    }

    /**
     * Evaluate the GENERATE phase gate.
     * Clears (or triggers approvals) if the latest validation run completed with zero errors.
     */
    @Transactional
    public GateStatus evaluateGenerateGate(UUID projectId) {
        PhaseGate gate = gateRepository.findByProjectIdAndPhase(projectId, MigrationPhase.GENERATE)
                .orElse(null);
        if (gate == null) return GateStatus.PENDING;
        GateStatus prev = gate.getGateStatus();

        ValidationRun latestRun = validationRunRepository
                .findFirstByProjectIdOrderByCreatedAtDesc(projectId)
                .orElse(null);

        if (latestRun == null) {
            gate.setGateStatus(GateStatus.BLOCKED);
            gate.setBlockedReason("No validation has been run yet");
            gateRepository.save(gate);
            if (prev != GateStatus.BLOCKED) {
                notifyGateChange(gate, "Phase GENERATE is blocked: " + gate.getBlockedReason());
            }
            return GateStatus.BLOCKED;
        }

        if (!"COMPLETED".equals(latestRun.getStatus())) {
            gate.setGateStatus(GateStatus.BLOCKED);
            gate.setBlockedReason("Validation is still " + latestRun.getStatus());
            gateRepository.save(gate);
            if (prev != GateStatus.BLOCKED) {
                notifyGateChange(gate, "Phase GENERATE is blocked: " + gate.getBlockedReason());
            }
            return GateStatus.BLOCKED;
        }

        if (latestRun.getErrorRows() > 0) {
            gate.setGateStatus(GateStatus.BLOCKED);
            gate.setBlockedReason(latestRun.getErrorRows() + " row(s) have errors — "
                    + "fix issues in Data Health before proceeding");
            gateRepository.save(gate);
            if (prev != GateStatus.BLOCKED) {
                notifyGateChange(gate, "Phase GENERATE is blocked: " + gate.getBlockedReason());
            }
            return GateStatus.BLOCKED;
        }

        // Validation passed — clear or request approval
        gate.setBlockedReason(null);
        log.info("GENERATE gate conditions met for project={}: {} rows, {} warnings",
                projectId, latestRun.getTotalRows(), latestRun.getWarningRows());
        return clearOrRequestApproval(gate,
                "Validation Passed — Ready for Migration Authorization",
                "Data validation completed with 0 errors (" + latestRun.getWarningRows()
                        + " warning(s)). Authorize to advance to the DRY_RUN phase.");
    }

    /**
     * Evaluate the DRY_RUN phase gate.
     * Clears (or triggers approvals) if a signed-off reconciliation report exists.
     */
    @Transactional
    public GateStatus evaluateDryRunGate(UUID projectId) {
        PhaseGate gate = gateRepository.findByProjectIdAndPhase(projectId, MigrationPhase.DRY_RUN)
                .orElse(null);
        if (gate == null) return GateStatus.PENDING;
        GateStatus prev = gate.getGateStatus();

        ReconciliationReport latestRecon = reconRepository
                .findFirstByProjectIdOrderByCreatedAtDesc(projectId)
                .orElse(null);

        if (latestRecon == null) {
            gate.setGateStatus(GateStatus.BLOCKED);
            gate.setBlockedReason("No reconciliation report has been generated");
            gateRepository.save(gate);
            if (prev != GateStatus.BLOCKED) {
                notifyGateChange(gate, "Phase DRY_RUN is blocked: " + gate.getBlockedReason());
            }
            return GateStatus.BLOCKED;
        }

        if (!latestRecon.isSignedOff()) {
            gate.setGateStatus(GateStatus.BLOCKED);
            gate.setBlockedReason("Reconciliation report requires sign-off before proceeding");
            gateRepository.save(gate);
            if (prev != GateStatus.BLOCKED) {
                notifyGateChange(gate, "Phase DRY_RUN is blocked: " + gate.getBlockedReason());
            }
            return GateStatus.BLOCKED;
        }

        // Reconciliation signed off — clear or request approval
        gate.setBlockedReason(null);
        return clearOrRequestApproval(gate,
                "Data Quality Confirmed — Authorize Migration",
                "Reconciliation report has been signed off. Authorize to advance to the MIGRATE phase.");
    }

    /**
     * Evaluate the MIGRATE phase gate.
     * Clears (or triggers approvals) when the batch import completed successfully.
     */
    @Transactional
    public GateStatus evaluateMigrateGate(UUID projectId) {
        PhaseGate gate = gateRepository.findByProjectIdAndPhase(projectId, MigrationPhase.MIGRATE)
                .orElse(null);
        if (gate == null) return GateStatus.PENDING;
        GateStatus prev = gate.getGateStatus();

        ProjectDataUpload latestUpload = uploadRepository
                .findFirstByProjectIdOrderByCreatedAtDesc(projectId).orElse(null);

        if (latestUpload == null) {
            gate.setGateStatus(GateStatus.BLOCKED);
            gate.setBlockedReason("No data upload found — complete the batch import before advancing");
            gateRepository.save(gate);
            if (prev != GateStatus.BLOCKED) {
                notifyGateChange(gate, "Phase MIGRATE is blocked: " + gate.getBlockedReason());
            }
            return GateStatus.BLOCKED;
        }

        String importStatus = latestUpload.getImportStatus();
        if ("PROCESSING".equals(importStatus)) {
            gate.setGateStatus(GateStatus.BLOCKED);
            gate.setBlockedReason("Batch import is still in progress");
            gateRepository.save(gate);
            if (prev != GateStatus.BLOCKED) {
                notifyGateChange(gate, "Phase MIGRATE is blocked: " + gate.getBlockedReason());
            }
            return GateStatus.BLOCKED;
        }
        if (!"COMPLETED".equals(importStatus)) {
            gate.setGateStatus(GateStatus.BLOCKED);
            gate.setBlockedReason("Batch import did not complete successfully (status: " + importStatus + ")");
            gateRepository.save(gate);
            if (prev != GateStatus.BLOCKED) {
                notifyGateChange(gate, "Phase MIGRATE is blocked: " + gate.getBlockedReason());
            }
            return GateStatus.BLOCKED;
        }

        // Import completed — clear or request approval
        gate.setBlockedReason(null);
        log.info("MIGRATE gate conditions met for project={}", projectId);
        return clearOrRequestApproval(gate,
                "Import Complete — Authorize Production Cut-Over",
                "The data batch import completed successfully. Authorize to advance to the CUT_OVER phase.");
    }

    /**
     * Evaluate the CUT_OVER phase gate.
     * No automated blocking condition — CUT_OVER is a pure human sign-off that go-live occurred.
     * Clears immediately (AUTO) or creates approval requests per the configured approval mode.
     */
    @Transactional
    public GateStatus evaluateCutOverGate(UUID projectId) {
        PhaseGate gate = gateRepository.findByProjectIdAndPhase(projectId, MigrationPhase.CUT_OVER)
                .orElse(null);
        if (gate == null) return GateStatus.PENDING;

        gate.setBlockedReason(null);
        log.info("CUT_OVER gate opened for project={}", projectId);
        return clearOrRequestApproval(gate,
                "Production Go-Live Sign-Off",
                "The migration has been pushed to production. Authorize final sign-off to mark the project complete.");
    }

    /**
     * Checks whether all required approvals for a gate have been received.
     * If so, marks the gate CLEARED and returns CLEARED; otherwise returns PENDING.
     *
     * Called by ApprovalController after any approval is recorded.
     */
    @Transactional
    public GateStatus checkAndClearGate(PhaseGate gate) {
        GateApprovalMode mode = gate.getApprovalMode();
        List<ApprovalRequest> approvals = approvalRepository.findByPhaseGateId(gate.getId());

        boolean memberDone = !requiresMember(mode) ||
                approvals.stream().anyMatch(a ->
                        ROLE_MEMBER.equals(a.getRequiredRole()) &&
                        a.getApprovalStatus() == ApprovalStatus.APPROVED);

        boolean coachDone = !requiresCoach(mode) ||
                approvals.stream().anyMatch(a ->
                        ROLE_COACH.equals(a.getRequiredRole()) &&
                        a.getApprovalStatus() == ApprovalStatus.APPROVED);

        if (memberDone && coachDone) {
            gate.setGateStatus(GateStatus.CLEARED);
            gate.setClearedAt(Instant.now());
            gateRepository.save(gate);
            auditService.log("GATE_CLEARED", "PhaseGate", gate.getId(),
                    gate.getPhase() + " gate cleared — all required approvals received");
            log.info("Gate CLEARED: project={} phase={} mode={}",
                    gate.getProject().getId(), gate.getPhase(), mode);
            notifyGateChange(gate, "Phase " + gate.getPhase().name()
                    + " gate has been cleared. Your project is advancing to the next phase.");
            if (gate.getPhase() == MigrationPhase.CUT_OVER) {
                completeMigration(gate.getProject());
            }
            return GateStatus.CLEARED;
        }

        return GateStatus.PENDING;
    }

    /**
     * Creates approval request(s) for the given gate according to its approvalMode.
     * Skips creation if an identical PENDING request already exists (idempotent).
     * Package-accessible so TenantOnboardingController can call it for the DISCOVER gate.
     */
    @Transactional
    public void createApprovalRequestsIfNeeded(PhaseGate gate, String title, String description) {
        GateApprovalMode mode = gate.getApprovalMode();

        if (requiresMember(mode)) {
            createRequestIfAbsent(gate, ROLE_MEMBER, title, description);
        }
        if (requiresCoach(mode)) {
            createRequestIfAbsent(gate, ROLE_COACH, title, description);
        }
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    /**
     * Core dispatch: if AUTO → clear gate immediately; otherwise create approval requests.
     */
    private GateStatus clearOrRequestApproval(PhaseGate gate, String title, String description) {
        if (gate.getApprovalMode() == GateApprovalMode.AUTO) {
            gate.setGateStatus(GateStatus.CLEARED);
            gate.setClearedAt(Instant.now());
            gateRepository.save(gate);
            auditService.log("GATE_CLEARED", "PhaseGate", gate.getId(),
                    gate.getPhase() + " gate auto-cleared");
            notifyGateChange(gate, "Phase " + gate.getPhase().name()
                    + " gate has been cleared. Your project is advancing to the next phase.");
            return GateStatus.CLEARED;
        }

        // Non-AUTO: create approval request(s) and keep gate PENDING
        createApprovalRequestsIfNeeded(gate, title, description);
        gateRepository.save(gate); // persist any blockedReason=null change
        return GateStatus.PENDING;
    }

    private void createRequestIfAbsent(PhaseGate gate, String role, String title, String description) {
        boolean exists = approvalRepository.existsByPhaseGateIdAndRequiredRoleAndApprovalStatus(
                gate.getId(), role, ApprovalStatus.PENDING);
        if (exists) return;

        ApprovalRequest req = new ApprovalRequest();
        req.setPhaseGate(gate);
        req.setProject(gate.getProject());
        req.setTenant(gate.getProject().getTenant());
        req.setGateType(gate.getPhase().name());
        req.setTitle(title);
        req.setDescription(description);
        req.setRequiredRole(role);
        req.setApprovalStatus(ApprovalStatus.PENDING);
        approvalRepository.save(req);
        log.info("ApprovalRequest created: project={} phase={} role={}",
                gate.getProject().getId(), gate.getPhase(), role);

        // Notify designated reviewer(s)
        UUID tenantId = gate.getProject().getTenant().getId();
        String projectName = gate.getProject().getName();
        String phase = gate.getPhase().name();
        if (ROLE_COACH.equals(role)) {
            assignmentRepository.findByTenantIdAndActiveTrue(tenantId).forEach(a -> {
                User coach = a.getPlatformUser();
                emailService.sendGateApprovalNotification(
                        coach.getEmail(), coach.getFirstName() + " " + coach.getLastName(),
                        projectName, phase, title, description);
            });
        } else if (ROLE_MEMBER.equals(role)) {
            userRepository.findByTenantIdAndRole(tenantId, UserRole.TENANT_ADMIN).forEach(u ->
                    emailService.sendGateApprovalNotification(
                            u.getEmail(), u.getFirstName() + " " + u.getLastName(),
                            projectName, phase, title, description));
        }
    }

    private void completeMigration(Project project) {
        project.setMigrationStatus(MigrationStatus.COMPLETED);
        projectRepository.save(project);
        auditService.log("PROJECT_COMPLETED", "Project", project.getId(),
                "CUT_OVER gate cleared — project marked COMPLETED");
        log.info("Project COMPLETED: project={}", project.getId());
        userRepository.findByTenantIdAndRole(project.getTenant().getId(), UserRole.TENANT_ADMIN)
                .forEach(u -> emailService.sendProjectCompletedNotification(
                        u.getEmail(), u.getFirstName() + " " + u.getLastName(), project.getName()));
    }

    /**
     * Sends a system message to the member's chat when a gate status changes.
     * Uses the project ID to find the linked conversation (Conversation.onboardingId = Project.id).
     */
    private void notifyGateChange(PhaseGate gate, String eventDescription) {
        if (chatService == null) return;
        try {
            UUID projectId = gate.getProject().getId();
            UUID convId = chatService.findConversationIdForOnboarding(projectId);
            if (convId == null) return;
            chatService.sendSystemMessage(convId, eventDescription);
        } catch (Exception e) {
            log.warn("Failed to send gate change chat notification: {}", e.getMessage());
        }
    }

    private static boolean requiresMember(GateApprovalMode mode) {
        return mode == GateApprovalMode.BOTH;
    }

    private static boolean requiresCoach(GateApprovalMode mode) {
        return mode == GateApprovalMode.COACH_ONLY || mode == GateApprovalMode.BOTH;
    }
}
