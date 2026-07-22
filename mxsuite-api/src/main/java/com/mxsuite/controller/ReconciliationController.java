package com.mxsuite.controller;

import com.mxsuite.audit.AuditService;
import com.mxsuite.model.ReconciliationReport;
import com.mxsuite.repository.ReconciliationReportRepository;
import com.mxsuite.security.UserPrincipal;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/migration/projects/{projectId}/reconciliation")
@Transactional(readOnly = true)
public class ReconciliationController {

    private final ReconciliationReportRepository reconRepository;
    private final AuditService auditService;

    public ReconciliationController(ReconciliationReportRepository reconRepository,
                                     AuditService auditService) {
        this.reconRepository = reconRepository;
        this.auditService = auditService;
    }

    // --- DTOs ---

    public record ReconReportDto(
            UUID id, UUID projectId, String overallStatus, int warningCount,
            boolean signedOff, String signerName, String signerRole, Instant signedAt,
            List<Map<String, Object>> tiers, List<Map<String, Object>> tableBreakdown,
            String warningDetail, Instant createdAt) {}

    public record SignOffRequest(String signerName, String signerRole) {}

    // --- Endpoints ---

    @GetMapping
    public List<ReconReportDto> list(@PathVariable UUID projectId) {
        return reconRepository.findByProjectIdOrderByCreatedAtDesc(projectId)
                .stream().map(this::toDto).toList();
    }

    @GetMapping("/latest")
    public ResponseEntity<ReconReportDto> latest(@PathVariable UUID projectId) {
        return reconRepository.findFirstByProjectIdOrderByCreatedAtDesc(projectId)
                .map(r -> ResponseEntity.ok(toDto(r)))
                .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/{id}")
    public ResponseEntity<ReconReportDto> get(@PathVariable UUID projectId, @PathVariable UUID id) {
        return reconRepository.findById(id)
                .map(r -> ResponseEntity.ok(toDto(r)))
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping("/{id}/sign-off")
    @Transactional
    @PreAuthorize("hasAnyRole('PLATFORM_ADMIN','PLATFORM_SUPPORT')")
    public ResponseEntity<?> signOff(@PathVariable UUID projectId,
                                      @PathVariable UUID id,
                                      @RequestBody SignOffRequest request,
                                      @AuthenticationPrincipal UserPrincipal principal) {
        return reconRepository.findById(id)
                .map(report -> {
                    report.setSignedOff(true);
                    report.setSignerName(request.signerName() != null ? request.signerName() : principal.getFullName());
                    report.setSignerRole(request.signerRole() != null ? request.signerRole() : principal.role().name());
                    report.setSignedAt(Instant.now());
                    reconRepository.save(report);
                    auditService.log("SIGN_OFF", "ReconciliationReport", report.getId(), "Signed off");
                    return ResponseEntity.ok(toDto(report));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    // --- Helpers ---

    private ReconReportDto toDto(ReconciliationReport r) {
        return new ReconReportDto(
                r.getId(), r.getProject().getId(), r.getOverallStatus(), r.getWarningCount(),
                r.isSignedOff(), r.getSignerName(), r.getSignerRole(), r.getSignedAt(),
                r.getTiers(), r.getTableBreakdown(), r.getWarningDetail(), r.getCreatedAt());
    }
}
