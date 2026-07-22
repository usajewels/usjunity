package com.mxsuite.config;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import java.util.Arrays;

/**
 * Validates critical security configuration on startup.
 * Refuses to start in production if the JWT secret is missing, too short,
 * or contains placeholder values.
 *
 * @author Joseph M. Vogel
 */
@Component
public class SecurityConfigValidator {

    private static final Logger log = LoggerFactory.getLogger(SecurityConfigValidator.class);

    private static final int MIN_SECRET_LENGTH = 32;

    private final String jwtSecret;
    private final Environment environment;

    public SecurityConfigValidator(
            @Value("${mxsuite.security.jwt.secret:}") String jwtSecret,
            Environment environment) {
        this.jwtSecret = jwtSecret;
        this.environment = environment;
    }

    @PostConstruct
    public void validate() {
        validateJwtSecret();
    }

    private void validateJwtSecret() {
        boolean isDevProfile = Arrays.stream(environment.getActiveProfiles())
                .anyMatch(p -> p.equalsIgnoreCase("dev") || p.equalsIgnoreCase("local")
                        || p.equalsIgnoreCase("test"));

        if (jwtSecret == null || jwtSecret.isBlank()) {
            if (isDevProfile) {
                log.warn("===================================================================");
                log.warn("  JWT_SECRET is not set. This is only acceptable in development.");
                log.warn("  Set JWT_SECRET environment variable for production deployments.");
                log.warn("===================================================================");
            } else {
                log.error("===================================================================");
                log.error("  FATAL: JWT_SECRET is not configured.");
                log.error("  Set the JWT_SECRET environment variable (min {} chars).", MIN_SECRET_LENGTH);
                log.error("===================================================================");
                throw new IllegalStateException(
                        "JWT_SECRET must be configured for non-dev profiles. "
                                + "Set the JWT_SECRET environment variable with at least "
                                + MIN_SECRET_LENGTH + " characters.");
            }
            return;
        }

        String lowerSecret = jwtSecret.toLowerCase();
        boolean isPlaceholder = lowerSecret.contains("change") || lowerSecret.contains("default")
                || lowerSecret.contains("placeholder") || lowerSecret.contains("example");

        if (jwtSecret.length() < MIN_SECRET_LENGTH) {
            if (isDevProfile) {
                log.warn("JWT_SECRET is too short ({} chars, minimum {}). Acceptable only in dev.",
                        jwtSecret.length(), MIN_SECRET_LENGTH);
            } else {
                throw new IllegalStateException(
                        "JWT_SECRET is too short (" + jwtSecret.length()
                                + " chars). Must be at least " + MIN_SECRET_LENGTH + " characters.");
            }
        }

        if (isPlaceholder && !isDevProfile) {
            throw new IllegalStateException(
                    "JWT_SECRET appears to contain a placeholder value. "
                            + "Set a strong, unique secret for production deployments.");
        } else if (isPlaceholder) {
            log.warn("JWT_SECRET contains a placeholder value. Change this before deploying to production.");
        }
    }
}
