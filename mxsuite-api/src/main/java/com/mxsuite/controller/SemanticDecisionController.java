package com.mxsuite.controller;

import com.mxsuite.audit.AuditService;
import com.mxsuite.model.SemanticDecision;
import com.mxsuite.model.enums.DecisionStatus;
import com.mxsuite.repository.ProjectRepository;
import com.mxsuite.repository.SemanticDecisionRepository;
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

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/migration/decisions")
@Transactional(readOnly = true)
public class SemanticDecisionController {

    private final SemanticDecisionRepository decisionRepository;
    private final ProjectRepository projectRepository;
    private final TenantRepository tenantRepository;
    private final AuditService auditService;

    public SemanticDecisionController(SemanticDecisionRepository decisionRepository,
                                       ProjectRepository projectRepository,
                                       TenantRepository tenantRepository,
                                       AuditService auditService) {
        this.decisionRepository = decisionRepository;
        this.projectRepository = projectRepository;
        this.tenantRepository = tenantRepository;
        this.auditService = auditService;
    }

    // --- DTOs ---

    public record DecisionDto(
            UUID id, String title, String summary, UUID projectId, String projectName,
            String fieldContext, DecisionStatus decisionStatus, UUID ownerId, String ownerName,
            List<Map<String, Object>> options, Integer selectedOption,
            List<Map<String, Object>> requirements, Instant createdAt) {}

    public record DecisionStatsDto(long all, long open, long approved, long rejected) {}

    public record CreateDecisionRequest(
            String title, String summary, UUID projectId, String fieldContext,
            List<Map<String, Object>> options, List<Map<String, Object>> requirements) {}

    public record UpdateDecisionRequest(
            String title, String summary, String fieldContext,
            DecisionStatus decisionStatus, Integer selectedOption,
            List<Map<String, Object>> options, List<Map<String, Object>> requirements) {}

    // --- Endpoints ---

    @GetMapping
    public Page<DecisionDto> list(@RequestParam(required = false) DecisionStatus status, Pageable pageable) {
        UUID tenantId = TenantContext.getCurrentTenantId();
        Page<SemanticDecision> page = status != null
                ? decisionRepository.findByTenantIdAndDecisionStatus(tenantId, status, pageable)
                : decisionRepository.findByTenantId(tenantId, pageable);
        return page.map(this::toDto);
    }

    @GetMapping("/{id}")
    public ResponseEntity<DecisionDto> get(@PathVariable UUID id) {
        return decisionRepository.findById(id)
                .map(d -> ResponseEntity.ok(toDto(d)))
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping
    @Transactional
    @PreAuthorize("hasAnyRole('PLATFORM_ADMIN','COACH_ADMIN','PLATFORM_SUPPORT')")
    public ResponseEntity<DecisionDto> create(@RequestBody CreateDecisionRequest request,
                                               @AuthenticationPrincipal UserPrincipal principal) {
        UUID tenantId = TenantContext.getCurrentTenantId();
        var tenant = tenantRepository.findById(tenantId).orElseThrow();

        SemanticDecision decision = new SemanticDecision();
        decision.setTitle(request.title());
        decision.setSummary(request.summary());
        decision.setFieldContext(request.fieldContext());
        decision.setOptions(request.options());
        decision.setRequirements(request.requirements());
        decision.setOwnerId(principal.id());
        decision.setTenant(tenant);

        if (request.projectId() != null) {
            projectRepository.findById(request.projectId()).ifPresent(decision::setProject);
        }

        decision = decisionRepository.save(decision);
        auditService.log("CREATE", "SemanticDecision", decision.getId(), decision.getTitle());
        return ResponseEntity.ok(toDto(decision));
    }

    @PutMapping("/{id}")
    @Transactional
    public ResponseEntity<?> update(@PathVariable UUID id,
                                     @RequestBody UpdateDecisionRequest request,
                                     @AuthenticationPrincipal UserPrincipal principal) {
        return decisionRepository.findById(id)
                .map(decision -> {
                    if (principal.isPlatformUser()) {
                        if (request.title() != null) decision.setTitle(request.title());
                        if (request.summary() != null) decision.setSummary(request.summary());
                        if (request.fieldContext() != null) decision.setFieldContext(request.fieldContext());
                        if (request.options() != null) decision.setOptions(request.options());
                        if (request.requirements() != null) decision.setRequirements(request.requirements());
                    }
                    if (request.decisionStatus() != null) decision.setDecisionStatus(request.decisionStatus());
                    if (request.selectedOption() != null) decision.setSelectedOption(request.selectedOption());
                    decisionRepository.save(decision);
                    auditService.log("UPDATE", "SemanticDecision", decision.getId(), decision.getTitle());
                    return ResponseEntity.ok(toDto(decision));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping("/{id}/approve")
    @Transactional
    public ResponseEntity<?> approve(@PathVariable UUID id) {
        return decisionRepository.findById(id)
                .map(decision -> {
                    decision.setDecisionStatus(DecisionStatus.APPROVED);
                    decisionRepository.save(decision);
                    auditService.log("APPROVE", "SemanticDecision", decision.getId(), decision.getTitle());
                    return ResponseEntity.ok(toDto(decision));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping("/{id}/reject")
    @Transactional
    public ResponseEntity<?> reject(@PathVariable UUID id) {
        return decisionRepository.findById(id)
                .map(decision -> {
                    decision.setDecisionStatus(DecisionStatus.REJECTED);
                    decisionRepository.save(decision);
                    auditService.log("REJECT", "SemanticDecision", decision.getId(), decision.getTitle());
                    return ResponseEntity.ok(toDto(decision));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/stats")
    public DecisionStatsDto stats() {
        UUID tenantId = TenantContext.getCurrentTenantId();
        long open = decisionRepository.countByTenantIdAndDecisionStatus(tenantId, DecisionStatus.OPEN);
        long approved = decisionRepository.countByTenantIdAndDecisionStatus(tenantId, DecisionStatus.APPROVED);
        long rejected = decisionRepository.countByTenantIdAndDecisionStatus(tenantId, DecisionStatus.REJECTED);
        return new DecisionStatsDto(open + approved + rejected, open, approved, rejected);
    }

    // --- Helpers ---

    private DecisionDto toDto(SemanticDecision d) {
        String projectName = d.getProject() != null ? d.getProject().getName() : null;
        UUID projectId = d.getProject() != null ? d.getProject().getId() : null;
        return new DecisionDto(
                d.getId(), d.getTitle(), d.getSummary(), projectId, projectName,
                d.getFieldContext(), d.getDecisionStatus(), d.getOwnerId(), null,
                d.getOptions(), d.getSelectedOption(), d.getRequirements(), d.getCreatedAt());
    }
}
