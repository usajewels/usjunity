package com.mxsuite.service;

import com.mxsuite.config.MssqlProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.sql.*;
import java.util.*;

/**
 * Restores a SQL Server .bak backup to a temporary database,
 * extracts table/column schema via INFORMATION_SCHEMA, then drops the temp DB.
 */
@Service
public class BakFileService {

    private static final Logger log = LoggerFactory.getLogger(BakFileService.class);

    private final MssqlProperties mssqlProps;

    public BakFileService(MssqlProperties mssqlProps) {
        this.mssqlProps = mssqlProps;
    }

    // ---- DTOs ----

    public record BakParseResult(
            String databaseName,
            List<TableInfo> tables,
            List<TablePreviewData> previews
    ) {}

    public record TableInfo(
            String schemaName,
            String tableName,
            List<ColumnInfo> columns
    ) {}

    public record ColumnInfo(
            String columnName,
            String dataType,
            boolean nullable,
            Integer maxLength,
            boolean isPrimaryKey
    ) {}

    public record TablePreviewData(
            String schemaName,
            String tableName,
            List<String> headers,
            List<List<String>> rows,
            long rowCount
    ) {}

    // ---- public API ----

    public boolean isBackupFile(String contentType, String filename) {
        if (filename == null) return false;
        return filename.toLowerCase().endsWith(".bak");
    }

    /** Return a human-readable description of the SQL Server connection target. */
    public String getConnectionInfo() {
        return mssqlProps.host() + ":" + mssqlProps.port();
    }

    /**
     * Parse a .bak file: copy to SQL Server-accessible path, restore to temp DB,
     * extract schema, drop temp DB, clean up.
     */
    public BakParseResult parseBackup(Path bakFilePath) throws IOException {
        String tempDbName = "mxtemp_" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);

        // Copy .bak to a directory SQL Server can read from
        Path restoreDir = Path.of(mssqlProps.backupRestorePath());
        Files.createDirectories(restoreDir);
        Path restorePath = restoreDir.resolve(tempDbName + ".bak");
        Files.copy(bakFilePath, restorePath, StandardCopyOption.REPLACE_EXISTING);

        log.info("Copied .bak to SQL Server-accessible path: {}", restorePath);

        try {
            return restoreAndExtract(restorePath, tempDbName);
        } finally {
            // Always clean up the copied .bak file
            try {
                Files.deleteIfExists(restorePath);
            } catch (IOException e) {
                log.warn("Could not delete temp .bak file: {}", restorePath, e);
            }
        }
    }

    // ---- internal ----

    private BakParseResult restoreAndExtract(Path restorePath, String tempDbName) throws IOException {
        // SQL Server sees the container/server-side path, not the host path
        String sqlBasePath = mssqlProps.backupRestorePathSql();
        String bakPathSql = sqlBasePath + "/" + restorePath.getFileName().toString();
        String originalDbName = null;

        try (Connection conn = DriverManager.getConnection(
                mssqlProps.jdbcUrl(), mssqlProps.username(), mssqlProps.password())) {

            // 1. Read backup header to get original DB name and logical file names
            String logicalData = null;
            String logicalLog = null;

            try (Statement stmt = conn.createStatement();
                 ResultSet rs = stmt.executeQuery(
                         "RESTORE FILELISTONLY FROM DISK = '" + escapeSql(bakPathSql) + "'")) {
                while (rs.next()) {
                    String logicalName = rs.getString("LogicalName");
                    String type = rs.getString("Type");
                    if ("D".equals(type)) {
                        logicalData = logicalName;
                    } else if ("L".equals(type)) {
                        logicalLog = logicalName;
                    }
                }
            }

            if (logicalData == null || logicalLog == null) {
                throw new IOException("Could not read logical file names from .bak file");
            }

            // Get original DB name from header
            try (Statement stmt = conn.createStatement();
                 ResultSet rs = stmt.executeQuery(
                         "RESTORE HEADERONLY FROM DISK = '" + escapeSql(bakPathSql) + "'")) {
                if (rs.next()) {
                    originalDbName = rs.getString("DatabaseName");
                }
            }

            log.info("Restoring backup '{}' as temp DB [{}] (logical data={}, log={})",
                    originalDbName, tempDbName, logicalData, logicalLog);

            // 2. Restore to temp database — MOVE paths use the SQL Server-side path
            String mdfPath = sqlBasePath + "/" + tempDbName + ".mdf";
            String ldfPath = sqlBasePath + "/" + tempDbName + "_log.ldf";

            String restoreSql = "RESTORE DATABASE [" + tempDbName + "] FROM DISK = '"
                    + escapeSql(bakPathSql) + "' WITH "
                    + "MOVE '" + escapeSql(logicalData) + "' TO '" + escapeSql(mdfPath) + "', "
                    + "MOVE '" + escapeSql(logicalLog) + "' TO '" + escapeSql(ldfPath) + "', "
                    + "REPLACE, RECOVERY";

            try (Statement stmt = conn.createStatement()) {
                stmt.execute(restoreSql);
            }

            log.info("Temp database [{}] restored successfully", tempDbName);

            // 3. Extract schema
            List<TableInfo> tables = extractSchema(conn, tempDbName);

            // 4. Extract sample data (TOP 5 rows + row count per table)
            List<TablePreviewData> previews = extractSampleData(conn, tempDbName, tables);

            // 5. Drop temp database
            dropDatabase(conn, tempDbName);

            return new BakParseResult(
                    originalDbName != null ? originalDbName : "Unknown",
                    tables, previews
            );

        } catch (SQLException e) {
            // Try to clean up temp DB on failure
            tryDropDatabase(tempDbName);
            throw new IOException("Failed to parse SQL Server backup: " + e.getMessage(), e);
        }
    }

    private List<TableInfo> extractSchema(Connection conn, String tempDbName) throws SQLException {
        List<TableInfo> tables = new ArrayList<>();

        // Get primary key columns for the entire database
        Set<String> pkColumns = new HashSet<>();
        String pkQuery = "SELECT t.TABLE_SCHEMA, t.TABLE_NAME, c.COLUMN_NAME "
                + "FROM [" + tempDbName + "].INFORMATION_SCHEMA.TABLE_CONSTRAINTS t "
                + "JOIN [" + tempDbName + "].INFORMATION_SCHEMA.CONSTRAINT_COLUMN_USAGE c "
                + "ON t.CONSTRAINT_NAME = c.CONSTRAINT_NAME AND t.TABLE_SCHEMA = c.TABLE_SCHEMA "
                + "WHERE t.CONSTRAINT_TYPE = 'PRIMARY KEY'";

        try (Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery(pkQuery)) {
            while (rs.next()) {
                pkColumns.add(rs.getString("TABLE_SCHEMA") + "."
                        + rs.getString("TABLE_NAME") + "."
                        + rs.getString("COLUMN_NAME"));
            }
        }

        // Get all user tables
        String tablesQuery = "SELECT TABLE_SCHEMA, TABLE_NAME FROM ["
                + tempDbName + "].INFORMATION_SCHEMA.TABLES "
                + "WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_SCHEMA, TABLE_NAME";

        List<String[]> tableList = new ArrayList<>();
        try (Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery(tablesQuery)) {
            while (rs.next()) {
                tableList.add(new String[]{rs.getString("TABLE_SCHEMA"), rs.getString("TABLE_NAME")});
            }
        }

        // Get columns for each table
        for (String[] table : tableList) {
            String schema = table[0];
            String tableName = table[1];

            String colQuery = "SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH "
                    + "FROM [" + tempDbName + "].INFORMATION_SCHEMA.COLUMNS "
                    + "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? "
                    + "ORDER BY ORDINAL_POSITION";

            List<ColumnInfo> columns = new ArrayList<>();
            try (PreparedStatement ps = conn.prepareStatement(colQuery)) {
                ps.setString(1, schema);
                ps.setString(2, tableName);
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) {
                        String colName = rs.getString("COLUMN_NAME");
                        String dataType = rs.getString("DATA_TYPE");
                        boolean nullable = "YES".equals(rs.getString("IS_NULLABLE"));
                        Integer maxLen = rs.getObject("CHARACTER_MAXIMUM_LENGTH") != null
                                ? rs.getInt("CHARACTER_MAXIMUM_LENGTH") : null;
                        boolean isPk = pkColumns.contains(schema + "." + tableName + "." + colName);

                        columns.add(new ColumnInfo(colName, dataType, nullable, maxLen, isPk));
                    }
                }
            }

            tables.add(new TableInfo(schema, tableName, columns));
        }

        log.info("Extracted schema: {} tables from temp DB [{}]", tables.size(), tempDbName);
        return tables;
    }

    private List<TablePreviewData> extractSampleData(Connection conn, String tempDbName,
                                                        List<TableInfo> tables) {
        List<TablePreviewData> previews = new ArrayList<>();

        for (TableInfo table : tables) {
            String qualifiedTable = "[" + tempDbName + "].[" + table.schemaName() + "].[" + table.tableName() + "]";

            try {
                // Get row count
                long rowCount = 0;
                try (Statement stmt = conn.createStatement();
                     ResultSet rs = stmt.executeQuery("SELECT COUNT(*) FROM " + qualifiedTable)) {
                    if (rs.next()) rowCount = rs.getLong(1);
                }

                // Get TOP 5 sample rows
                List<String> headers = new ArrayList<>();
                List<List<String>> rows = new ArrayList<>();

                try (Statement stmt = conn.createStatement();
                     ResultSet rs = stmt.executeQuery("SELECT TOP 5 * FROM " + qualifiedTable)) {
                    ResultSetMetaData meta = rs.getMetaData();
                    int colCount = meta.getColumnCount();

                    for (int c = 1; c <= colCount; c++) {
                        headers.add(meta.getColumnName(c));
                    }

                    while (rs.next()) {
                        List<String> row = new ArrayList<>();
                        for (int c = 1; c <= colCount; c++) {
                            String val = rs.getString(c);
                            row.add(val != null ? val : "");
                        }
                        rows.add(row);
                    }
                }

                previews.add(new TablePreviewData(table.schemaName(), table.tableName(),
                        headers, rows, rowCount));

                log.debug("Sampled table {}.{}: {} rows total, {} preview rows",
                        table.schemaName(), table.tableName(), rowCount, rows.size());

            } catch (SQLException e) {
                log.warn("Could not sample table {}.{}: {}", table.schemaName(), table.tableName(), e.getMessage());
                // Add empty preview so we still have the table listed
                previews.add(new TablePreviewData(table.schemaName(), table.tableName(),
                        List.of(), List.of(), 0));
            }
        }

        log.info("Extracted sample data from {} tables", previews.size());
        return previews;
    }

    private void dropDatabase(Connection conn, String tempDbName) {
        try (Statement stmt = conn.createStatement()) {
            // Force close connections and drop
            stmt.execute("ALTER DATABASE [" + tempDbName + "] SET SINGLE_USER WITH ROLLBACK IMMEDIATE");
            stmt.execute("DROP DATABASE [" + tempDbName + "]");
            log.info("Dropped temp database [{}]", tempDbName);
        } catch (SQLException e) {
            log.warn("Failed to drop temp database [{}]: {}", tempDbName, e.getMessage());
        }
    }

    private void tryDropDatabase(String tempDbName) {
        try (Connection conn = DriverManager.getConnection(
                mssqlProps.jdbcUrl(), mssqlProps.username(), mssqlProps.password())) {
            dropDatabase(conn, tempDbName);
        } catch (SQLException e) {
            log.warn("Could not connect to drop temp database [{}]: {}", tempDbName, e.getMessage());
        }
    }

    /**
     * Convert BakParseResult to a ParsedFileResult compatible with the mapping pipeline.
     * Each column becomes a header entry prefixed with its table name.
     * Sample values are populated from preview data when available.
     */
    public FileParsingService.ParsedFileResult toParseResult(BakParseResult bakResult) {
        List<String> headers = new ArrayList<>();
        List<Map<String, Object>> sourceColumns = new ArrayList<>();

        // Index preview data by table name for fast lookup
        Map<String, TablePreviewData> previewByTable = new HashMap<>();
        if (bakResult.previews() != null) {
            for (TablePreviewData pd : bakResult.previews()) {
                previewByTable.put(pd.tableName(), pd);
            }
        }

        long totalRows = 0;

        for (TableInfo table : bakResult.tables()) {
            TablePreviewData preview = previewByTable.get(table.tableName());
            if (preview != null) totalRows += preview.rowCount();

            // Build a column-index map from preview headers for this table
            Map<String, Integer> previewColIndex = new HashMap<>();
            if (preview != null) {
                for (int i = 0; i < preview.headers().size(); i++) {
                    previewColIndex.put(preview.headers().get(i), i);
                }
            }

            for (ColumnInfo col : table.columns()) {
                String qualifiedName = table.tableName() + "." + col.columnName();
                headers.add(qualifiedName);

                Map<String, Object> colMeta = new LinkedHashMap<>();
                colMeta.put("name", qualifiedName);
                colMeta.put("tableName", table.tableName());
                colMeta.put("schemaName", table.schemaName());
                colMeta.put("tableRowCount", preview != null ? preview.rowCount() : 0);
                colMeta.put("dataType", col.dataType());
                colMeta.put("nullable", col.nullable());
                colMeta.put("isPrimaryKey", col.isPrimaryKey());
                if (col.maxLength() != null) {
                    colMeta.put("maxLength", col.maxLength());
                }

                // Populate sample values from preview rows
                List<String> sampleValues = new ArrayList<>();
                Integer colIdx = previewColIndex.get(col.columnName());
                if (colIdx != null && preview != null) {
                    for (List<String> row : preview.rows()) {
                        if (colIdx < row.size()) {
                            sampleValues.add(row.get(colIdx));
                        }
                    }
                }
                colMeta.put("sampleValues", sampleValues);

                sourceColumns.add(colMeta);
            }
        }

        return new FileParsingService.ParsedFileResult(headers, List.of(), (int) totalRows, sourceColumns);
    }

    private String escapeSql(String value) {
        return value.replace("'", "''");
    }
}
