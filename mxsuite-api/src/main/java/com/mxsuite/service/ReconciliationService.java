package com.mxsuite.service;

import com.mxsuite.audit.AuditService;
import com.mxsuite.model.FieldMappingEntry;
import com.mxsuite.model.ReconciliationReport;
import com.mxsuite.model.ValidationRun;
import com.mxsuite.model.enums.MappingStatus;
import com.mxsuite.repository.FieldMappingEntryRepository;
import com.mxsuite.repository.ProjectRepository;
import com.mxsuite.repository.ReconciliationReportRepository;
import com.mxsuite.repository.ValidationIssueRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Generates ReconciliationReport records from completed validation runs.
 *
 * Report tiers:
 *   1. Row Count       — total rows scanned, valid/warning/error breakdown
 *   2. Data Quality    — overall quality percentage, pass/fail per threshold
 *   3. Field Coverage  — required target fields mapped vs unmapped
 *   4. Referential Int — FK integrity status from validation issues
 *
 * Table breakdown provides per-entity row counts and issue summaries.
 */
@Service
public class ReconciliationService {

    private static final Logger log = LoggerFactory.getLogger(ReconciliationService.class);

    private final ReconciliationReportRepository reconRepository;
    private final ValidationIssueRepository issueRepository;
    private final FieldMappingEntryRepository mappingRepository;
    private final ProjectRepository projectRepository;
    private final TargetSchemaService schemaService;
    private final AuditService auditService;

    public ReconciliationService(ReconciliationReportRepository reconRepository,
                                  ValidationIssueRepository issueRepository,
                                  FieldMappingEntryRepository mappingRepository,
                                  ProjectRepository projectRepository,
                                  TargetSchemaService schemaService,
                                  AuditService auditService) {
        this.reconRepository = reconRepository;
        this.issueRepository = issueRepository;
        this.mappingRepository = mappingRepository;
        this.projectRepository = projectRepository;
        this.schemaService = schemaService;
        this.auditService = auditService;
    }

    /**
     * Generate a reconciliation report from a completed validation run.
     */
    @Transactional
    public ReconciliationReport generateFromValidation(ValidationRun validationRun) {
        UUID projectId = validationRun.getProject().getId();
        log.info("Generating reconciliation report for project={} from validation run={}",
                projectId, validationRun.getId());

        // Build the 4-tier assessment
        List<Map<String, Object>> tiers = new ArrayList<>();
        tiers.add(buildRowCountTier(validationRun));
        tiers.add(buildDataQualityTier(validationRun));
        tiers.add(buildFieldCoverageTier(projectId));
        tiers.add(buildReferentialIntegrityTier(validationRun));

        // Build per-entity table breakdown
        List<Map<String, Object>> tableBreakdown = buildTableBreakdown(validationRun);

        // Determine overall status
        String overallStatus = determineOverallStatus(tiers);
        int warningCount = countWarnings(tiers);
        String warningDetail = buildWarningDetail(tiers, validationRun);

        // Create the report
        ReconciliationReport report = new ReconciliationReport();
        report.setProject(validationRun.getProject());
        report.setTenant(validationRun.getTenant());
        report.setOverallStatus(overallStatus);
        report.setWarningCount(warningCount);
        report.setTiers(tiers);
        report.setTableBreakdown(tableBreakdown);
        report.setWarningDetail(warningDetail);

        report = reconRepository.save(report);

        // Update project reconciliation percentage
        int totalRows = validationRun.getTotalRows();
        int validRows = validationRun.getValidRows();
        if (totalRows > 0) {
            BigDecimal pct = BigDecimal.valueOf(validRows)
                    .multiply(BigDecimal.valueOf(100))
                    .divide(BigDecimal.valueOf(totalRows), 2, RoundingMode.HALF_UP);
            var project = validationRun.getProject();
            project.setReconciliationPct(pct);
            projectRepository.save(project);
        }

        auditService.log("GENERATE_RECON", "ReconciliationReport", report.getId(),
                "Generated from validation — status: " + overallStatus);
        log.info("Reconciliation report created for project={}: status={}, warnings={}",
                projectId, overallStatus, warningCount);
        return report;
    }

    // ---- Tier builders ----

    private Map<String, Object> buildRowCountTier(ValidationRun run) {
        Map<String, Object> tier = new LinkedHashMap<>();
        tier.put("tier", 1);
        tier.put("name", "Row Count Verification");
        tier.put("totalRows", run.getTotalRows());
        tier.put("validRows", run.getValidRows());
        tier.put("warningRows", run.getWarningRows());
        tier.put("errorRows", run.getErrorRows());

        boolean pass = run.getErrorRows() == 0;
        tier.put("status", pass ? "PASS" : "FAIL");
        tier.put("detail", pass
                ? run.getTotalRows() + " rows scanned, all clean"
                : run.getErrorRows() + " of " + run.getTotalRows() + " rows have errors");
        return tier;
    }

    private Map<String, Object> buildDataQualityTier(ValidationRun run) {
        Map<String, Object> tier = new LinkedHashMap<>();
        tier.put("tier", 2);
        tier.put("name", "Data Quality Score");

        int total = run.getTotalRows();
        double qualityPct = total > 0
                ? (double) run.getValidRows() / total * 100.0
                : 100.0;
        tier.put("qualityPct", Math.round(qualityPct * 100.0) / 100.0);

        String status;
        if (qualityPct >= 100.0) {
            status = "PASS";
        } else if (qualityPct >= 95.0) {
            status = "WARN";
        } else {
            status = "FAIL";
        }
        tier.put("status", status);
        tier.put("detail", String.format("%.1f%% of rows are error-free", qualityPct));

        if (run.getWarningRows() > 0) {
            tier.put("warningNote", run.getWarningRows() + " row(s) have warnings that won't block import");
        }
        return tier;
    }

    private Map<String, Object> buildFieldCoverageTier(UUID projectId) {
        Map<String, Object> tier = new LinkedHashMap<>();
        tier.put("tier", 3);
        tier.put("name", "Field Coverage");

        // Get required target fields
        List<Map<String, Object>> flatFields = schemaService.getFlatFields();
        long totalRequired = flatFields.stream()
                .filter(f -> Boolean.TRUE.equals(f.get("required")))
                .count();

        // Get mapped target fields
        List<FieldMappingEntry> mappings = mappingRepository.findAllByProjectId(projectId);
        Set<String> mappedTargets = mappings.stream()
                .filter(m -> m.getMappingStatus() == MappingStatus.MAPPED)
                .filter(m -> m.getTargetEntity() != null && m.getTargetField() != null)
                .map(m -> m.getTargetEntity() + "." + m.getTargetField())
                .collect(Collectors.toSet());

        // Count entities that are actually in scope (have at least one mapping)
        Set<String> mappedEntities = mappings.stream()
                .filter(m -> m.getTargetEntity() != null && m.getMappingStatus() == MappingStatus.MAPPED)
                .map(FieldMappingEntry::getTargetEntity)
                .collect(Collectors.toSet());

        long requiredInScope = flatFields.stream()
                .filter(f -> Boolean.TRUE.equals(f.get("required")))
                .filter(f -> mappedEntities.contains(f.get("entity")))
                .count();

        long coveredRequired = flatFields.stream()
                .filter(f -> Boolean.TRUE.equals(f.get("required")))
                .filter(f -> mappedEntities.contains(f.get("entity")))
                .filter(f -> mappedTargets.contains(f.get("entity") + "." + f.get("name")))
                .count();

        tier.put("totalRequiredFields", totalRequired);
        tier.put("requiredFieldsInScope", requiredInScope);
        tier.put("coveredRequiredFields", coveredRequired);
        tier.put("mappedEntities", mappedEntities.size());

        boolean pass = coveredRequired >= requiredInScope;
        tier.put("status", pass ? "PASS" : "FAIL");
        tier.put("detail", pass
                ? "All " + requiredInScope + " required fields (in scope) are mapped"
                : (requiredInScope - coveredRequired) + " required field(s) have no mapping");
        return tier;
    }

    private Map<String, Object> buildReferentialIntegrityTier(ValidationRun run) {
        Map<String, Object> tier = new LinkedHashMap<>();
        tier.put("tier", 4);
        tier.put("name", "Referential Integrity");

        // Count FK_BROKEN issues from the validation run
        List<Object[]> byRule = issueRepository.countByRuleAndField(run.getId());
        long fkIssues = 0;
        for (Object[] row : byRule) {
            if ("FK_BROKEN".equals(row[0].toString())) {
                fkIssues += (Long) row[2];
            }
        }

        tier.put("fkIssues", fkIssues);
        String status = fkIssues == 0 ? "PASS" : (fkIssues <= 5 ? "WARN" : "FAIL");
        tier.put("status", status);
        tier.put("detail", fkIssues == 0
                ? "All foreign key references are valid"
                : fkIssues + " potential FK integrity issue(s) detected");
        return tier;
    }

    // ---- Table breakdown ----

    private List<Map<String, Object>> buildTableBreakdown(ValidationRun run) {
        List<Object[]> byEntity = issueRepository.countByEntityAndSeverity(run.getId());

        // Group by entity
        Map<String, Map<String, Long>> entityCounts = new LinkedHashMap<>();
        for (Object[] row : byEntity) {
            String entity = row[0] != null ? row[0].toString() : "Unknown";
            String severity = row[1].toString();
            long count = (Long) row[2];
            entityCounts.computeIfAbsent(entity, k -> new LinkedHashMap<>()).put(severity, count);
        }

        List<Map<String, Object>> breakdown = new ArrayList<>();
        for (var entry : entityCounts.entrySet()) {
            Map<String, Object> tableRow = new LinkedHashMap<>();
            tableRow.put("entity", entry.getKey());
            Map<String, Long> counts = entry.getValue();
            tableRow.put("errors", counts.getOrDefault("ERROR", 0L));
            tableRow.put("warnings", counts.getOrDefault("WARNING", 0L));
            tableRow.put("infos", counts.getOrDefault("INFO", 0L));
            tableRow.put("total", counts.values().stream().mapToLong(Long::longValue).sum());
            breakdown.add(tableRow);
        }
        return breakdown;
    }

    // ---- Status determination ----

    @SuppressWarnings("unchecked")
    private String determineOverallStatus(List<Map<String, Object>> tiers) {
        boolean anyFail = tiers.stream()
                .anyMatch(t -> "FAIL".equals(t.get("status")));
        boolean anyWarn = tiers.stream()
                .anyMatch(t -> "WARN".equals(t.get("status")));

        if (anyFail) return "FAIL";
        if (anyWarn) return "WARN";
        return "PASS";
    }

    private int countWarnings(List<Map<String, Object>> tiers) {
        return (int) tiers.stream()
                .filter(t -> "WARN".equals(t.get("status")) || "FAIL".equals(t.get("status")))
                .count();
    }

    private String buildWarningDetail(List<Map<String, Object>> tiers, ValidationRun run) {
        StringBuilder sb = new StringBuilder();
        for (Map<String, Object> tier : tiers) {
            String status = (String) tier.get("status");
            if (!"PASS".equals(status)) {
                sb.append("Tier ").append(tier.get("tier")).append(" (").append(tier.get("name"))
                        .append("): ").append(status).append(" — ").append(tier.get("detail"))
                        .append("\n");
            }
        }
        if (run.getWarningRows() > 0) {
            sb.append("\nNote: ").append(run.getWarningRows())
                    .append(" row(s) have warnings. These won't block import but should be reviewed.");
        }
        return sb.isEmpty() ? null : sb.toString().trim();
    }
}
