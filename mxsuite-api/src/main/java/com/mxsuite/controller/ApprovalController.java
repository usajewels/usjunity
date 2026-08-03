package com.mxsuite.controller;

import com.mxsuite.audit.AuditService;
import com.mxsuite.model.ApprovalRequest;
import com.mxsuite.model.PhaseGate;
import com.mxsuite.model.Tenant;
import com.mxsuite.model.enums.ApprovalStatus;
import com.mxsuite.model.enums.GateApprovalMode;
import com.mxsuite.model.enums.GateStatus;
import com.mxsuite.repository.ApprovalRequestRepository;
import com.mxsuite.repository.PhaseGateRepository;
import com.mxsuite.repository.PlatformAssignmentRepository;
import com.mxsuite.repository.TenantRepository;
import com.mxsuite.security.TenantContext;
import com.mxsuite.security.UserPrincipal;
import com.mxsuite.service.PhaseGateService;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.stream.Stream;

@RestController
@RequestMapping("/api/migration/approvals")
@Transactional(readOnly = true)
public class ApprovalController {

    private final ApprovalRequestRepository approvalRepository;
    private final PhaseGateRepository phaseGateRepository;
    private final PlatformAssignmentRepository assignmentRepository;
    private final TenantRepository tenantRepository;
    private final PhaseGateService phaseGateService;
    private final AuditService auditService;

    public ApprovalController(ApprovalRequestRepository approvalRepository,
                               PhaseGateRepository phaseGateRepository,
                               PlatformAssignmentRepository assignmentRepository,
                               TenantRepository tenantRepository,
                               PhaseGateService phaseGateService,
                               AuditService auditService) {
        this.approvalRepository = approvalRepository;
        this.phaseGateRepository = phaseGateRepository;
        this.assignmentRepository = assignmentRepository;
        this.tenantRepository = tenantRepository;
        this.phaseGateService = phaseGateService;
        this.auditService = auditService;
    }

    // --- DTOs ---

    public record ApprovalDto(
            UUID id, UUID projectId, String projectName, UUID phaseGateId,
            String title, String description, String gateType,
            ApprovalStatus approvalStatus, String requiredRole,
            GateApprovalMode gateApprovalMode,
            UUID assignedTo, UUID approvedBy, Instant approvedAt,
            String artifactRef, Instant createdAt) {}

    public record ApprovalStatsDto(long total, long pending, long approved, long rejected) {}

    // --- Endpoints ---

    @GetMapping
    public Page<ApprovalDto> list(
            @RequestParam(required = false) ApprovalStatus status,
            @RequestParam(required = false) String gateType,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String letter,
            @AuthenticationPrincipal UserPrincipal principal,
            Pageable pageable) {
        String searchParam = (search != null && !search.isBlank()) ? search.trim() : null;
        String letterParam = (letter != null && !letter.isBlank()) ? letter.trim().toLowerCase() : null;
        String gateTypeParam = (gateType != null && !gateType.isBlank()) ? gateType.trim() : null;
        boolean hasTextFilter = searchParam != null || letterParam != null || gateTypeParam != null;

        Page<ApprovalRequest> page;

        if (principal != null && principal.isPlatformAdmin()) {
            if (!hasTextFilter) {
                page = (status != null)
                        ? approvalRepository.findByApprovalStatus(status, pageable)
                        : approvalRepository.findAll(pageable);
            } else if (status != null) {
                page = approvalRepository.findAllFilteredWithStatus(status, gateTypeParam, searchParam, letterParam, pageable);
            } else {
                page = approvalRepository.findAllFilteredNoStatus(gateTypeParam, searchParam, letterParam, pageable);
            }
        } else if (principal != null && principal.isPlatformUser()) {
            List<UUID> tenantIds = visibleTenantIds(principal);
            if (tenantIds.isEmpty()) {
                page = Page.empty(pageable);
            } else if (!hasTextFilter) {
                page = (status != null)
                        ? approvalRepository.findByTenantIdInAndApprovalStatus(tenantIds, status, pageable)
                        : approvalRepository.findByTenantIdIn(tenantIds, pageable);
            } else if (status != null) {
                page = approvalRepository.findFilteredInTenantsWithStatus(tenantIds, status, gateTypeParam, searchParam, letterParam, pageable);
            } else {
                page = approvalRepository.findFilteredInTenantsNoStatus(tenantIds, gateTypeParam, searchParam, letterParam, pageable);
            }
        } else {
            UUID tenantId = TenantContext.getCurrentTenantId();
            if (!hasTextFilter) {
                page = (status != null)
                        ? approvalRepository.findByTenantIdAndApprovalStatus(tenantId, status, pageable)
                        : approvalRepository.findByTenantId(tenantId, pageable);
            } else if (status != null) {
                page = approvalRepository.findFilteredWithStatus(tenantId, status, gateTypeParam, searchParam, letterParam, pageable);
            } else {
                page = approvalRepository.findFilteredNoStatus(tenantId, gateTypeParam, searchParam, letterParam, pageable);
            }
        }
        return page.map(this::toDto);
    }

    @GetMapping("/project/{projectId}")
    public List<ApprovalDto> listByProject(@PathVariable UUID projectId) {
        return approvalRepository.findByProjectIdOrderByCreatedAtDesc(projectId)
                .stream().map(this::toDto).toList();
    }

    /**
     * Coach/admin authorization — marks the approval APPROVED and calls checkAndClearGate.
     * If all required approvals are now received the gate is set CLEARED.
     * If the gate is for CUT_OVER and clears, the project is marked COMPLETED.
     */
    @PostMapping("/{id}/authorize")
    @Transactional
    public ResponseEntity<?> authorize(@PathVariable UUID id,
                                        @AuthenticationPrincipal UserPrincipal principal) {
        return approvalRepository.findById(id)
                .map(approval -> {
                    if (approval.getApprovalStatus() != ApprovalStatus.PENDING) {
                        return ResponseEntity.badRequest()
                                .body(java.util.Map.of("message", "Approval is already " + approval.getApprovalStatus()));
                    }
                    approval.setApprovalStatus(ApprovalStatus.APPROVED);
                    approval.setApprovedBy(principal.id());
                    approval.setApprovedAt(Instant.now());
                    approvalRepository.save(approval);

                    PhaseGate gate = approval.getPhaseGate();
                    gate.setClearedBy(principal.id());
                    phaseGateService.checkAndClearGate(gate);

                    auditService.log("AUTHORIZE", "ApprovalRequest", approval.getId(), approval.getTitle());
                    return ResponseEntity.ok(toDto(approval));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * Member self-approval — TENANT_ADMIN approves their side of a gate.
     * Marks the TENANT_ADMIN approval request APPROVED and checks if the gate can now clear.
     */
    @PostMapping("/{id}/member-approve")
    @Transactional
    public ResponseEntity<?> memberApprove(@PathVariable UUID id,
                                            @AuthenticationPrincipal UserPrincipal principal) {
        return approvalRepository.findById(id)
                .map(approval -> {
                    // Only the tenant's own member can approve their side
                    if (approval.getTenant() == null
                            || !approval.getTenant().getId().equals(TenantContext.getCurrentTenantId())) {
                        return ResponseEntity.status(403)
                                .body(java.util.Map.of("message", "Not authorized to approve this request"));
                    }
                    if (!"TENANT_ADMIN".equals(approval.getRequiredRole())) {
                        return ResponseEntity.badRequest()
                                .body(java.util.Map.of("message", "This approval requires a coach, not a member"));
                    }
                    if (approval.getApprovalStatus() != ApprovalStatus.PENDING) {
                        return ResponseEntity.badRequest()
                                .body(java.util.Map.of("message", "Already " + approval.getApprovalStatus()));
                    }
                    approval.setApprovalStatus(ApprovalStatus.APPROVED);
                    approval.setApprovedBy(principal.id());
                    approval.setApprovedAt(Instant.now());
                    approvalRepository.save(approval);

                    PhaseGate gate = approval.getPhaseGate();
                    phaseGateService.checkAndClearGate(gate);

                    auditService.log("MEMBER_APPROVE", "ApprovalRequest", approval.getId(), approval.getTitle());
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
    public ApprovalStatsDto stats(@AuthenticationPrincipal UserPrincipal principal) {
        long pending, approved, rejected;
        if (principal != null && principal.isPlatformAdmin()) {
            pending = approvalRepository.countByApprovalStatus(ApprovalStatus.PENDING);
            approved = approvalRepository.countByApprovalStatus(ApprovalStatus.APPROVED);
            rejected = approvalRepository.countByApprovalStatus(ApprovalStatus.REJECTED);
        } else if (principal != null && principal.isPlatformUser()) {
            List<UUID> tenantIds = visibleTenantIds(principal);
            pending = tenantIds.isEmpty() ? 0 : approvalRepository.countByTenantIdInAndApprovalStatus(tenantIds, ApprovalStatus.PENDING);
            approved = tenantIds.isEmpty() ? 0 : approvalRepository.countByTenantIdInAndApprovalStatus(tenantIds, ApprovalStatus.APPROVED);
            rejected = tenantIds.isEmpty() ? 0 : approvalRepository.countByTenantIdInAndApprovalStatus(tenantIds, ApprovalStatus.REJECTED);
        } else {
            UUID tenantId = TenantContext.getCurrentTenantId();
            pending = approvalRepository.countByTenantIdAndApprovalStatus(tenantId, ApprovalStatus.PENDING);
            approved = approvalRepository.countByTenantIdAndApprovalStatus(tenantId, ApprovalStatus.APPROVED);
            rejected = approvalRepository.countByTenantIdAndApprovalStatus(tenantId, ApprovalStatus.REJECTED);
        }
        return new ApprovalStatsDto(pending + approved + rejected, pending, approved, rejected);
    }

    // --- Helpers ---

    private List<UUID> visibleTenantIds(UserPrincipal principal) {
        List<UUID> assigned = assignmentRepository.findByPlatformUserIdAndActiveTrue(principal.id())
                .stream().map(a -> a.getTenant().getId()).toList();
        List<UUID> openToAll = tenantRepository.findByOpenToAllCoachesTrue()
                .stream().map(Tenant::getId).toList();
        return Stream.concat(assigned.stream(), openToAll.stream())
                .distinct().toList();
    }

    private ApprovalDto toDto(ApprovalRequest a) {
        String projectName = a.getProject() != null ? a.getProject().getName() : null;
        UUID projectId = a.getProject() != null ? a.getProject().getId() : null;
        GateApprovalMode gateApprovalMode = a.getPhaseGate() != null
                ? a.getPhaseGate().getApprovalMode() : null;
        return new ApprovalDto(
                a.getId(), projectId, projectName, a.getPhaseGate() != null ? a.getPhaseGate().getId() : null,
                a.getTitle(), a.getDescription(), a.getGateType(),
                a.getApprovalStatus(), a.getRequiredRole(),
                gateApprovalMode,
                a.getAssignedTo(), a.getApprovedBy(), a.getApprovedAt(),
                a.getArtifactRef(), a.getCreatedAt());
    }
}
