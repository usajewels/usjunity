package com.mxsuite.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "mxsuite.mssql")
public record MssqlProperties(
        String host,
        int port,
        String username,
        String password,
        String backupRestorePath,
        String backupRestorePathSql,
        String stagingDatabase,
        int batchSize
) {
    public MssqlProperties {
        if (host == null) host = "localhost";
        if (port == 0) port = 1433;
        if (username == null) username = "sa";
        if (backupRestorePath == null) backupRestorePath = "C:/temp/mxsuite-backups";
        if (backupRestorePathSql == null) backupRestorePathSql = backupRestorePath;
        if (stagingDatabase == null) stagingDatabase = "mxsuite_staging";
        if (batchSize == 0) batchSize = 1000;
    }

    public String jdbcUrl() {
        return "jdbc:sqlserver://" + host + ":" + port
                + ";encrypt=false;trustServerCertificate=true";
    }

    public String stagingJdbcUrl() {
        return jdbcUrl() + ";databaseName=" + stagingDatabase;
    }
}
