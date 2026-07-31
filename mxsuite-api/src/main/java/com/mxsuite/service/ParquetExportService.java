package com.mxsuite.service;

import com.mxsuite.config.MssqlProperties;
import com.mxsuite.model.FieldMappingEntry;
import com.mxsuite.model.ProjectDataUpload;
import com.mxsuite.model.enums.MappingStatus;
import com.mxsuite.repository.FieldMappingEntryRepository;
import com.mxsuite.repository.ProjectDataUploadRepository;
import org.apache.avro.Schema;
import org.apache.avro.SchemaBuilder;
import org.apache.avro.generic.GenericData;
import org.apache.avro.generic.GenericRecord;
import org.apache.parquet.avro.AvroParquetWriter;
import org.apache.parquet.hadoop.ParquetWriter;
import org.apache.parquet.hadoop.metadata.CompressionCodecName;
import org.apache.parquet.io.LocalOutputFile;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.*;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Exports validated data from SQL Server staging tables as Parquet files,
 * grouped by target entity, and uploads them to S3.
 */
@Service
@ConditionalOnExpression("'${mxsuite.s3.bucket:}' != ''")
public class ParquetExportService {

    private static final Logger log = LoggerFactory.getLogger(ParquetExportService.class);

    private final JdbcTemplate mssqlJdbc;
    private final MssqlProperties mssqlProps;
    private final FieldMappingEntryRepository mappingRepository;
    private final ProjectDataUploadRepository uploadRepository;
    private final TargetSchemaService schemaService;
    private final S3StorageService s3StorageService;
    private final StagingService stagingService;
    private final SimpMessagingTemplate messagingTemplate;

    public ParquetExportService(@Qualifier("mssqlJdbcTemplate") JdbcTemplate mssqlJdbc,
                                 MssqlProperties mssqlProps,
                                 FieldMappingEntryRepository mappingRepository,
                                 ProjectDataUploadRepository uploadRepository,
                                 TargetSchemaService schemaService,
                                 S3StorageService s3StorageService,
                                 StagingService stagingService,
                                 SimpMessagingTemplate messagingTemplate) {
        this.mssqlJdbc = mssqlJdbc;
        this.mssqlProps = mssqlProps;
        this.mappingRepository = mappingRepository;
        this.uploadRepository = uploadRepository;
        this.schemaService = schemaService;
        this.s3StorageService = s3StorageService;
        this.stagingService = stagingService;
        this.messagingTemplate = messagingTemplate;
    }

    /**
     * Export validated data as Parquet to S3. Triggered after reconciliation sign-off.
     */
    @Async("exportExecutor")
    public void exportAsync(UUID projectId, UUID userId) {
        ProjectDataUpload upload = uploadRepository
                .findFirstByProjectIdOrderByCreatedAtDesc(projectId).orElse(null);
        if (upload == null) {
            log.warn("No upload found for project {} — skipping export", projectId);
            return;
        }

        if (!"STAGED".equals(upload.getStagingStatus())) {
            log.warn("Upload {} not staged — skipping Parquet export", upload.getId());
            return;
        }

        if (!s3StorageService.isEnabled()) {
            log.warn("S3 not configured — skipping Parquet export for project {}", projectId);
            return;
        }

        upload.setS3ExportStatus("EXPORTING");
        upload.setS3ExportError(null);
        uploadRepository.save(upload);

        try {
            String timestamp = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss")
                    .format(LocalDateTime.now());
            String tenantId = upload.getProject().getTenant().getId().toString();
            String s3BasePath = "tenants/" + tenantId + "/projects/" + projectId + "/exports/" + timestamp + "/";

            // Load approved mappings and group by target entity
            List<FieldMappingEntry> approvedMappings = mappingRepository.findAllByProjectId(projectId)
                    .stream()
                    .filter(m -> m.getMappingStatus() == MappingStatus.MAPPED)
                    .toList();

            Map<String, List<FieldMappingEntry>> byEntity = approvedMappings.stream()
                    .filter(m -> m.getTargetEntity() != null)
                    .collect(Collectors.groupingBy(FieldMappingEntry::getTargetEntity));

            // Load target schema for type info
            Map<String, Map<String, Object>> targetFieldLookup = new HashMap<>();
            for (Map<String, Object> field : schemaService.getFlatFields()) {
                targetFieldLookup.put(field.get("entity") + "." + field.get("name"), field);
            }

            String qualifiedTable = resolveQualifiedTable(upload);
            int entityCount = 0;

            // Export one Parquet file per target entity
            for (Map.Entry<String, List<FieldMappingEntry>> entry : byEntity.entrySet()) {
                String entity = entry.getKey();
                List<FieldMappingEntry> entityMappings = entry.getValue();

                exportEntityParquet(entity, entityMappings, targetFieldLookup,
                        qualifiedTable, s3BasePath);
                entityCount++;
                broadcastExportProgress(userId, entity, entityCount, byEntity.size());
            }

            // Update upload record
            upload.setS3ExportStatus("EXPORTED");
            upload.setS3BasePath(s3BasePath);
            upload.setS3ExportedAt(Instant.now());
            upload.setS3ExportError(null);
            uploadRepository.save(upload);

            // Cleanup staging
            try {
                stagingService.dropStaging(upload.getId());
            } catch (Exception e) {
                log.warn("Staging cleanup failed after export: {}", e.getMessage());
            }

            // Delete local file
            try {
                if (upload.getStoragePath() != null) {
                    Files.deleteIfExists(Path.of(upload.getStoragePath()));
                    log.info("Deleted local file: {}", upload.getStoragePath());
                }
            } catch (IOException e) {
                log.warn("Could not delete local file: {}", e.getMessage());
            }

            log.info("Parquet export completed for project {}: {} entities to s3://.../{}",
                    projectId, entityCount, s3BasePath);

        } catch (Exception e) {
            log.error("Parquet export failed for project {}: {}", projectId, e.getMessage(), e);
            upload.setS3ExportStatus("FAILED");
            upload.setS3ExportError(e.getMessage());
            uploadRepository.save(upload);
        }
    }

    private void exportEntityParquet(String entity, List<FieldMappingEntry> mappings,
                                      Map<String, Map<String, Object>> targetFieldLookup,
                                      String qualifiedTable, String s3BasePath) throws IOException {
        // Build Avro schema for this entity
        SchemaBuilder.FieldAssembler<Schema> fields = SchemaBuilder.record(entity)
                .namespace("com.mxsuite.export")
                .fields();

        List<String> sourceColumns = new ArrayList<>();
        List<String> targetFields = new ArrayList<>();

        for (FieldMappingEntry mapping : mappings) {
            String key = entity + "." + mapping.getTargetField();
            Map<String, Object> targetDef = targetFieldLookup.get(key);
            String type = targetDef != null ? String.valueOf(targetDef.getOrDefault("type", "string")) : "string";

            // All fields nullable in Parquet
            switch (type) {
                case "number", "integer" -> fields.name(mapping.getTargetField()).type().nullable().doubleType().noDefault();
                case "boolean" -> fields.name(mapping.getTargetField()).type().nullable().booleanType().noDefault();
                default -> fields.name(mapping.getTargetField()).type().nullable().stringType().noDefault();
            }

            sourceColumns.add(mapping.getSourceField());
            targetFields.add(mapping.getTargetField());
        }

        Schema schema = fields.endRecord();

        // Write to temp Parquet file
        Path tempFile = Files.createTempFile("parquet-" + entity + "-", ".parquet");

        try {
            try (ParquetWriter<GenericRecord> writer = AvroParquetWriter.<GenericRecord>builder(
                    new LocalOutputFile(tempFile))
                    .withSchema(schema)
                    .withCompressionCodec(CompressionCodecName.SNAPPY)
                    .build()) {

                // Build SELECT query from staging table
                StringBuilder selectSql = new StringBuilder("SELECT ");
                StringJoiner colJoiner = new StringJoiner(", ");
                for (String col : sourceColumns) {
                    colJoiner.add("[" + col.replaceAll("[\\[\\]\"']", "") + "]");
                }
                selectSql.append(colJoiner).append(" FROM ").append(qualifiedTable);

                // Stream results and write Parquet records
                try (Connection conn = DriverManager.getConnection(
                        mssqlProps.stagingJdbcUrl(), mssqlProps.username(), mssqlProps.password());
                     Statement stmt = conn.createStatement();
                     ResultSet rs = stmt.executeQuery(selectSql.toString())) {

                    while (rs.next()) {
                        GenericRecord record = new GenericData.Record(schema);
                        for (int i = 0; i < targetFields.size(); i++) {
                            String targetField = targetFields.get(i);
                            String value = rs.getString(i + 1);

                            if (value == null || value.isBlank()) {
                                record.put(targetField, null);
                                continue;
                            }

                            Schema.Field avroField = schema.getField(targetField);
                            Schema fieldSchema = unwrapNullable(avroField.schema());

                            switch (fieldSchema.getType()) {
                                case DOUBLE -> {
                                    try {
                                        record.put(targetField, Double.parseDouble(
                                                value.replace(",", "").replace("$", "")));
                                    } catch (NumberFormatException e) {
                                        record.put(targetField, null);
                                    }
                                }
                                case BOOLEAN -> record.put(targetField, parseBool(value));
                                default -> record.put(targetField, value);
                            }
                        }
                        writer.write(record);
                    }
                } catch (SQLException e) {
                    throw new IOException("Failed to read staging data: " + e.getMessage(), e);
                }
            }

            // Upload to S3
            String s3Key = s3BasePath + entity + ".parquet";
            s3StorageService.upload(tempFile, s3Key);

        } finally {
            Files.deleteIfExists(tempFile);
        }
    }

    private Schema unwrapNullable(Schema schema) {
        if (schema.getType() == Schema.Type.UNION) {
            for (Schema s : schema.getTypes()) {
                if (s.getType() != Schema.Type.NULL) return s;
            }
        }
        return schema;
    }

    private Boolean parseBool(String value) {
        String lower = value.toLowerCase().trim();
        return switch (lower) {
            case "true", "yes", "1", "t", "y" -> true;
            case "false", "no", "0", "f", "n" -> false;
            default -> null;
        };
    }

    private String resolveQualifiedTable(ProjectDataUpload upload) {
        String dbName = upload.getStagingDbName();
        String schemaName = upload.getStagingSchemaName();
        if (schemaName != null) {
            return "[" + dbName + "].[" + schemaName + "].[data]";
        } else {
            return "[" + dbName + "].[dbo].[data]";
        }
    }

    private void broadcastExportProgress(UUID userId, String entity, int current, int total) {
        if (userId == null) return;
        messagingTemplate.convertAndSendToUser(userId.toString(), "/queue/export-progress",
                Map.of("entity", entity, "current", current, "total", total));
    }
}
