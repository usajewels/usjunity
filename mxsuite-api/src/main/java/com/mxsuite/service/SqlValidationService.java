package com.mxsuite.service;

import com.mxsuite.config.MssqlProperties;
import com.mxsuite.model.FieldMappingEntry;
import com.mxsuite.model.ProjectDataUpload;
import com.mxsuite.model.ValidationIssue;
import com.mxsuite.model.ValidationRun;
import com.mxsuite.model.enums.MappingStatus;
import com.mxsuite.model.enums.ValidationRuleCode;
import com.mxsuite.model.enums.ValidationSeverity;
import com.mxsuite.repository.FieldMappingEntryRepository;
import com.mxsuite.repository.ValidationIssueRepository;
import com.mxsuite.repository.ValidationRunRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.*;

/**
 * Validates data staged in SQL Server using SQL queries instead of
 * line-by-line file streaming. Persists issues to PostgreSQL.
 */
@Service
@ConditionalOnExpression("'${mxsuite.mssql.host:}' != ''")
public class SqlValidationService {

    private static final Logger log = LoggerFactory.getLogger(SqlValidationService.class);
    private static final int BATCH_SIZE = 500;

    private static final Set<String> EMAIL_FIELD_NAMES = Set.of(
            "email", "email2", "orgemail", "contactemail", "primaryemail",
            "secondaryemail", "alternativeemail");
    private static final Set<String> PHONE_FIELD_NAMES = Set.of(
            "phone", "homephone", "mobilephone", "fax", "orgphone", "orgfax",
            "workphone", "cellphone");

    private final JdbcTemplate mssqlJdbc;
    private final MssqlProperties mssqlProps;
    private final FieldMappingEntryRepository mappingRepository;
    private final ValidationRunRepository runRepository;
    private final ValidationIssueRepository issueRepository;
    private final TargetSchemaService schemaService;
    private final SimpMessagingTemplate messagingTemplate;

    public SqlValidationService(@Qualifier("mssqlJdbcTemplate") JdbcTemplate mssqlJdbc,
                                 MssqlProperties mssqlProps,
                                 FieldMappingEntryRepository mappingRepository,
                                 ValidationRunRepository runRepository,
                                 ValidationIssueRepository issueRepository,
                                 TargetSchemaService schemaService,
                                 SimpMessagingTemplate messagingTemplate) {
        this.mssqlJdbc = mssqlJdbc;
        this.mssqlProps = mssqlProps;
        this.mappingRepository = mappingRepository;
        this.runRepository = runRepository;
        this.issueRepository = issueRepository;
        this.schemaService = schemaService;
        this.messagingTemplate = messagingTemplate;
    }

    /**
     * Run all validation rules against staging tables via SQL queries.
     * Updates the ValidationRun record and persists issues to PostgreSQL.
     */
    public void validateFromStaging(ValidationRun run, ProjectDataUpload upload,
                                     UUID projectId, UUID userId) {
        log.info("SQL validation starting for project={} upload={}", projectId, upload.getId());

        List<FieldMappingEntry> approvedMappings = mappingRepository.findAllByProjectId(projectId)
                .stream()
                .filter(m -> m.getMappingStatus() == MappingStatus.MAPPED)
                .toList();

        List<Map<String, Object>> flatFields = schemaService.getFlatFields();
        Map<String, Map<String, Object>> targetFieldLookup = new HashMap<>();
        for (Map<String, Object> field : flatFields) {
            targetFieldLookup.put(field.get("entity") + "." + field.get("name"), field);
        }

        String qualifiedTable = resolveQualifiedTable(upload);
        List<ValidationIssue> allIssues = new ArrayList<>();
        Set<Integer> rowsWithErrors = new HashSet<>();
        Set<Integer> rowsWithWarnings = new HashSet<>();

        // Get total row count from staging
        int totalRows = 0;
        try {
            Integer count = mssqlJdbc.queryForObject(
                    "SELECT COUNT(*) FROM " + qualifiedTable, Integer.class);
            totalRows = count != null ? count : 0;
        } catch (Exception e) {
            log.error("Could not count staging rows: {}", e.getMessage());
        }

        // Run each validation rule type via SQL
        for (FieldMappingEntry mapping : approvedMappings) {
            String sourceCol = mapping.getSourceField();
            String targetEntity = mapping.getTargetEntity();
            String targetField = mapping.getTargetField();
            String key = targetEntity + "." + targetField;
            Map<String, Object> targetDef = targetFieldLookup.get(key);

            if (targetDef == null) continue;

            String type = String.valueOf(targetDef.getOrDefault("type", "string"));
            boolean required = Boolean.TRUE.equals(targetDef.get("required"));
            String fieldLower = targetField != null ? targetField.toLowerCase() : "";

            // REQUIRED check
            if (required) {
                collectIssues(qualifiedTable, sourceCol, targetEntity, targetField,
                        ValidationRuleCode.REQUIRED, ValidationSeverity.ERROR,
                        "Required field is empty",
                        "WHERE [{col}] IS NULL OR LTRIM(RTRIM([{col}])) = ''",
                        run, allIssues, rowsWithErrors, rowsWithWarnings);
            }

            // TYPE_MISMATCH — number
            if ("number".equals(type) || "integer".equals(type)) {
                collectIssues(qualifiedTable, sourceCol, targetEntity, targetField,
                        ValidationRuleCode.TYPE_MISMATCH, ValidationSeverity.ERROR,
                        "Cannot convert to number",
                        "WHERE [{col}] IS NOT NULL AND LTRIM(RTRIM([{col}])) <> '' "
                                + "AND TRY_CAST(REPLACE(REPLACE([{col}], ',', ''), '$', '') AS FLOAT) IS NULL",
                        run, allIssues, rowsWithErrors, rowsWithWarnings);
            }

            // TYPE_MISMATCH — date
            if ("date".equals(type)) {
                collectIssues(qualifiedTable, sourceCol, targetEntity, targetField,
                        ValidationRuleCode.TYPE_MISMATCH, ValidationSeverity.ERROR,
                        "Cannot convert to date",
                        "WHERE [{col}] IS NOT NULL AND LTRIM(RTRIM([{col}])) <> '' "
                                + "AND TRY_CONVERT(DATE, [{col}]) IS NULL "
                                + "AND TRY_CONVERT(DATE, [{col}], 101) IS NULL "
                                + "AND TRY_CONVERT(DATE, [{col}], 103) IS NULL "
                                + "AND TRY_CONVERT(DATE, [{col}], 111) IS NULL",
                        run, allIssues, rowsWithErrors, rowsWithWarnings);
            }

            // TYPE_MISMATCH — boolean
            if ("boolean".equals(type)) {
                collectIssues(qualifiedTable, sourceCol, targetEntity, targetField,
                        ValidationRuleCode.TYPE_MISMATCH, ValidationSeverity.ERROR,
                        "Cannot convert to boolean",
                        "WHERE [{col}] IS NOT NULL AND LTRIM(RTRIM([{col}])) <> '' "
                                + "AND LOWER(LTRIM(RTRIM([{col}]))) NOT IN "
                                + "('true','false','yes','no','1','0','t','f','y','n')",
                        run, allIssues, rowsWithErrors, rowsWithWarnings);
            }

            // FORMAT_EMAIL
            if (EMAIL_FIELD_NAMES.contains(fieldLower)) {
                collectIssues(qualifiedTable, sourceCol, targetEntity, targetField,
                        ValidationRuleCode.FORMAT_EMAIL, ValidationSeverity.WARNING,
                        "Invalid email format",
                        "WHERE [{col}] IS NOT NULL AND LTRIM(RTRIM([{col}])) <> '' "
                                + "AND [{col}] NOT LIKE '%_@_%.__%'",
                        run, allIssues, rowsWithErrors, rowsWithWarnings);
            }

            // FORMAT_PHONE
            if (PHONE_FIELD_NAMES.contains(fieldLower)) {
                collectIssues(qualifiedTable, sourceCol, targetEntity, targetField,
                        ValidationRuleCode.FORMAT_PHONE, ValidationSeverity.WARNING,
                        "Invalid phone format",
                        "WHERE [{col}] IS NOT NULL AND LTRIM(RTRIM([{col}])) <> '' "
                                + "AND (LEN([{col}]) < 7 OR LEN([{col}]) > 25)",
                        run, allIssues, rowsWithErrors, rowsWithWarnings);
            }

            // Flush in batches
            if (allIssues.size() >= BATCH_SIZE) {
                persistIssues(allIssues);
                allIssues.clear();
            }
        }

        // DUPLICATE detection on sourceId fields
        for (FieldMappingEntry mapping : approvedMappings) {
            String targetField = mapping.getTargetField();
            if (targetField != null && targetField.toLowerCase().contains("sourceid")) {
                checkDuplicates(qualifiedTable, mapping.getSourceField(),
                        mapping.getTargetEntity(), targetField,
                        run, allIssues, rowsWithErrors, rowsWithWarnings);
            }
        }

        // Check UNMAPPED_REQUIRED
        checkUnmappedRequired(run, approvedMappings, flatFields, allIssues);

        // Flush remaining issues
        if (!allIssues.isEmpty()) {
            persistIssues(allIssues);
        }

        // Update run with final counts
        run.setTotalRows(totalRows);
        run.setErrorRows(rowsWithErrors.size());
        run.setWarningRows(rowsWithWarnings.size());
        run.setValidRows(totalRows - rowsWithErrors.size() - rowsWithWarnings.size());
        run.setStatus("COMPLETED");
        run.setCompletedAt(Instant.now());
        runRepository.save(run);

        broadcastProgress(userId, run);
        log.info("SQL validation completed for project={}: {} total, {} errors, {} warnings",
                projectId, totalRows, rowsWithErrors.size(), rowsWithWarnings.size());
    }

    // ---- Issue collection via SQL ----

    private void collectIssues(String qualifiedTable, String sourceCol,
                                String targetEntity, String targetField,
                                ValidationRuleCode ruleCode, ValidationSeverity severity,
                                String message, String whereClause,
                                ValidationRun run, List<ValidationIssue> issues,
                                Set<Integer> rowsWithErrors, Set<Integer> rowsWithWarnings) {
        String safCol = sanitizeColumnName(sourceCol);
        String sql = "SELECT [_mx_row_number], [" + safCol + "] FROM " + qualifiedTable
                + " " + whereClause.replace("{col}", safCol);

        try {
            mssqlJdbc.query(sql, rs -> {
                int rowNum = rs.getInt("_mx_row_number");
                String value = rs.getString(2);

                ValidationIssue issue = new ValidationIssue();
                issue.setValidationRun(run);
                issue.setRowNumber(rowNum);
                issue.setTargetEntity(targetEntity);
                issue.setTargetField(targetField);
                issue.setSourceColumn(sourceCol);
                issue.setCurrentValue(value);
                issue.setSeverity(severity);
                issue.setRuleCode(ruleCode);
                issue.setMessage(message);
                issues.add(issue);

                if (severity == ValidationSeverity.ERROR) {
                    rowsWithErrors.add(rowNum);
                } else {
                    rowsWithWarnings.add(rowNum);
                }
            });
        } catch (Exception e) {
            log.warn("SQL validation query failed for column [{}]: {}", sourceCol, e.getMessage());
        }
    }

    private void checkDuplicates(String qualifiedTable, String sourceCol,
                                  String targetEntity, String targetField,
                                  ValidationRun run, List<ValidationIssue> issues,
                                  Set<Integer> rowsWithErrors, Set<Integer> rowsWithWarnings) {
        String safCol = sanitizeColumnName(sourceCol);
        String sql = "SELECT [" + safCol + "], COUNT(*) as cnt, "
                + "STRING_AGG(CAST([_mx_row_number] AS VARCHAR), ',') as row_numbers "
                + "FROM " + qualifiedTable
                + " WHERE [" + safCol + "] IS NOT NULL AND LTRIM(RTRIM([" + safCol + "])) <> '' "
                + "GROUP BY [" + safCol + "] HAVING COUNT(*) > 1";

        try {
            mssqlJdbc.query(sql, rs -> {
                String value = rs.getString(1);
                String rowNumbers = rs.getString("row_numbers");
                if (rowNumbers != null) {
                    for (String rowStr : rowNumbers.split(",")) {
                        int rowNum = Integer.parseInt(rowStr.trim());
                        ValidationIssue issue = new ValidationIssue();
                        issue.setValidationRun(run);
                        issue.setRowNumber(rowNum);
                        issue.setTargetEntity(targetEntity);
                        issue.setTargetField(targetField);
                        issue.setSourceColumn(sourceCol);
                        issue.setCurrentValue(value);
                        issue.setSeverity(ValidationSeverity.WARNING);
                        issue.setRuleCode(ValidationRuleCode.DUPLICATE);
                        issue.setMessage("Duplicate value: " + value);
                        issues.add(issue);
                        rowsWithWarnings.add(rowNum);
                    }
                }
            });
        } catch (Exception e) {
            log.warn("Duplicate check SQL failed for [{}]: {}", sourceCol, e.getMessage());
        }
    }

    private void checkUnmappedRequired(ValidationRun run, List<FieldMappingEntry> approvedMappings,
                                        List<Map<String, Object>> flatFields, List<ValidationIssue> issues) {
        // Find which target entities have at least one mapping
        Set<String> mappedEntities = new HashSet<>();
        for (FieldMappingEntry m : approvedMappings) {
            if (m.getTargetEntity() != null) mappedEntities.add(m.getTargetEntity());
        }

        Set<String> mappedKeys = new HashSet<>();
        for (FieldMappingEntry m : approvedMappings) {
            if (m.getTargetEntity() != null && m.getTargetField() != null) {
                mappedKeys.add(m.getTargetEntity() + "." + m.getTargetField());
            }
        }

        for (Map<String, Object> field : flatFields) {
            String entity = String.valueOf(field.get("entity"));
            String name = String.valueOf(field.get("name"));
            boolean required = Boolean.TRUE.equals(field.get("required"));

            if (required && mappedEntities.contains(entity) && !mappedKeys.contains(entity + "." + name)) {
                ValidationIssue issue = new ValidationIssue();
                issue.setValidationRun(run);
                issue.setRowNumber(0); // schema-level issue
                issue.setTargetEntity(entity);
                issue.setTargetField(name);
                issue.setSeverity(ValidationSeverity.ERROR);
                issue.setRuleCode(ValidationRuleCode.UNMAPPED_REQUIRED);
                issue.setMessage("Required target field '" + entity + "." + name + "' has no source mapping");
                issues.add(issue);
            }
        }
    }

    // ---- Helpers ----

    private String resolveQualifiedTable(ProjectDataUpload upload) {
        String dbName = upload.getStagingDbName();
        String schemaName = upload.getStagingSchemaName();

        if (schemaName != null) {
            // CSV/Excel: staging database with schema
            return "[" + dbName + "].[" + schemaName + "].[data]";
        } else {
            // BAK: temp database with dbo schema — caller must specify table
            // For BAK files with multiple tables, we validate per table
            // Default to first table for now
            return "[" + dbName + "].[dbo].[data]";
        }
    }

    @Transactional
    protected void persistIssues(List<ValidationIssue> issues) {
        issueRepository.saveAll(new ArrayList<>(issues));
    }

    private String sanitizeColumnName(String name) {
        return name.replaceAll("[\\[\\]\"']", "").trim();
    }

    private void broadcastProgress(UUID userId, ValidationRun run) {
        if (userId == null) return;
        Map<String, Object> payload = Map.of(
                "runId", run.getId().toString(),
                "status", run.getStatus(),
                "totalRows", run.getTotalRows(),
                "errorRows", run.getErrorRows(),
                "warningRows", run.getWarningRows()
        );
        messagingTemplate.convertAndSendToUser(
                userId.toString(), "/queue/validation-progress", payload);
    }
}
