package com.mxsuite.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.Map;

@ConfigurationProperties(prefix = "mxsuite.analytics")
public record AnalyticsProperties(Map<String, Long> phaseThresholdsMinutes) {
    public AnalyticsProperties {
        if (phaseThresholdsMinutes == null) {
            phaseThresholdsMinutes = Map.of(
                    "DISCOVER", 10080L,   // 7 days
                    "MAP",      20160L,   // 14 days
                    "GENERATE",  7200L,   // 5 days
                    "DRY_RUN",  10080L,   // 7 days
                    "MIGRATE",  14400L,   // 10 days
                    "CUT_OVER",  7200L    // 5 days
            );
        }
    }
}
