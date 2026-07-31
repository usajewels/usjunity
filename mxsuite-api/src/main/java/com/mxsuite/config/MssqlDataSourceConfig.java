package com.mxsuite.config;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Lazy;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Managed HikariCP connection pool for SQL Server staging operations.
 * Separate from the primary PostgreSQL datasource.
 *
 * Does NOT expose a DataSource bean — only a JdbcTemplate — so Spring Boot's
 * DataSourceAutoConfiguration still creates the primary PostgreSQL pool.
 */
@Configuration
@ConditionalOnExpression("'${mxsuite.mssql.host:}' != ''")
public class MssqlDataSourceConfig implements DisposableBean {

    private volatile HikariDataSource mssqlPool;

    @Bean
    @Lazy
    public JdbcTemplate mssqlJdbcTemplate(MssqlProperties props) {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl(props.stagingJdbcUrl());
        config.setUsername(props.username());
        config.setPassword(props.password());
        config.setMaximumPoolSize(8);
        config.setMinimumIdle(2);
        config.setPoolName("mssql-staging");
        config.setConnectionTimeout(10_000);
        config.setIdleTimeout(300_000);
        config.setDriverClassName("com.microsoft.sqlserver.jdbc.SQLServerDriver");
        this.mssqlPool = new HikariDataSource(config);
        return new JdbcTemplate(this.mssqlPool);
    }

    @Override
    public void destroy() {
        if (mssqlPool != null && !mssqlPool.isClosed()) {
            mssqlPool.close();
        }
    }
}
