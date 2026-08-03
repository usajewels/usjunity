package com.mxsuite.service;

import com.mxsuite.config.MssqlProperties;
import com.mxsuite.model.FieldMappingEntry;
import com.mxsuite.model.ProjectDataUpload;
import com.mxsuite.model.enums.MappingStatus;
import com.mxsuite.model.enums.UploadStatus;
import com.mxsuite.repository.FieldMappingEntryRepository;
import com.mxsuite.repository.ProjectDataUploadRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
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
import java.sql.*;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Transforms approved field mappings and writes the result to target-entity tables
 * in the SQL Server staging database. Reads the source CSV row by row, applies
 * type coercions defined on each mapping, and batch-inserts into per-entity tables:
 *
 *   [mxsuite_staging].[import_<uploadId>].[contact]
 *   [mxsuite_staging].[import_<uploadId>].[organization]
 *   ... one table per GrowthZone entity that has approved mappings
 *
 * SQL Server is optional — if {@code mxsuite.mssql.host} is not configured the
 * service falls back to count-only mode (progress still broadcast via WebSocket).
 */
@Service
public class BatchImportService {

    private static final Logger log = LoggerFactory.getLogger(BatchImportService.class);

    private static final int PROGRESS_BROADCAST_INTERVAL = 1000;
    private static final int DB_UPDATE_INTERVAL          = 5000;
    private static final int BATCH_SIZE                  = 500;

    // ---- Date formats (same set as DataValidationService) ----

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

    // ---- Core dependencies (always present) ----

    private final ProjectDataUploadRepository uploadRepository;
    private final FieldMappingEntryRepository mappingRepository;
    private final TargetSchemaService         targetSchemaService;
    private final SimpMessagingTemplate       messagingTemplate;

    // ---- Optional SQL Server (injected only when mssql.host is configured) ----

    private MssqlProperties mssqlProps;
    private JdbcTemplate    mssqlJdbc;

    // ---- Optional gate service (injected to avoid circular dep at startup) ----

    private PhaseGateService phaseGateService;

    public BatchImportService(ProjectDataUploadRepository uploadRepository,
                              FieldMappingEntryRepository mappingRepository,
                              TargetSchemaService targetSchemaService,
                              SimpMessagingTemplate messagingTemplate) {
        this.uploadRepository    = uploadRepository;
        this.mappingRepository   = mappingRepository;
        this.targetSchemaService = targetSchemaService;
        this.messagingTemplate   = messagingTemplate;
    }

    @Autowired(required = false)
    public void setMssqlProps(MssqlProperties mssqlProps) {
        this.mssqlProps = mssqlProps;
    }

    @Autowired(required = false)
    public void setMssqlJdbc(@Qualifier("mssqlJdbcTemplate") JdbcTemplate mssqlJdbc) {
        this.mssqlJdbc = mssqlJdbc;
    }

    @Autowired(required = false)
    public void setPhaseGateService(PhaseGateService phaseGateService) {
        this.phaseGateService = phaseGateService;
    }

    // =========================================================================
    // Public entry point
    // =========================================================================

    @Async("importExecutor")
    public void processImport(UUID projectId, UUID uploadId, UUID userId) {
        log.info("Starting batch import for project={} upload={}", projectId, uploadId);

        ProjectDataUpload upload = uploadRepository.findById(uploadId).orElse(null);
        if (upload == null) {
            log.error("Upload not found: {}", uploadId);
            return;
        }

        Path filePath = Paths.get(upload.getStoragePath());
        if (!Files.exists(filePath)) {
            updateStatus(upload, "FAILED", 0, 0, "File not found: " + filePath);
            broadcastProgress(userId, upload);
            return;
        }

        try (BufferedReader reader = Files.newBufferedReader(filePath, StandardCharsets.UTF_8)) {

            // 1. Read CSV header
            String headerLine = reader.readLine();
            if (headerLine == null) {
                updateStatus(upload, "FAILED", 0, 0, "File is empty");
                broadcastProgress(userId, upload);
                return;
            }
            List<String> headers = parseCsvLine(headerLine);

            // 2. Load mappings and build transform plan (buildTransformPlan filters to MAPPED only)
            List<FieldMappingEntry> allMappings = mappingRepository.findAllByProjectId(projectId);
            List<TransformRule> plan = buildTransformPlan(headers, allMappings);

            if (plan.isEmpty()) {
                log.warn("No approved mappings matched CSV headers for project={} — nothing to transform", projectId);
                updateStatus(upload, "COMPLETED", 100, 0, "No approved mappings found");
                upload.setUploadStatus(UploadStatus.COMPLETED);
                uploadRepository.save(upload);
                broadcastProgress(userId, upload);
                return;
            }

            // 3. Log plan summary
            log.info("Transform plan: {} rules across {} entities for project={}",
                    plan.size(), entityNames(plan).size(), projectId);

            // 4. Prepare target tables in SQL Server (conditional)
            String schemaName               = null;
            String dbName                   = null;
            Map<String, List<String>> entityFields = null;

            if (mssqlProps != null && mssqlJdbc != null) {
                dbName       = mssqlProps.stagingDatabase();
                schemaName   = "import_" + uploadId.toString().replace("-", "").substring(0, 12);
                entityFields = buildEntityFieldsMap(plan);

                ensureTargetSchema(dbName, schemaName);
                for (Map.Entry<String, List<String>> e : entityFields.entrySet()) {
                    ensureTargetTable(dbName, schemaName, e.getKey(), e.getValue());
                }
                log.info("Target schema [{}].[{}] ready — {} entity table(s)",
                        dbName, schemaName, entityFields.size());
            } else {
                log.info("SQL Server not configured — count-only mode for project={}", projectId);
            }

            // 5. Stream, transform, and buffer
            int totalRows     = upload.getRowCount() != null ? upload.getRowCount() : 0;
            int processedRows = 0;
            int errorCount    = 0;

            Map<String, List<Map<String, Object>>> buffers = new LinkedHashMap<>();

            String line;
            while ((line = reader.readLine()) != null) {
                if (line.isBlank()) continue;

                try {
                    List<String> values = parseCsvLine(line);
                    processedRows++;

                    if (schemaName != null) {
                        Map<String, Map<String, Object>> entityMap =
                                transformRow(values.toArray(new String[0]), plan, processedRows);

                        for (Map.Entry<String, Map<String, Object>> e : entityMap.entrySet()) {
                            buffers.computeIfAbsent(e.getKey(), k -> new ArrayList<>())
                                   .add(e.getValue());
                        }

                        // Flush full buffers
                        for (Map.Entry<String, List<Map<String, Object>>> buf : buffers.entrySet()) {
                            if (buf.getValue().size() >= BATCH_SIZE) {
                                List<String> fields = entityFields.get(buf.getKey());
                                errorCount += flushEntityBuffer(
                                        dbName, schemaName, buf.getKey(), buf.getValue(), fields);
                                buf.getValue().clear();
                            }
                        }
                    }

                } catch (Exception e) {
                    log.warn("Error on row {} for project={}: {}", processedRows, projectId, e.getMessage());
                    errorCount++;
                }

                // Broadcast progress
                if (processedRows % PROGRESS_BROADCAST_INTERVAL == 0) {
                    int pct = totalRows > 0 ? (int) ((long) processedRows * 100 / totalRows) : 0;
                    upload.setImportProgressPct(pct);
                    upload.setImportedRowCount(processedRows);
                    broadcastProgress(userId, upload);
                }

                // Persist progress
                if (processedRows % DB_UPDATE_INTERVAL == 0) {
                    int pct = totalRows > 0 ? (int) ((long) processedRows * 100 / totalRows) : 0;
                    updateStatus(upload, "PROCESSING", pct, processedRows, null);
                }
            }

            // 6. Final flush of remaining buffer contents
            if (schemaName != null) {
                for (Map.Entry<String, List<Map<String, Object>>> buf : buffers.entrySet()) {
                    if (!buf.getValue().isEmpty()) {
                        List<String> fields = entityFields.get(buf.getKey());
                        errorCount += flushEntityBuffer(
                                dbName, schemaName, buf.getKey(), buf.getValue(), fields);
                    }
                }
            }

            // 7. Final status
            String finalStatus = errorCount == 0 ? "COMPLETED" : "COMPLETED_WITH_ERRORS";
            String errorMsg    = errorCount > 0
                    ? "Imported " + processedRows + " rows; " + errorCount + " rows had errors"
                    : null;

            updateStatus(upload, finalStatus, 100, processedRows, errorMsg);
            upload.setUploadStatus(UploadStatus.COMPLETED);
            uploadRepository.save(upload);
            broadcastProgress(userId, upload);

            log.info("Batch import {} for project={}: {} rows, {} errors",
                    finalStatus, projectId, processedRows, errorCount);

            // Re-evaluate MIGRATE gate now that import status is known
            if (phaseGateService != null && "COMPLETED".equals(finalStatus)) {
                try {
                    phaseGateService.evaluateMigrateGate(projectId);
                } catch (Exception e) {
                    log.warn("Could not re-evaluate MIGRATE gate for project={}: {}", projectId, e.getMessage());
                }
            }

        } catch (IOException e) {
            log.error("Batch import failed for project={}: {}", projectId, e.getMessage(), e);
            ProjectDataUpload reload = uploadRepository.findById(uploadId).orElse(upload);
            updateStatus(reload, "FAILED", reload.getImportProgressPct(),
                    reload.getImportedRowCount(), e.getMessage());
            broadcastProgress(userId, reload);
        }
    }

    // =========================================================================
    // Transform plan
    // =========================================================================

    /**
     * Builds one TransformRule per MAPPED mapping whose source field matches a CSV header.
     * Filters out non-MAPPED entries, so the full mapping list may be passed.
     * Package-private for unit testing.
     */
    List<TransformRule> buildTransformPlan(List<String> headers, List<FieldMappingEntry> mappings) {
        // Resolve targetType: "Entity.field" → type string
        Map<String, String> typeLookup = new HashMap<>();
        for (Map<String, Object> field : targetSchemaService.getFlatFields()) {
            String key  = field.get("entity") + "." + field.get("name");
            String type = field.get("type") != null ? field.get("type").toString() : "string";
            typeLookup.put(key, type);
        }

        // Case-insensitive header → column index
        Map<String, Integer> headerIndex = new HashMap<>();
        for (int i = 0; i < headers.size(); i++) {
            headerIndex.put(headers.get(i).trim().toLowerCase(), i);
        }

        List<TransformRule> plan = new ArrayList<>();
        for (FieldMappingEntry m : mappings) {
            if (m.getMappingStatus() != MappingStatus.MAPPED) continue;
            if (m.getSourceField() == null || m.getTargetEntity() == null || m.getTargetField() == null) {
                continue;
            }
            Integer idx = headerIndex.get(m.getSourceField().trim().toLowerCase());
            if (idx == null) {
                log.debug("Source field '{}' not in CSV headers — skipping", m.getSourceField());
                continue;
            }
            String typeKey    = m.getTargetEntity() + "." + m.getTargetField();
            String targetType = typeLookup.getOrDefault(typeKey, "string");

            plan.add(new TransformRule(idx, m.getSourceField(),
                    m.getTargetEntity(), m.getTargetField(), targetType, m.getCoercion()));
        }
        return plan;
    }

    // =========================================================================
    // Row transformation
    // =========================================================================

    /**
     * Applies all transform rules to a single CSV row.
     * Returns entity → {field → coerced value}; skips blank/null results.
     * Package-private for unit testing.
     */
    Map<String, Map<String, Object>> transformRow(String[] values, List<TransformRule> plan, int sourceRow) {
        Map<String, Map<String, Object>> result = new LinkedHashMap<>();

        for (TransformRule rule : plan) {
            String raw     = rule.sourceColIdx < values.length ? values[rule.sourceColIdx].trim() : "";
            String coerced = applyCoercion(raw, rule.targetType, rule.coercion);
            if (coerced == null) continue;

            result.computeIfAbsent(rule.targetEntity, k -> new LinkedHashMap<>())
                  .put(rule.targetField, coerced);
        }

        // Tag every entity row with the source row number for traceability
        for (Map<String, Object> entityRow : result.values()) {
            entityRow.put("_mx_source_row", sourceRow);
        }

        return result;
    }

    /**
     * Coerces a raw string value based on a named coercion or the target type.
     * Returns {@code null} when the input is blank.
     * Package-private for unit testing.
     */
    String applyCoercion(String raw, String targetType, String coercion) {
        if (raw == null || raw.isBlank()) return null;

        // Named coercions override type-based logic
        if (coercion != null) {
            switch (coercion.toLowerCase()) {
                case "uppercase"         -> { return raw.trim().toUpperCase(); }
                case "lowercase"         -> { return raw.trim().toLowerCase(); }
                case "trim"              -> { return raw.trim(); }
                case "phone_digits_only" -> { return raw.replaceAll("[^\\d]", ""); }
                // Unknown named coercions fall through to type-based handling
            }
        }

        return switch (targetType == null ? "string" : targetType.toLowerCase()) {
            case "number"  -> normalizeNumber(raw);
            case "date"    -> normalizeDate(raw);
            case "boolean" -> normalizeBoolean(raw);
            default        -> raw.trim(); // "string"
        };
    }

    private String normalizeNumber(String raw) {
        String cleaned = raw.trim().replace("$", "").replace(",", "").replace(" ", "");
        try {
            Double.parseDouble(cleaned);
            return cleaned;
        } catch (NumberFormatException e) {
            return raw.trim(); // not numeric — return as-is
        }
    }

    private String normalizeDate(String raw) {
        String trimmed = raw.trim();
        for (DateTimeFormatter fmt : DATE_FORMATS) {
            try {
                return LocalDate.parse(trimmed, fmt).format(DateTimeFormatter.ISO_LOCAL_DATE);
            } catch (DateTimeParseException ignored) {}
        }
        try {
            return Instant.parse(trimmed).toString().substring(0, 10);
        } catch (DateTimeParseException ignored) {}
        return trimmed; // unparseable — keep original
    }

    private String normalizeBoolean(String raw) {
        return switch (raw.trim().toLowerCase()) {
            case "true", "yes", "1", "y", "on" -> "1";
            default                              -> "0";
        };
    }

    // =========================================================================
    // SQL Server target table helpers
    // =========================================================================

    private Map<String, List<String>> buildEntityFieldsMap(List<TransformRule> plan) {
        Map<String, LinkedHashSet<String>> sets = new LinkedHashMap<>();
        for (TransformRule rule : plan) {
            sets.computeIfAbsent(rule.targetEntity, k -> new LinkedHashSet<>())
                .add(rule.targetField);
        }
        Map<String, List<String>> result = new LinkedHashMap<>();
        sets.forEach((entity, fields) -> result.put(entity, new ArrayList<>(fields)));
        return result;
    }

    private void ensureTargetSchema(String dbName, String schemaName) {
        try (Connection conn = DriverManager.getConnection(
                mssqlProps.stagingJdbcUrl(), mssqlProps.username(), mssqlProps.password());
             Statement stmt = conn.createStatement()) {
            stmt.execute(
                    "IF NOT EXISTS (SELECT 1 FROM [" + dbName + "].sys.schemas "
                    + "WHERE name = '" + escapeSql(schemaName) + "') "
                    + "EXEC('CREATE SCHEMA [" + escapeSql(schemaName) + "]')");
        } catch (SQLException e) {
            throw new RuntimeException("Failed to create import schema: " + e.getMessage(), e);
        }
    }

    private void ensureTargetTable(String dbName, String schemaName,
                                    String entity, List<String> fields) {
        String tableName = entity.toLowerCase();
        StringBuilder ddl = new StringBuilder()
                .append("IF OBJECT_ID('[").append(dbName).append("].[").append(schemaName)
                .append("].[").append(tableName).append("]', 'U') IS NULL ")
                .append("CREATE TABLE [").append(dbName).append("].[").append(schemaName)
                .append("].[").append(tableName).append("] ([_mx_source_row] INT");
        for (String field : fields) {
            ddl.append(", [").append(sanitizeColumnName(field)).append("] NVARCHAR(MAX)");
        }
        ddl.append(")");

        try (Connection conn = DriverManager.getConnection(
                mssqlProps.stagingJdbcUrl(), mssqlProps.username(), mssqlProps.password());
             Statement stmt = conn.createStatement()) {
            stmt.execute(ddl.toString());
        } catch (SQLException e) {
            throw new RuntimeException(
                    "Failed to create target table [" + tableName + "]: " + e.getMessage(), e);
        }
    }

    /**
     * Batch-inserts a buffer of rows for one entity. Returns the count of rows that failed.
     */
    private int flushEntityBuffer(String dbName, String schemaName, String entity,
                                   List<Map<String, Object>> buffer, List<String> orderedFields) {
        if (buffer.isEmpty()) return 0;

        String tableName = entity.toLowerCase();
        StringBuilder sql = new StringBuilder()
                .append("INSERT INTO [").append(dbName).append("].[").append(schemaName)
                .append("].[").append(tableName).append("] ([_mx_source_row]");
        for (String field : orderedFields) {
            sql.append(", [").append(sanitizeColumnName(field)).append("]");
        }
        sql.append(") VALUES (?").append(", ?".repeat(orderedFields.size())).append(")");

        int errorCount = 0;
        try (Connection conn = DriverManager.getConnection(
                mssqlProps.stagingJdbcUrl(), mssqlProps.username(), mssqlProps.password());
             PreparedStatement ps = conn.prepareStatement(sql.toString())) {

            for (Map<String, Object> row : buffer) {
                try {
                    ps.setObject(1, row.get("_mx_source_row"));
                    for (int i = 0; i < orderedFields.size(); i++) {
                        Object val = row.get(orderedFields.get(i));
                        if (val == null) {
                            ps.setNull(i + 2, Types.NVARCHAR);
                        } else {
                            ps.setString(i + 2, val.toString());
                        }
                    }
                    ps.addBatch();
                } catch (SQLException e) {
                    log.warn("Failed to bind row for entity={}: {}", entity, e.getMessage());
                    errorCount++;
                }
            }
            ps.executeBatch();

        } catch (SQLException e) {
            log.warn("Batch INSERT failed for entity={}: {} ({} rows lost)",
                    entity, e.getMessage(), buffer.size());
            errorCount += buffer.size();
        }
        return errorCount;
    }

    // =========================================================================
    // Shared helpers
    // =========================================================================

    private Set<String> entityNames(List<TransformRule> plan) {
        return plan.stream().map(TransformRule::targetEntity).collect(Collectors.toSet());
    }

    /** RFC 4180-compliant CSV line parser — handles quoted fields and escaped quotes. */
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

    private String sanitizeColumnName(String name) {
        return name.replaceAll("[\\[\\]\"']", "").trim();
    }

    private String escapeSql(String value) {
        return value.replace("'", "''");
    }

    @Transactional
    protected void updateStatus(ProjectDataUpload upload, String status,
                                 int pct, int rowCount, String error) {
        upload.setImportStatus(status);
        upload.setImportProgressPct(pct);
        upload.setImportedRowCount(rowCount);
        upload.setImportError(error);
        uploadRepository.save(upload);
    }

    private void broadcastProgress(UUID userId, ProjectDataUpload upload) {
        try {
            Map<String, Object> payload = Map.of(
                    "status",           upload.getImportStatus() != null ? upload.getImportStatus() : "NONE",
                    "progressPct",      upload.getImportProgressPct() != null ? upload.getImportProgressPct() : 0,
                    "importedRowCount", upload.getImportedRowCount() != null ? upload.getImportedRowCount() : 0,
                    "totalRowCount",    upload.getRowCount() != null ? upload.getRowCount() : 0
            );
            messagingTemplate.convertAndSendToUser(
                    userId.toString(), "/queue/import-progress", payload);
        } catch (Exception e) {
            log.debug("Failed to broadcast import progress: {}", e.getMessage());
        }
    }

    // =========================================================================
    // Inner record
    // =========================================================================

    record TransformRule(
            int    sourceColIdx,
            String sourceField,
            String targetEntity,
            String targetField,
            String targetType,
            String coercion
    ) {}
}
