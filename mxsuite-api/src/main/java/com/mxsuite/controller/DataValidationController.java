package com.mxsuite.controller;

import com.mxsuite.audit.AuditService;
import com.mxsuite.model.ValidationIssue;
import com.mxsuite.model.ValidationRun;
import com.mxsuite.model.enums.ValidationSeverity;
import com.mxsuite.repository.ProjectRepository;
import com.mxsuite.repository.ValidationIssueRepository;
import com.mxsuite.repository.ValidationRunRepository;
import com.mxsuite.security.UserPrincipal;
import com.mxsuite.service.DataValidationService;
import com.mxsuite.service.NotificationService;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.*;

@RestController
@RequestMapping("/api/projects/{projectId}/validations")
@Transactional(readOnly = true)
public class DataValidationController {

    private final ValidationRunRepository runRepository;
    private final ValidationIssueRepository issueRepository;
    private final DataValidationService validationService;
    private final AuditService auditService;
    private final NotificationService notificationService;
    private final ProjectRepository projectRepository;

    public DataValidationController(ValidationRunRepository runRepository,
                                     ValidationIssueRepository issueRepository,
                                     DataValidationService validationService,
                                     AuditService auditService,
                                     NotificationService notificationService,
                                     ProjectRepository projectRepository) {
        this.runRepository = runRepository;
        this.issueRepository = issueRepository;
        this.validationService = validationService;
        this.auditService = auditService;
        this.notificationService = notificationService;
        this.projectRepository = projectRepository;
    }

    // --- DTOs ---

    public record ValidationRunDto(
            UUID id, UUID projectId, UUID uploadId, String status,
            Instant startedAt, Instant completedAt,
            int totalRows, int validRows, int warningRows, int errorRows,
            Map<String, Object> summary, Instant createdAt) {}

    public record TriggerRequest(UUID uploadId) {}

    public record ResolveRequest(String resolvedValue) {}

    public record BulkResolveRequest(List<UUID> issueIds, String resolvedValue) {}

    public record ValidationIssueDto(
            UUID id, int rowNumber, String sourceEntity, String targetEntity,
            String targetField, String sourceColumn, String currentValue,
            String severity, String ruleCode, String message,
            boolean resolved, String resolvedValue,
            String resolvedBy, String resolvedByName, Instant resolvedAt) {}

    public record EntitySummaryDto(String entity, long errors, long warnings, long infos, long total) {}

    public record RuleSummaryDto(String rule, String field, long count) {}

    // --- Endpoints ---

    @PostMapping
    @Transactional
    public ResponseEntity<Map<String, Object>> triggerValidation(
            @PathVariable UUID projectId,
            @RequestBody TriggerRequest request,
            @AuthenticationPrincipal UserPrincipal principal) {

        validationService.runValidation(projectId, request.uploadId(),
                principal.id(), principal.tenantId());

        return ResponseEntity.accepted().body(Map.of(
                "message", "Validation started",
                "projectId", projectId,
                "uploadId", request.uploadId()));
    }

    @GetMapping
    public List<ValidationRunDto> listRuns(@PathVariable UUID projectId) {
        return runRepository.findByProjectIdOrderByCreatedAtDesc(projectId)
                .stream().map(this::toRunDto).toList();
    }

    @GetMapping("/{runId}")
    public ResponseEntity<ValidationRunDto> getRun(@PathVariable UUID projectId,
                                                     @PathVariable UUID runId) {
        return runRepository.findById(runId)
                .map(r -> ResponseEntity.ok(toRunDto(r)))
                .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/latest")
    public ResponseEntity<ValidationRunDto> getLatest(@PathVariable UUID projectId) {
        return runRepository.findFirstByProjectIdOrderByCreatedAtDesc(projectId)
                .map(r -> ResponseEntity.ok(toRunDto(r)))
                .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/{runId}/issues")
    public Page<ValidationIssueDto> listIssues(
            @PathVariable UUID projectId,
            @PathVariable UUID runId,
            @RequestParam(required = false) String severity,
            @RequestParam(required = false) String entity,
            @RequestParam(required = false) Boolean resolved,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {

        var pageable = PageRequest.of(page, size, Sort.by("rowNumber"));

        if (severity != null && resolved != null) {
            return issueRepository.findByValidationRunIdAndSeverityAndResolved(
                    runId, ValidationSeverity.valueOf(severity.toUpperCase()),
                    resolved, pageable).map(this::toIssueDto);
        }
        if (severity != null) {
            return issueRepository.findByValidationRunIdAndSeverity(
                    runId, ValidationSeverity.valueOf(severity.toUpperCase()),
                    pageable).map(this::toIssueDto);
        }
        if (entity != null) {
            return issueRepository.findByValidationRunIdAndTargetEntity(
                    runId, entity, pageable).map(this::toIssueDto);
        }
        if (resolved != null) {
            return issueRepository.findByValidationRunIdAndResolved(
                    runId, resolved, pageable).map(this::toIssueDto);
        }

        return issueRepository.findByValidationRunId(runId, pageable).map(this::toIssueDto);
    }

    @GetMapping("/{runId}/issues/by-entity")
    public List<EntitySummaryDto> issuesByEntity(@PathVariable UUID projectId,
                                                   @PathVariable UUID runId) {
        List<Object[]> rows = issueRepository.countByEntityAndSeverity(runId);

        // Pivot: group by entity, sum by severity
        Map<String, long[]> map = new LinkedHashMap<>();
        for (Object[] row : rows) {
            String entity = row[0] != null ? row[0].toString() : "unknown";
            ValidationSeverity sev = (ValidationSeverity) row[1];
            long count = (Long) row[2];
            long[] counts = map.computeIfAbsent(entity, k -> new long[3]); // [errors, warnings, infos]
            switch (sev) {
                case ERROR -> counts[0] += count;
                case WARNING -> counts[1] += count;
                case INFO -> counts[2] += count;
            }
        }

        return map.entrySet().stream()
                .map(e -> new EntitySummaryDto(e.getKey(),
                        e.getValue()[0], e.getValue()[1], e.getValue()[2],
                        e.getValue()[0] + e.getValue()[1] + e.getValue()[2]))
                .toList();
    }

    @GetMapping("/{runId}/issues/by-rule")
    public List<RuleSummaryDto> issuesByRule(@PathVariable UUID projectId,
                                              @PathVariable UUID runId) {
        return issueRepository.countByRuleAndField(runId).stream()
                .map(row -> new RuleSummaryDto(
                        row[0].toString(),
                        row[1] != null ? row[1].toString() : null,
                        (Long) row[2]))
                .toList();
    }

    @PutMapping("/{runId}/issues/{issueId}/resolve")
    @Transactional
    public ResponseEntity<ValidationIssueDto> resolveIssue(
            @PathVariable UUID projectId,
            @PathVariable UUID runId,
            @PathVariable UUID issueId,
            @RequestBody ResolveRequest request,
            @AuthenticationPrincipal UserPrincipal principal) {

        return issueRepository.findById(issueId)
                .map(issue -> {
                    String beforeValue = issue.getResolvedValue();
                    issue.setResolved(true);
                    issue.setResolvedValue(request.resolvedValue());
                    issue.setResolvedBy(principal.id().toString());
                    issue.setResolvedByName(principal.getFullName());
                    issue.setResolvedAt(Instant.now());
                    issueRepository.save(issue);

                    auditService.log("DATA_CORRECTION", "ValidationIssue", issueId,
                            issue.getTargetField(),
                            beforeValue != null ? Map.of("value", beforeValue) : null,
                            Map.of("value", request.resolvedValue()));

                    // Notify the member
                    var project = projectRepository.findById(projectId).orElse(null);
                    if (project != null && project.getTenant() != null) {
                        notificationService.notifyDataCorrected(
                                project.getTenant().getId(), projectId, issueId,
                                issue.getTargetField(), request.resolvedValue(),
                                principal.getFullName(), true);
                    }

                    return ResponseEntity.ok(toIssueDto(issue));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @PutMapping("/{runId}/issues/bulk-resolve")
    @Transactional
    public ResponseEntity<Map<String, Object>> bulkResolve(
            @PathVariable UUID projectId,
            @PathVariable UUID runId,
            @RequestBody BulkResolveRequest request) {

        int resolved = 0;
        for (UUID issueId : request.issueIds()) {
            var opt = issueRepository.findById(issueId);
            if (opt.isPresent()) {
                var issue = opt.get();
                issue.setResolved(true);
                issue.setResolvedValue(request.resolvedValue());
                issueRepository.save(issue);
                resolved++;
            }
        }

        return ResponseEntity.ok(Map.of("resolved", resolved));
    }

    // --- Helpers ---

    private ValidationRunDto toRunDto(ValidationRun r) {
        return new ValidationRunDto(
                r.getId(),
                r.getProject().getId(),
                r.getUpload() != null ? r.getUpload().getId() : null,
                r.getStatus(),
                r.getStartedAt(), r.getCompletedAt(),
                r.getTotalRows(), r.getValidRows(),
                r.getWarningRows(), r.getErrorRows(),
                r.getSummaryJson(), r.getCreatedAt());
    }

    private ValidationIssueDto toIssueDto(ValidationIssue i) {
        return new ValidationIssueDto(
                i.getId(), i.getRowNumber(),
                i.getSourceEntity(), i.getTargetEntity(),
                i.getTargetField(), i.getSourceColumn(),
                i.getCurrentValue(), i.getSeverity().name(),
                i.getRuleCode().name(), i.getMessage(),
                i.isResolved(), i.getResolvedValue(),
                i.getResolvedBy(), i.getResolvedByName(), i.getResolvedAt());
    }
}
