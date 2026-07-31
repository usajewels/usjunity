package com.mxsuite.service;

import com.mxsuite.model.FieldMappingEntry;
import com.mxsuite.model.ProjectDataUpload;
import com.mxsuite.model.ValidationIssue;
import com.mxsuite.model.ValidationRun;
import com.mxsuite.model.enums.MappingStatus;
import com.mxsuite.model.enums.ValidationRuleCode;
import com.mxsuite.model.enums.ValidationSeverity;
import com.mxsuite.repository.FieldMappingEntryRepository;
import com.mxsuite.repository.ProjectDataUploadRepository;
import com.mxsuite.repository.ValidationIssueRepository;
import com.mxsuite.repository.ValidationRunRepository;
import com.mxsuite.security.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.BufferedReader;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.*;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

@Service
public class DataValidationService {

    private static final Logger log = LoggerFactory.getLogger(DataValidationService.class);
    private static final int BATCH_SIZE = 500;
    private static final int PROGRESS_INTERVAL = 1000;

    private static final Pattern EMAIL_PATTERN =
            Pattern.compile("^[A-Za-z0-9+_.-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$");
    private static final Pattern PHONE_PATTERN =
            Pattern.compile("^[\\d()\\s.+\\-x#]{7,25}$");

    private static final Set<String> EMAIL_FIELD_NAMES = Set.of(
            "email", "email2", "orgemail", "contactemail", "primaryemail",
            "secondaryemail", "alternativeemail");
    private static final Set<String> PHONE_FIELD_NAMES = Set.of(
            "phone", "homephone", "mobilephone", "fax", "orgphone", "orgfax",
            "workphone", "cellphone");

    private static final List<DateTimeFormatter> DATE_FORMATS = List.of(
            DateTimeFormatter.ISO_LOCAL_DATE,
            DateTimeFormatter.ofPattern("M/d/yyyy"),
            DateTimeFormatter.ofPattern("MM/dd/yyyy"),
            DateTimeFormatter.ofPattern("M-d-yyyy"),
            DateTimeFormatter.ofPattern("MM-dd-yyyy"),
            DateTimeFormatter.ofPattern("d/M/yyyy"),
            DateTimeFormatter.ofPattern("dd/MM/yyyy"),
            DateTimeFormatter.ofPattern("yyyy/MM/dd"),
            DateTimeFormatter.ofPattern("MMM d, yyyy"),
            DateTimeFormatter.ofPattern("MMMM d, yyyy")
    );

    private final ValidationRunRepository runRepository;
    private final ValidationIssueRepository issueRepository;
    private final FieldMappingEntryRepository mappingRepository;
    private final ProjectDataUploadRepository uploadRepository;
    private final TargetSchemaService schemaService;
    private final FileParsingService fileParsingService;
    private final SimpMessagingTemplate messagingTemplate;
    private final PhaseGateService phaseGateService;
    private final ReconciliationService reconciliationService;
    private final AiDecisionService aiDecisionService;
    private SqlValidationService sqlValidationService;

    public DataValidationService(ValidationRunRepository runRepository,
                                  ValidationIssueRepository issueRepository,
                                  FieldMappingEntryRepository mappingRepository,
                                  ProjectDataUploadRepository uploadRepository,
                                  TargetSchemaService schemaService,
                                  FileParsingService fileParsingService,
                                  SimpMessagingTemplate messagingTemplate,
                                  PhaseGateService phaseGateService,
                                  ReconciliationService reconciliationService,
                                  AiDecisionService aiDecisionService) {
        this.runRepository = runRepository;
        this.issueRepository = issueRepository;
        this.mappingRepository = mappingRepository;
        this.uploadRepository = uploadRepository;
        this.schemaService = schemaService;
        this.fileParsingService = fileParsingService;
        this.messagingTemplate = messagingTemplate;
        this.phaseGateService = phaseGateService;
        this.reconciliationService = reconciliationService;
        this.aiDecisionService = aiDecisionService;
    }

    @Autowired(required = false)
    public void setSqlValidationService(SqlValidationService sqlValidationService) {
        this.sqlValidationService = sqlValidationService;
    }

    // ---- Internal rule model ----

    record ValidationRule(
            String sourceColumn,
            int sourceColumnIndex,
            String targetEntity,
            String targetField,
            String targetType,
            boolean required,
            ValidationRuleCode ruleCode,
            ValidationSeverity severity
    ) {}

    // ---- Public entry point ----

    @Async("validationExecutor")
    public void runValidation(UUID projectId, UUID uploadId, UUID userId, UUID tenantId) {
        log.info("Starting validation for project={} upload={}", projectId, uploadId);

        ProjectDataUpload upload = uploadRepository.findById(uploadId).orElse(null);
        if (upload == null) {
            log.error("Upload not found: {}", uploadId);
            return;
        }

        // Create the validation run record
        ValidationRun run = new ValidationRun();
        run.setProject(upload.getProject());
        run.setUpload(upload);
        run.setTriggeredBy(userId);
        run.setStatus("RUNNING");
        run.setStartedAt(Instant.now());
        // Set tenant via reflection since we need it for the FK
        run.setTenant(upload.getProject().getTenant());
        run = runRepository.save(run);

        try {
            executeValidation(run, upload, projectId, userId);
        } catch (Exception e) {
            log.error("Validation failed for project={}: {}", projectId, e.getMessage(), e);
            run.setStatus("FAILED");
            run.setCompletedAt(Instant.now());
            runRepository.save(run);
            broadcastProgress(userId, run);
        }
    }

    // ---- Core validation logic ----

    private void executeValidation(ValidationRun run, ProjectDataUpload upload,
                                    UUID projectId, UUID userId) throws IOException {
        // Route to SQL-based validation when data is staged in SQL Server
        if ("STAGED".equals(upload.getStagingStatus()) && sqlValidationService != null) {
            log.info("Using SQL-based validation for staged upload {}", upload.getId());
            sqlValidationService.validateFromStaging(run, upload, projectId, userId);
            runPostValidationHooks(run, userId);
            return;
        }

        // Fallback: file-based validation
        // 1. Load approved field mappings
        List<FieldMappingEntry> allMappings = mappingRepository.findAllByProjectId(projectId);
        List<FieldMappingEntry> approvedMappings = allMappings.stream()
                .filter(m -> m.getMappingStatus() == MappingStatus.MAPPED)
                .toList();

        // 2. Load target schema fields
        List<Map<String, Object>> flatFields = schemaService.getFlatFields();
        Map<String, Map<String, Object>> targetFieldLookup = new HashMap<>();
        for (Map<String, Object> field : flatFields) {
            String key = field.get("entity") + "." + field.get("name");
            targetFieldLookup.put(key, field);
        }

        // 3. Read the CSV/Excel headers
        Path filePath = Paths.get(upload.getStoragePath());
        if (!Files.exists(filePath)) {
            run.setStatus("FAILED");
            run.setCompletedAt(Instant.now());
            runRepository.save(run);
            return;
        }

        String filename = filePath.getFileName().toString().toLowerCase();
        boolean isExcel = filename.endsWith(".xlsx") || filename.endsWith(".xls");

        List<String> headers;
        if (isExcel) {
            var result = fileParsingService.parseExcelSheetByName(filePath, upload.getSheetName());
            headers = result.headers();
        } else {
            try (BufferedReader reader = Files.newBufferedReader(filePath, StandardCharsets.UTF_8)) {
                String headerLine = reader.readLine();
                headers = headerLine != null ? parseCsvLine(headerLine) : List.of();
            }
        }

        // 4. Build rules from mappings + schema
        List<ValidationRule> rules = buildRules(approvedMappings, targetFieldLookup, headers);

        // 5. Check for UNMAPPED_REQUIRED — required target fields with no mapping
        List<ValidationIssue> unmappedIssues = checkUnmappedRequired(
                run, approvedMappings, flatFields);

        // 6. Stream through data and validate each row
        List<ValidationIssue> allIssues = new ArrayList<>(unmappedIssues);
        Set<Integer> rowsWithErrors = new HashSet<>();
        Set<Integer> rowsWithWarnings = new HashSet<>();
        int totalRows = 0;

        // Collect sourceId values per entity for FK checks later
        Map<String, Set<String>> sourceIdSets = new HashMap<>();

        if (isExcel) {
            // For Excel, re-parse to get all rows
            var result = fileParsingService.parseExcelSheetByName(filePath, upload.getSheetName());
            // We only have sample rows from parsing — need to stream the full file
            // For now, use the total row count and validate what we can
            totalRows = result.totalRows();
            // Excel full-row streaming would require Apache POI streaming API
            // For MVP, validate sample rows and report total coverage
            for (int i = 0; i < result.sampleRows().size(); i++) {
                List<String> row = result.sampleRows().get(i);
                String[] values = row.toArray(new String[0]);
                var rowIssues = validateRow(run, values, headers, rules, i + 1);
                allIssues.addAll(rowIssues);
                categorizeRow(rowIssues, i + 1, rowsWithErrors, rowsWithWarnings);
            }
        } else {
            // CSV: stream line by line
            try (BufferedReader reader = Files.newBufferedReader(filePath, StandardCharsets.UTF_8)) {
                reader.readLine(); // skip header
                String line;
                while ((line = reader.readLine()) != null) {
                    if (line.isBlank()) continue;
                    totalRows++;

                    List<String> parsedValues = parseCsvLine(line);
                    String[] values = parsedValues.toArray(new String[0]);

                    var rowIssues = validateRow(run, values, headers, rules, totalRows);
                    allIssues.addAll(rowIssues);
                    categorizeRow(rowIssues, totalRows, rowsWithErrors, rowsWithWarnings);

                    // Collect sourceIds for FK checks
                    collectSourceIds(values, headers, approvedMappings, sourceIdSets);

                    // Batch-persist issues
                    if (allIssues.size() >= BATCH_SIZE) {
                        persistIssues(allIssues);
                        allIssues.clear();
                    }

                    // Broadcast progress
                    if (totalRows % PROGRESS_INTERVAL == 0) {
                        broadcastValidationProgress(userId, run, totalRows,
                                upload.getRowCount() != null ? upload.getRowCount() : 0);
                    }
                }
            }
        }

        // 7. Check referential integrity across entities
        var fkIssues = checkReferentialIntegrity(run, approvedMappings,
                targetFieldLookup, sourceIdSets, totalRows);
        allIssues.addAll(fkIssues);

        // 8. Check for duplicates on identifiedBy fields
        var dupIssues = checkDuplicates(run, filePath, upload.getSheetName(),
                headers, approvedMappings, isExcel);
        allIssues.addAll(dupIssues);

        // Persist remaining issues
        if (!allIssues.isEmpty()) {
            persistIssues(allIssues);
        }

        // 9. Update run with final counts
        run.setTotalRows(totalRows);
        run.setErrorRows(rowsWithErrors.size());
        run.setWarningRows(rowsWithWarnings.size());
        run.setValidRows(totalRows - rowsWithErrors.size() - rowsWithWarnings.size());
        run.setStatus("COMPLETED");
        run.setCompletedAt(Instant.now());
        run.setSummaryJson(buildSummary(run.getId()));
        runRepository.save(run);

        broadcastProgress(userId, run);
        log.info("Validation completed for project={}: {} total, {} errors, {} warnings",
                run.getProject().getId(), totalRows, rowsWithErrors.size(), rowsWithWarnings.size());

        runPostValidationHooks(run, userId);
    }

    /** Post-validation hooks shared by file-based and SQL-based paths. */
    void runPostValidationHooks(ValidationRun run, UUID userId) {
        try {
            phaseGateService.evaluateGenerateGate(run.getProject().getId());
            reconciliationService.generateFromValidation(run);
            aiDecisionService.generateDecisions(run);
        } catch (Exception e) {
            log.warn("Post-validation hooks failed for project={}: {}",
                    run.getProject().getId(), e.getMessage(), e);
        }
    }

    // ---- Rule building ----

    private List<ValidationRule> buildRules(List<FieldMappingEntry> mappings,
                                             Map<String, Map<String, Object>> targetFieldLookup,
                                             List<String> headers) {
        List<ValidationRule> rules = new ArrayList<>();

        for (FieldMappingEntry mapping : mappings) {
            if (mapping.getTargetEntity() == null || mapping.getTargetField() == null) continue;

            String key = mapping.getTargetEntity() + "." + mapping.getTargetField();
            Map<String, Object> targetField = targetFieldLookup.get(key);
            if (targetField == null) continue;

            int colIndex = findColumnIndex(headers, mapping.getSourceField());
            if (colIndex < 0) continue;

            boolean required = Boolean.TRUE.equals(targetField.get("required"));
            String type = (String) targetField.getOrDefault("type", "string");

            // REQUIRED check
            if (required) {
                rules.add(new ValidationRule(
                        mapping.getSourceField(), colIndex,
                        mapping.getTargetEntity(), mapping.getTargetField(),
                        type, true,
                        ValidationRuleCode.REQUIRED, ValidationSeverity.ERROR));
            }

            // TYPE_MISMATCH check for non-string types
            if (!"string".equals(type)) {
                rules.add(new ValidationRule(
                        mapping.getSourceField(), colIndex,
                        mapping.getTargetEntity(), mapping.getTargetField(),
                        type, required,
                        ValidationRuleCode.TYPE_MISMATCH, ValidationSeverity.ERROR));
            }

            // FORMAT checks based on field name
            String fieldLower = mapping.getTargetField().toLowerCase();
            if (EMAIL_FIELD_NAMES.contains(fieldLower)) {
                rules.add(new ValidationRule(
                        mapping.getSourceField(), colIndex,
                        mapping.getTargetEntity(), mapping.getTargetField(),
                        type, required,
                        ValidationRuleCode.FORMAT_EMAIL, ValidationSeverity.WARNING));
            }
            if (PHONE_FIELD_NAMES.contains(fieldLower)) {
                rules.add(new ValidationRule(
                        mapping.getSourceField(), colIndex,
                        mapping.getTargetEntity(), mapping.getTargetField(),
                        type, required,
                        ValidationRuleCode.FORMAT_PHONE, ValidationSeverity.WARNING));
            }
        }

        return rules;
    }

    // ---- Row validation ----

    private List<ValidationIssue> validateRow(ValidationRun run, String[] values,
                                               List<String> headers,
                                               List<ValidationRule> rules, int rowNumber) {
        List<ValidationIssue> issues = new ArrayList<>();

        for (ValidationRule rule : rules) {
            String value = rule.sourceColumnIndex < values.length
                    ? values[rule.sourceColumnIndex].trim() : "";
            boolean isEmpty = value.isEmpty();

            switch (rule.ruleCode) {
                case REQUIRED -> {
                    if (isEmpty) {
                        issues.add(createIssue(run, rowNumber, rule, value,
                                rule.targetField + " is required but missing"));
                    }
                }
                case TYPE_MISMATCH -> {
                    if (!isEmpty && !isValidType(value, rule.targetType)) {
                        issues.add(createIssue(run, rowNumber, rule, value,
                                "\"" + value + "\" cannot be converted to " + rule.targetType));
                    }
                }
                case FORMAT_EMAIL -> {
                    if (!isEmpty && !EMAIL_PATTERN.matcher(value).matches()) {
                        issues.add(createIssue(run, rowNumber, rule, value,
                                "\"" + value + "\" is not a valid email address"));
                    }
                }
                case FORMAT_PHONE -> {
                    if (!isEmpty && !PHONE_PATTERN.matcher(value).matches()) {
                        issues.add(createIssue(run, rowNumber, rule, value,
                                "\"" + value + "\" does not look like a phone number"));
                    }
                }
                default -> {}
            }
        }

        return issues;
    }

    // ---- Type validation ----

    private boolean isValidType(String value, String targetType) {
        return switch (targetType) {
            case "number" -> isNumeric(value);
            case "date" -> isValidDate(value);
            case "boolean" -> isValidBoolean(value);
            default -> true; // string always valid
        };
    }

    private boolean isNumeric(String value) {
        try {
            Double.parseDouble(value.replace(",", "").replace("$", "").trim());
            return true;
        } catch (NumberFormatException e) {
            return false;
        }
    }

    private boolean isValidDate(String value) {
        for (DateTimeFormatter fmt : DATE_FORMATS) {
            try {
                LocalDate.parse(value.trim(), fmt);
                return true;
            } catch (DateTimeParseException ignored) {}
        }
        // Try ISO datetime (includes time component)
        try {
            Instant.parse(value.trim());
            return true;
        } catch (DateTimeParseException ignored) {}
        return false;
    }

    private boolean isValidBoolean(String value) {
        String lower = value.toLowerCase().trim();
        return Set.of("true", "false", "yes", "no", "1", "0", "y", "n", "t", "f").contains(lower);
    }

    // ---- Unmapped required fields ----

    private List<ValidationIssue> checkUnmappedRequired(ValidationRun run,
                                                          List<FieldMappingEntry> mappings,
                                                          List<Map<String, Object>> flatFields) {
        // Collect all mapped target fields
        Set<String> mappedTargets = mappings.stream()
                .filter(m -> m.getTargetEntity() != null && m.getTargetField() != null)
                .map(m -> m.getTargetEntity() + "." + m.getTargetField())
                .collect(Collectors.toSet());

        // Find entities that have at least one mapping (only check those entities)
        Set<String> mappedEntities = mappings.stream()
                .filter(m -> m.getTargetEntity() != null)
                .map(FieldMappingEntry::getTargetEntity)
                .collect(Collectors.toSet());

        List<ValidationIssue> issues = new ArrayList<>();
        for (Map<String, Object> field : flatFields) {
            String entity = (String) field.get("entity");
            String name = (String) field.get("name");
            boolean required = Boolean.TRUE.equals(field.get("required"));

            if (required && mappedEntities.contains(entity) && !mappedTargets.contains(entity + "." + name)) {
                ValidationIssue issue = new ValidationIssue();
                issue.setValidationRun(run);
                issue.setRowNumber(0); // row 0 = schema-level issue
                issue.setTargetEntity(entity);
                issue.setTargetField(name);
                issue.setSeverity(ValidationSeverity.ERROR);
                issue.setRuleCode(ValidationRuleCode.UNMAPPED_REQUIRED);
                issue.setMessage(entity + "." + name + " is required by GrowthZone but has no source column mapped to it");
                issues.add(issue);
            }
        }
        return issues;
    }

    // ---- Referential integrity ----

    private void collectSourceIds(String[] values, List<String> headers,
                                   List<FieldMappingEntry> mappings,
                                   Map<String, Set<String>> sourceIdSets) {
        for (FieldMappingEntry mapping : mappings) {
            if (mapping.getTargetField() == null) continue;
            // Collect values for identifiedBy fields (sourceId, orgSourceId, etc.)
            if (mapping.getTargetField().toLowerCase().endsWith("sourceid")
                    || mapping.getTargetField().equals("sourceId")) {
                int idx = findColumnIndex(headers, mapping.getSourceField());
                if (idx >= 0 && idx < values.length) {
                    String val = values[idx].trim();
                    if (!val.isEmpty()) {
                        sourceIdSets.computeIfAbsent(
                                mapping.getTargetEntity() + "." + mapping.getTargetField(),
                                k -> new HashSet<>()
                        ).add(val);
                    }
                }
            }
        }
    }

    @SuppressWarnings("unchecked")
    private List<ValidationIssue> checkReferentialIntegrity(ValidationRun run,
                                                              List<FieldMappingEntry> mappings,
                                                              Map<String, Map<String, Object>> targetFieldLookup,
                                                              Map<String, Set<String>> sourceIdSets,
                                                              int totalRows) {
        // For now, produce INFO-level issues noting FK fields that should be checked
        // Full FK validation requires cross-upload scanning which will be enhanced later
        List<ValidationIssue> issues = new ArrayList<>();

        // Check schema references
        Map<String, Object> schema = schemaService.getHierarchicalSchema();
        var entities = (Map<String, Object>) schema.get("entities");
        if (entities == null) return issues;

        for (var entry : entities.entrySet()) {
            var entityDef = (Map<String, Object>) entry.getValue();
            checkEntityReferences(run, entityDef, mappings, sourceIdSets, issues);
            // Check children too
            var children = (Map<String, Object>) entityDef.get("children");
            if (children != null) {
                for (var child : children.values()) {
                    checkEntityReferences(run, (Map<String, Object>) child,
                            mappings, sourceIdSets, issues);
                }
            }
        }

        return issues;
    }

    @SuppressWarnings("unchecked")
    private void checkEntityReferences(ValidationRun run,
                                        Map<String, Object> entityDef,
                                        List<FieldMappingEntry> mappings,
                                        Map<String, Set<String>> sourceIdSets,
                                        List<ValidationIssue> issues) {
        var references = (Map<String, Object>) entityDef.get("references");
        if (references == null) return;

        for (var ref : references.entrySet()) {
            var refDef = (Map<String, Object>) ref.getValue();
            String refEntity = (String) refDef.get("entity");
            String refField = (String) refDef.get("field");
            boolean required = Boolean.TRUE.equals(refDef.get("required"));

            if (required) {
                // Check if the referenced entity's sourceIds are available
                String refKey = refEntity + "." + refField;
                if (!sourceIdSets.containsKey(refKey)) {
                    ValidationIssue issue = new ValidationIssue();
                    issue.setValidationRun(run);
                    issue.setRowNumber(0);
                    issue.setTargetEntity(ref.getKey());
                    issue.setTargetField(ref.getKey());
                    issue.setSeverity(ValidationSeverity.INFO);
                    issue.setRuleCode(ValidationRuleCode.FK_BROKEN);
                    issue.setMessage("References " + refEntity + "." + refField
                            + " — ensure " + refEntity + " data is uploaded so FK integrity can be verified");
                    issues.add(issue);
                }
            }
        }
    }

    // ---- Duplicate detection ----

    private List<ValidationIssue> checkDuplicates(ValidationRun run, Path filePath,
                                                    String sheetName, List<String> headers,
                                                    List<FieldMappingEntry> mappings,
                                                    boolean isExcel) {
        List<ValidationIssue> issues = new ArrayList<>();

        // Find sourceId-type fields to check for duplicates
        for (FieldMappingEntry mapping : mappings) {
            if (mapping.getTargetField() == null) continue;
            if (!mapping.getTargetField().toLowerCase().contains("sourceid")) continue;

            int colIdx = findColumnIndex(headers, mapping.getSourceField());
            if (colIdx < 0) continue;

            // Scan file for duplicate values in this column
            Map<String, List<Integer>> valuesToRows = new HashMap<>();
            try {
                if (!isExcel) {
                    try (BufferedReader reader = Files.newBufferedReader(filePath, StandardCharsets.UTF_8)) {
                        reader.readLine(); // skip header
                        String line;
                        int row = 0;
                        while ((line = reader.readLine()) != null) {
                            if (line.isBlank()) continue;
                            row++;
                            List<String> values = parseCsvLine(line);
                            if (colIdx < values.size()) {
                                String val = values.get(colIdx).trim();
                                if (!val.isEmpty()) {
                                    valuesToRows.computeIfAbsent(val, k -> new ArrayList<>()).add(row);
                                }
                            }
                        }
                    }
                }

                // Report duplicates
                for (var entry : valuesToRows.entrySet()) {
                    if (entry.getValue().size() > 1) {
                        // Report on the second and subsequent occurrences
                        for (int i = 1; i < entry.getValue().size(); i++) {
                            ValidationIssue issue = new ValidationIssue();
                            issue.setValidationRun(run);
                            issue.setRowNumber(entry.getValue().get(i));
                            issue.setTargetEntity(mapping.getTargetEntity());
                            issue.setTargetField(mapping.getTargetField());
                            issue.setSourceColumn(mapping.getSourceField());
                            issue.setCurrentValue(entry.getKey());
                            issue.setSeverity(ValidationSeverity.WARNING);
                            issue.setRuleCode(ValidationRuleCode.DUPLICATE);
                            issue.setMessage("Duplicate " + mapping.getTargetField()
                                    + " \"" + entry.getKey() + "\" — also on row "
                                    + entry.getValue().get(0));
                            issues.add(issue);
                        }
                    }
                }
            } catch (IOException e) {
                log.warn("Could not scan for duplicates in column {}: {}", mapping.getSourceField(), e.getMessage());
            }
        }

        return issues;
    }

    // ---- Helpers ----

    private ValidationIssue createIssue(ValidationRun run, int rowNumber,
                                         ValidationRule rule, String value, String message) {
        ValidationIssue issue = new ValidationIssue();
        issue.setValidationRun(run);
        issue.setRowNumber(rowNumber);
        issue.setTargetEntity(rule.targetEntity);
        issue.setTargetField(rule.targetField);
        issue.setSourceColumn(rule.sourceColumn);
        issue.setCurrentValue(value.isEmpty() ? null : value);
        issue.setSeverity(rule.severity);
        issue.setRuleCode(rule.ruleCode);
        issue.setMessage(message);
        return issue;
    }

    private void categorizeRow(List<ValidationIssue> rowIssues, int rowNumber,
                                Set<Integer> rowsWithErrors, Set<Integer> rowsWithWarnings) {
        for (ValidationIssue issue : rowIssues) {
            if (issue.getSeverity() == ValidationSeverity.ERROR) {
                rowsWithErrors.add(rowNumber);
                return;
            }
            if (issue.getSeverity() == ValidationSeverity.WARNING) {
                rowsWithWarnings.add(rowNumber);
            }
        }
    }

    @Transactional
    protected void persistIssues(List<ValidationIssue> issues) {
        issueRepository.saveAll(issues);
    }

    private int findColumnIndex(List<String> headers, String columnName) {
        for (int i = 0; i < headers.size(); i++) {
            if (headers.get(i).equalsIgnoreCase(columnName)) return i;
        }
        return -1;
    }

    private Map<String, Object> buildSummary(UUID runId) {
        Map<String, Object> summary = new LinkedHashMap<>();

        // By entity
        List<Object[]> byEntity = issueRepository.countByEntityAndSeverity(runId);
        Map<String, Map<String, Long>> entityMap = new LinkedHashMap<>();
        for (Object[] row : byEntity) {
            String entity = row[0] != null ? row[0].toString() : "unknown";
            String severity = row[1].toString();
            long count = (Long) row[2];
            entityMap.computeIfAbsent(entity, k -> new LinkedHashMap<>()).put(severity, count);
        }
        summary.put("byEntity", entityMap);

        // By rule
        List<Object[]> byRule = issueRepository.countByRuleAndField(runId);
        List<Map<String, Object>> ruleList = new ArrayList<>();
        for (Object[] row : byRule) {
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("rule", row[0].toString());
            entry.put("field", row[1] != null ? row[1].toString() : null);
            entry.put("count", row[2]);
            ruleList.add(entry);
        }
        summary.put("byRule", ruleList);

        return summary;
    }

    private List<String> parseCsvLine(String line) {
        List<String> fields = new ArrayList<>();
        boolean inQuotes = false;
        StringBuilder current = new StringBuilder();

        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (c == '"') {
                if (inQuotes && i + 1 < line.length() && line.charAt(i + 1) == '"') {
                    current.append('"');
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (c == ',' && !inQuotes) {
                fields.add(current.toString());
                current = new StringBuilder();
            } else {
                current.append(c);
            }
        }
        fields.add(current.toString());
        return fields;
    }

    // ---- WebSocket broadcasting ----

    private void broadcastValidationProgress(UUID userId, ValidationRun run,
                                              int processedRows, int totalRows) {
        try {
            int pct = totalRows > 0 ? (int) ((long) processedRows * 100 / totalRows) : 0;
            messagingTemplate.convertAndSendToUser(
                    userId.toString(), "/queue/validation-progress",
                    Map.of("runId", run.getId(),
                            "status", "RUNNING",
                            "progressPct", pct,
                            "processedRows", processedRows,
                            "totalRows", totalRows));
        } catch (Exception e) {
            log.debug("Failed to broadcast validation progress: {}", e.getMessage());
        }
    }

    private void broadcastProgress(UUID userId, ValidationRun run) {
        try {
            messagingTemplate.convertAndSendToUser(
                    userId.toString(), "/queue/validation-progress",
                    Map.of("runId", run.getId(),
                            "status", run.getStatus(),
                            "totalRows", run.getTotalRows(),
                            "validRows", run.getValidRows(),
                            "warningRows", run.getWarningRows(),
                            "errorRows", run.getErrorRows()));
        } catch (Exception e) {
            log.debug("Failed to broadcast validation progress: {}", e.getMessage());
        }
    }
}
