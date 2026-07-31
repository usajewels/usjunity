package com.mxsuite.service;

import com.mxsuite.audit.AuditService;
import com.mxsuite.model.PhaseGate;
import com.mxsuite.model.ReconciliationReport;
import com.mxsuite.model.ValidationRun;
import com.mxsuite.model.enums.GateStatus;
import com.mxsuite.model.enums.MappingStatus;
import com.mxsuite.model.enums.MigrationPhase;
import com.mxsuite.repository.FieldMappingEntryRepository;
import com.mxsuite.repository.PhaseGateRepository;
import com.mxsuite.repository.ReconciliationReportRepository;
import com.mxsuite.repository.ValidationRunRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.UUID;

/**
 * Evaluates and updates PhaseGate statuses based on lifecycle conditions.
 *
 * Gate rules:
 *   MAP gate      → All mappings reviewed (none in NEEDS_REVIEW)
 *   GENERATE gate → Validation completed with zero ERROR-severity issues
 *   DRY_RUN gate  → Reconciliation report exists and is signed off
 */
@Service
public class PhaseGateService {

    private static final Logger log = LoggerFactory.getLogger(PhaseGateService.class);

    private final PhaseGateRepository gateRepository;
    private final ValidationRunRepository validationRunRepository;
    private final ReconciliationReportRepository reconRepository;
    private final FieldMappingEntryRepository mappingRepository;
    private final AuditService auditService;

    public PhaseGateService(PhaseGateRepository gateRepository,
                            ValidationRunRepository validationRunRepository,
                            ReconciliationReportRepository reconRepository,
                            FieldMappingEntryRepository mappingRepository,
                            AuditService auditService) {
        this.gateRepository = gateRepository;
        this.validationRunRepository = validationRunRepository;
        this.reconRepository = reconRepository;
        this.mappingRepository = mappingRepository;
        this.auditService = auditService;
    }

    /**
     * Evaluate the MAP phase gate.
     * Clears if all field mappings are reviewed (none left in NEEDS_REVIEW).
     */
    @Transactional
    public GateStatus evaluateMapGate(UUID projectId) {
        long needsReview = mappingRepository.countByProjectIdAndMappingStatus(
                projectId, MappingStatus.NEEDS_REVIEW);

        PhaseGate gate = gateRepository.findByProjectIdAndPhase(projectId, MigrationPhase.MAP)
                .orElse(null);
        if (gate == null) return GateStatus.PENDING;

        if (needsReview == 0) {
            gate.setGateStatus(GateStatus.CLEARED);
            gate.setClearedAt(Instant.now());
            gate.setBlockedReason(null);
            gateRepository.save(gate);
            auditService.log("GATE_CLEARED", "PhaseGate", gate.getId(),
                    "MAP gate cleared — all mappings reviewed");
            return GateStatus.CLEARED;
        } else {
            gate.setGateStatus(GateStatus.BLOCKED);
            gate.setBlockedReason(needsReview + " mapping(s) still need review");
            gateRepository.save(gate);
            return GateStatus.BLOCKED;
        }
    }

    /**
     * Evaluate the GENERATE phase gate based on validation results.
     * Clears if the latest validation run completed with zero errors.
     * Blocks if there are errors, or no validation has been run.
     */
    @Transactional
    public GateStatus evaluateGenerateGate(UUID projectId) {
        PhaseGate gate = gateRepository.findByProjectIdAndPhase(projectId, MigrationPhase.GENERATE)
                .orElse(null);
        if (gate == null) return GateStatus.PENDING;

        ValidationRun latestRun = validationRunRepository
                .findFirstByProjectIdOrderByCreatedAtDesc(projectId)
                .orElse(null);

        if (latestRun == null) {
            gate.setGateStatus(GateStatus.BLOCKED);
            gate.setBlockedReason("No validation has been run yet");
            gateRepository.save(gate);
            return GateStatus.BLOCKED;
        }

        if (!"COMPLETED".equals(latestRun.getStatus())) {
            gate.setGateStatus(GateStatus.BLOCKED);
            gate.setBlockedReason("Validation is still " + latestRun.getStatus());
            gateRepository.save(gate);
            return GateStatus.BLOCKED;
        }

        if (latestRun.getErrorRows() > 0) {
            gate.setGateStatus(GateStatus.BLOCKED);
            gate.setBlockedReason(latestRun.getErrorRows() + " row(s) have errors — "
                    + "fix issues in Data Health before proceeding");
            gateRepository.save(gate);
            return GateStatus.BLOCKED;
        }

        // Validation passed — zero errors
        gate.setGateStatus(GateStatus.CLEARED);
        gate.setClearedAt(Instant.now());
        gate.setBlockedReason(null);
        gateRepository.save(gate);
        auditService.log("GATE_CLEARED", "PhaseGate", gate.getId(),
                "GENERATE gate cleared — validation passed with 0 errors, "
                        + latestRun.getWarningRows() + " warning(s)");
        log.info("GENERATE gate cleared for project={}: {} rows validated, {} warnings",
                projectId, latestRun.getTotalRows(), latestRun.getWarningRows());
        return GateStatus.CLEARED;
    }

    /**
     * Evaluate the DRY_RUN phase gate based on reconciliation sign-off.
     * Clears if a signed-off reconciliation report exists.
     */
    @Transactional
    public GateStatus evaluateDryRunGate(UUID projectId) {
        PhaseGate gate = gateRepository.findByProjectIdAndPhase(projectId, MigrationPhase.DRY_RUN)
                .orElse(null);
        if (gate == null) return GateStatus.PENDING;

        ReconciliationReport latestRecon = reconRepository
                .findFirstByProjectIdOrderByCreatedAtDesc(projectId)
                .orElse(null);

        if (latestRecon == null) {
            gate.setGateStatus(GateStatus.BLOCKED);
            gate.setBlockedReason("No reconciliation report has been generated");
            gateRepository.save(gate);
            return GateStatus.BLOCKED;
        }

        if (!latestRecon.isSignedOff()) {
            gate.setGateStatus(GateStatus.BLOCKED);
            gate.setBlockedReason("Reconciliation report requires sign-off before proceeding");
            gateRepository.save(gate);
            return GateStatus.BLOCKED;
        }

        gate.setGateStatus(GateStatus.CLEARED);
        gate.setClearedAt(Instant.now());
        gate.setBlockedReason(null);
        gateRepository.save(gate);
        auditService.log("GATE_CLEARED", "PhaseGate", gate.getId(),
                "DRY_RUN gate cleared — reconciliation signed off");
        return GateStatus.CLEARED;
    }
}
