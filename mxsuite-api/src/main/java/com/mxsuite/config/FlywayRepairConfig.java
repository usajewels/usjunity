package com.mxsuite.config;

import org.flywaydb.core.Flyway;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.flyway.FlywayMigrationStrategy;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

/**
 * Automatically repairs failed Flyway migrations and enables out-of-order
 * execution before retrying. Active only in local/dev profiles.
 */
@Configuration
@Profile({"local", "dev"})
public class FlywayRepairConfig {

    private static final Logger log = LoggerFactory.getLogger(FlywayRepairConfig.class);

    @Bean
    public FlywayMigrationStrategy flywayMigrationStrategy() {
        return flyway -> {
            log.info("Running Flyway repair + out-of-order migration (dev mode)...");
            flyway.repair();
            // Reconfigure with out-of-order enabled for seed data that may have lower versions
            Flyway reconfigured = Flyway.configure()
                    .configuration(flyway.getConfiguration())
                    .outOfOrder(true)
                    .load();
            reconfigured.migrate();
        };
    }
}
