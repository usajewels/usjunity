package com.mxsuite.controller;

import com.mxsuite.audit.AuditService;
import com.mxsuite.model.ApprovalRequest;
import com.mxsuite.model.PhaseGate;
import com.mxsuite.model.enums.ApprovalStatus;
import com.mxsuite.model.enums.GateStatus;
import com.mxsuite.repository.ApprovalRequestRepository;
import com.mxsuite.repository.PhaseGateRepository;
import com.mxsuite.security.TenantContext;
import com.mxsuite.security.UserPrincipal;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/migration/approvals")
@Transactional(readOnly = true)
public class ApprovalController {

    private final ApprovalRequestRepository approvalRepository;
    private final PhaseGateRepository phaseGateRepository;
    private final AuditService auditService;

    public ApprovalController(ApprovalRequestRepository approvalRepository,
                               PhaseGateRepository phaseGateRepository,
                               AuditService auditService) {
        this.approvalRepository = approvalRepository;
        this.phaseGateRepository = phaseGateRepository;
        this.auditService = auditService;
    }

    // --- DTOs ---

    public record ApprovalDto(
            UUID id, UUID projectId, String projectName, UUID phaseGateId,
            String title, String description, String gateType,
            ApprovalStatus approvalStatus, String requiredRole,
            UUID assignedTo, UUID approvedBy, Instant approvedAt,
            String artifactRef, Instant createdAt) {}

    public record ApprovalStatsDto(long total, long pending, long approved, long rejected) {}

    // --- Endpoints ---

    @GetMapping
    public Page<ApprovalDto> list(@RequestParam(required = false) ApprovalStatus status, Pageable pageable) {
        UUID tenantId = TenantContext.getCurrentTenantId();
        Page<ApprovalRequest> page = status != null
                ? approvalRepository.findByTenantIdAndApprovalStatus(tenantId, status, pageable)
                : approvalRepository.findByTenantId(tenantId, pageable);
        return page.map(this::toDto);
    }

    @GetMapping("/project/{projectId}")
    public List<ApprovalDto> listByProject(@PathVariable UUID projectId) {
        return approvalRepository.findByProjectIdOrderByCreatedAtDesc(projectId)
                .stream().map(this::toDto).toList();
    }

    @PostMapping("/{id}/authorize")
    @Transactional
    public ResponseEntity<?> authorize(@PathVariable UUID id,
                                        @AuthenticationPrincipal UserPrincipal principal) {
        return approvalRepository.findById(id)
                .map(approval -> {
                    approval.setApprovalStatus(ApprovalStatus.APPROVED);
                    approval.setApprovedBy(principal.id());
                    approval.setApprovedAt(Instant.now());
                    approvalRepository.save(approval);

                    // Also clear the associated phase gate
                    PhaseGate gate = approval.getPhaseGate();
                    gate.setGateStatus(GateStatus.CLEARED);
                    gate.setClearedBy(principal.id());
                    gate.setClearedAt(Instant.now());
                    phaseGateRepository.save(gate);

                    auditService.log("AUTHORIZE", "ApprovalRequest", approval.getId(), approval.getTitle());
                    return ResponseEntity.ok(toDto(approval));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping("/{id}/reject")
    @Transactional
    public ResponseEntity<?> reject(@PathVariable UUID id,
                                     @RequestBody(required = false) RejectRequest request,
                                     @AuthenticationPrincipal UserPrincipal principal) {
        return approvalRepository.findById(id)
                .map(approval -> {
                    approval.setApprovalStatus(ApprovalStatus.REJECTED);
                    approvalRepository.save(approval);

                    // Block the associated phase gate
                    PhaseGate gate = approval.getPhaseGate();
                    gate.setGateStatus(GateStatus.BLOCKED);
                    if (request != null && request.reason() != null) {
                        gate.setBlockedReason(request.reason());
                    }
                    phaseGateRepository.save(gate);

                    auditService.log("REJECT", "ApprovalRequest", approval.getId(), approval.getTitle());
                    return ResponseEntity.ok(toDto(approval));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    public record RejectRequest(String reason) {}

    @GetMapping("/stats")
    public ApprovalStatsDto stats() {
        UUID tenantId = TenantContext.getCurrentTenantId();
        long pending = approvalRepository.countByTenantIdAndApprovalStatus(tenantId, ApprovalStatus.PENDING);
        long approved = approvalRepository.countByTenantIdAndApprovalStatus(tenantId, ApprovalStatus.APPROVED);
        long rejected = approvalRepository.countByTenantIdAndApprovalStatus(tenantId, ApprovalStatus.REJECTED);
        return new ApprovalStatsDto(pending + approved + rejected, pending, approved, rejected);
    }

    // --- Helpers ---

    private ApprovalDto toDto(ApprovalRequest a) {
        String projectName = a.getProject() != null ? a.getProject().getName() : null;
        UUID projectId = a.getProject() != null ? a.getProject().getId() : null;
        return new ApprovalDto(
                a.getId(), projectId, projectName, a.getPhaseGate().getId(),
                a.getTitle(), a.getDescription(), a.getGateType(),
                a.getApprovalStatus(), a.getRequiredRole(),
                a.getAssignedTo(), a.getApprovedBy(), a.getApprovedAt(),
                a.getArtifactRef(), a.getCreatedAt());
    }
}
