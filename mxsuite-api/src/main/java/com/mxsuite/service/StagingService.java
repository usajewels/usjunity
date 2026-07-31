package com.mxsuite.service;

import com.mxsuite.config.MssqlProperties;
import com.mxsuite.model.ProjectDataUpload;
import com.mxsuite.repository.ProjectDataUploadRepository;
import jakarta.annotation.PostConstruct;
import org.apache.poi.ss.usermodel.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.*;
import java.util.*;

/**
 * Stages uploaded data (CSV, Excel, BAK) into SQL Server tables
 * so validation can run SQL queries instead of streaming files.
 */
@Service
@ConditionalOnExpression("'${mxsuite.mssql.host:}' != ''")
public class StagingService {

    private static final Logger log = LoggerFactory.getLogger(StagingService.class);

    private final MssqlProperties mssqlProps;
    private final JdbcTemplate mssqlJdbc;
    private final BakFileService bakFileService;
    private final ProjectDataUploadRepository uploadRepository;
    private final SimpMessagingTemplate messagingTemplate;

    public StagingService(MssqlProperties mssqlProps,
                          @Qualifier("mssqlJdbcTemplate") JdbcTemplate mssqlJdbc,
                          BakFileService bakFileService,
                          ProjectDataUploadRepository uploadRepository,
                          SimpMessagingTemplate messagingTemplate) {
        this.mssqlProps = mssqlProps;
        this.mssqlJdbc = mssqlJdbc;
        this.bakFileService = bakFileService;
        this.uploadRepository = uploadRepository;
        this.messagingTemplate = messagingTemplate;
    }

    /** Ensure the staging database exists on SQL Server. */
    @PostConstruct
    public void ensureStagingDatabase() {
        String dbName = mssqlProps.stagingDatabase();
        try (Connection conn = DriverManager.getConnection(
                mssqlProps.jdbcUrl(), mssqlProps.username(), mssqlProps.password())) {
            try (Statement stmt = conn.createStatement()) {
                stmt.execute("IF DB_ID('" + escapeSql(dbName) + "') IS NULL "
                        + "CREATE DATABASE [" + dbName + "]");
            }
            log.info("Staging database [{}] ready", dbName);
        } catch (SQLException e) {
            log.warn("Could not ensure staging database [{}]: {}", dbName, e.getMessage());
        }
    }

    /**
     * Stage an upload's data into SQL Server. Call after file parsing completes.
     */
    @Async("stagingExecutor")
    public void stageUpload(UUID uploadId, UUID userId) {
        ProjectDataUpload upload = uploadRepository.findById(uploadId).orElse(null);
        if (upload == null) return;

        upload.setStagingStatus("STAGING");
        upload.setStagingError(null);
        uploadRepository.save(upload);

        try {
            Path filePath = Path.of(upload.getStoragePath());
            String filename = upload.getOriginalFilename().toLowerCase();

            if (filename.endsWith(".bak")) {
                stageBakFile(upload, filePath);
            } else if (filename.endsWith(".xlsx") || filename.endsWith(".xls")) {
                stageExcelFile(upload, filePath, userId);
            } else {
                stageCsvFile(upload, filePath, userId);
            }

            upload.setStagingStatus("STAGED");
            upload.setStagingError(null);
            uploadRepository.save(upload);
            log.info("Upload {} staged successfully", uploadId);

        } catch (Exception e) {
            log.error("Staging failed for upload {}: {}", uploadId, e.getMessage(), e);
            upload.setStagingStatus("FAILED");
            upload.setStagingError(e.getMessage());
            uploadRepository.save(upload);
        }
    }

    /** Drop staging schema/database for an upload. */
    public void dropStaging(UUID uploadId) {
        ProjectDataUpload upload = uploadRepository.findById(uploadId).orElse(null);
        if (upload == null) return;

        String dbName = upload.getStagingDbName();
        String schemaName = upload.getStagingSchemaName();

        if (dbName != null && !dbName.equals(mssqlProps.stagingDatabase())) {
            // BAK file — drop the entire temp database
            bakFileService.dropDatabaseByName(dbName);
            log.info("Dropped staging database [{}] for upload {}", dbName, uploadId);
        } else if (schemaName != null) {
            // CSV/Excel — drop the schema within the staging database
            try {
                dropStagingSchema(schemaName);
                log.info("Dropped staging schema [{}] for upload {}", schemaName, uploadId);
            } catch (Exception e) {
                log.warn("Failed to drop staging schema [{}]: {}", schemaName, e.getMessage());
            }
        }

        upload.setStagingDbName(null);
        upload.setStagingSchemaName(null);
        uploadRepository.save(upload);
    }

    // ---- CSV staging ----

    private void stageCsvFile(ProjectDataUpload upload, Path filePath, UUID userId) throws IOException {
        String schemaName = "upload_" + upload.getId().toString().replace("-", "").substring(0, 12);
        String dbName = mssqlProps.stagingDatabase();

        try (BufferedReader reader = Files.newBufferedReader(filePath, StandardCharsets.UTF_8)) {
            String headerLine = reader.readLine();
            if (headerLine == null) throw new IOException("Empty CSV file");

            List<String> headers = parseCsvLine(headerLine);

            // Create schema and table
            createStagingSchema(dbName, schemaName);
            createStagingTable(dbName, schemaName, "data", headers);

            // Batch insert all rows
            int batchSize = mssqlProps.batchSize();
            int totalRows = 0;
            String insertSql = buildInsertSql(dbName, schemaName, "data", headers);

            try (Connection conn = DriverManager.getConnection(
                    mssqlProps.stagingJdbcUrl(), mssqlProps.username(), mssqlProps.password());
                 PreparedStatement ps = conn.prepareStatement(insertSql)) {

                String line;
                while ((line = reader.readLine()) != null) {
                    if (line.isBlank()) continue;
                    List<String> values = parseCsvLine(line);
                    setValues(ps, headers.size(), values);
                    ps.addBatch();
                    totalRows++;

                    if (totalRows % batchSize == 0) {
                        ps.executeBatch();
                        broadcastProgress(userId, "staging", totalRows, upload.getRowCount());
                    }
                }
                ps.executeBatch(); // flush remaining
            } catch (SQLException e) {
                throw new IOException("SQL Server batch insert failed: " + e.getMessage(), e);
            }

            upload.setStagingDbName(dbName);
            upload.setStagingSchemaName(schemaName);
            log.info("Staged {} CSV rows into [{}].[{}].[data]", totalRows, dbName, schemaName);
        }
    }

    // ---- Excel staging ----

    private void stageExcelFile(ProjectDataUpload upload, Path filePath, UUID userId) throws IOException {
        String schemaName = "upload_" + upload.getId().toString().replace("-", "").substring(0, 12);
        String dbName = mssqlProps.stagingDatabase();

        try (InputStream is = Files.newInputStream(filePath);
             Workbook workbook = WorkbookFactory.create(is)) {

            Sheet sheet = upload.getSheetName() != null
                    ? workbook.getSheet(upload.getSheetName())
                    : workbook.getSheetAt(0);
            if (sheet == null) sheet = workbook.getSheetAt(0);

            DataFormatter formatter = new DataFormatter();

            // Extract headers from first row
            Row headerRow = sheet.getRow(0);
            if (headerRow == null) throw new IOException("Empty Excel sheet");

            List<String> headers = new ArrayList<>();
            for (int c = 0; c < headerRow.getLastCellNum(); c++) {
                Cell cell = headerRow.getCell(c);
                String val = cell != null ? formatter.formatCellValue(cell).trim() : "Column" + (c + 1);
                headers.add(val.isEmpty() ? "Column" + (c + 1) : val);
            }

            createStagingSchema(dbName, schemaName);
            createStagingTable(dbName, schemaName, "data", headers);

            int batchSize = mssqlProps.batchSize();
            int totalRows = 0;
            String insertSql = buildInsertSql(dbName, schemaName, "data", headers);

            try (Connection conn = DriverManager.getConnection(
                    mssqlProps.stagingJdbcUrl(), mssqlProps.username(), mssqlProps.password());
                 PreparedStatement ps = conn.prepareStatement(insertSql)) {

                for (int r = 1; r <= sheet.getLastRowNum(); r++) {
                    Row row = sheet.getRow(r);
                    if (row == null) continue;

                    List<String> values = new ArrayList<>();
                    for (int c = 0; c < headers.size(); c++) {
                        Cell cell = row.getCell(c);
                        values.add(cell != null ? formatter.formatCellValue(cell) : "");
                    }
                    setValues(ps, headers.size(), values);
                    ps.addBatch();
                    totalRows++;

                    if (totalRows % batchSize == 0) {
                        ps.executeBatch();
                        broadcastProgress(userId, "staging", totalRows, upload.getRowCount());
                    }
                }
                ps.executeBatch();
            } catch (SQLException e) {
                throw new IOException("SQL Server batch insert failed: " + e.getMessage(), e);
            }

            upload.setStagingDbName(dbName);
            upload.setStagingSchemaName(schemaName);
            log.info("Staged {} Excel rows into [{}].[{}].[data]", totalRows, dbName, schemaName);
        }
    }

    // ---- BAK staging ----

    private void stageBakFile(ProjectDataUpload upload, Path filePath) throws IOException {
        // Restore .bak but keep the temp database alive for staging
        BakFileService.BakParseResult result = bakFileService.parseBackup(filePath, true);
        upload.setStagingDbName(result.tempDbName());
        upload.setStagingSchemaName(null); // BAK uses dbo schema within its own temp DB
        log.info("BAK staged: temp database [{}] kept alive", result.tempDbName());
    }

    // ---- Schema / table helpers ----

    private void createStagingSchema(String dbName, String schemaName) {
        try (Connection conn = DriverManager.getConnection(
                mssqlProps.stagingJdbcUrl(), mssqlProps.username(), mssqlProps.password());
             Statement stmt = conn.createStatement()) {
            stmt.execute("IF NOT EXISTS (SELECT 1 FROM [" + dbName + "].sys.schemas "
                    + "WHERE name = '" + escapeSql(schemaName) + "') "
                    + "EXEC('CREATE SCHEMA [" + schemaName + "]')");
        } catch (SQLException e) {
            throw new RuntimeException("Failed to create staging schema [" + schemaName + "]: " + e.getMessage(), e);
        }
    }

    private void createStagingTable(String dbName, String schemaName, String tableName, List<String> columns) {
        StringBuilder ddl = new StringBuilder();
        ddl.append("CREATE TABLE [").append(dbName).append("].[").append(schemaName).append("].[").append(tableName).append("] (");
        ddl.append("[_mx_row_number] INT IDENTITY(1,1) PRIMARY KEY");
        for (String col : columns) {
            ddl.append(", [").append(sanitizeColumnName(col)).append("] NVARCHAR(MAX)");
        }
        ddl.append(")");

        try (Connection conn = DriverManager.getConnection(
                mssqlProps.stagingJdbcUrl(), mssqlProps.username(), mssqlProps.password());
             Statement stmt = conn.createStatement()) {
            stmt.execute(ddl.toString());
        } catch (SQLException e) {
            throw new RuntimeException("Failed to create staging table: " + e.getMessage(), e);
        }
    }

    private String buildInsertSql(String dbName, String schemaName, String tableName, List<String> columns) {
        StringBuilder sql = new StringBuilder();
        sql.append("INSERT INTO [").append(dbName).append("].[").append(schemaName).append("].[").append(tableName).append("] (");
        StringJoiner colNames = new StringJoiner(", ");
        for (String col : columns) {
            colNames.add("[" + sanitizeColumnName(col) + "]");
        }
        sql.append(colNames).append(") VALUES (");
        StringJoiner placeholders = new StringJoiner(", ");
        for (int i = 0; i < columns.size(); i++) placeholders.add("?");
        sql.append(placeholders).append(")");
        return sql.toString();
    }

    private void setValues(PreparedStatement ps, int colCount, List<String> values) throws SQLException {
        for (int i = 0; i < colCount; i++) {
            String val = i < values.size() ? values.get(i) : "";
            ps.setString(i + 1, val);
        }
    }

    private void dropStagingSchema(String schemaName) {
        String dbName = mssqlProps.stagingDatabase();
        try (Connection conn = DriverManager.getConnection(
                mssqlProps.stagingJdbcUrl(), mssqlProps.username(), mssqlProps.password());
             Statement stmt = conn.createStatement()) {
            // Drop all tables in the schema first
            String dropTables = "DECLARE @sql NVARCHAR(MAX) = ''; "
                    + "SELECT @sql += 'DROP TABLE [" + dbName + "].[" + schemaName + "].[' + TABLE_NAME + ']; ' "
                    + "FROM [" + dbName + "].INFORMATION_SCHEMA.TABLES "
                    + "WHERE TABLE_SCHEMA = '" + escapeSql(schemaName) + "'; "
                    + "EXEC sp_executesql @sql;";
            stmt.execute(dropTables);

            // Drop the schema
            stmt.execute("DROP SCHEMA IF EXISTS [" + schemaName + "]");
        } catch (SQLException e) {
            log.warn("Failed to drop staging schema [{}]: {}", schemaName, e.getMessage());
        }
    }

    // ---- CSV parsing (reused from FileParsingService pattern) ----

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
        // Remove characters that are invalid in SQL Server column names
        return name.replaceAll("[\\[\\]\"']", "").trim();
    }

    private String escapeSql(String value) {
        return value.replace("'", "''");
    }

    private void broadcastProgress(UUID userId, String type, int processed, Integer total) {
        if (userId == null) return;
        Map<String, Object> payload = Map.of(
                "type", type,
                "processed", processed,
                "total", total != null ? total : 0
        );
        messagingTemplate.convertAndSendToUser(
                userId.toString(), "/queue/staging-progress", payload);
    }
}
