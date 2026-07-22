package com.mxsuite.config;

import com.mxsuite.model.Tenant;
import com.mxsuite.model.User;
import com.mxsuite.model.enums.TenantType;
import com.mxsuite.model.enums.UserRole;
import com.mxsuite.repository.TenantRepository;
import com.mxsuite.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Bootstraps the platform tenant and admin user on first startup.
 * <p>
 * Reads admin credentials from environment variables (via .env file).
 * If no PLATFORM_ADMIN user exists, one is created automatically.
 * This ensures the system is usable immediately after deployment.
 *
 * @author Joseph M. Vogel
 */
@Component
public class DataInitializer {

    private static final Logger log = LoggerFactory.getLogger(DataInitializer.class);

    private final TenantRepository tenantRepository;
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    @Value("${mxsuite.bootstrap.admin-email:admin@mxsuite.com}")
    private String adminEmail;

    @Value("${mxsuite.bootstrap.admin-password:#{null}}")
    private String adminPassword;

    @Value("${mxsuite.bootstrap.admin-first-name:Platform}")
    private String adminFirstName;

    @Value("${mxsuite.bootstrap.admin-last-name:Admin}")
    private String adminLastName;

    public DataInitializer(TenantRepository tenantRepository,
                           UserRepository userRepository,
                           PasswordEncoder passwordEncoder) {
        this.tenantRepository = tenantRepository;
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
    }

    @EventListener(ApplicationReadyEvent.class)
    @Transactional
    public void initialize() {
        ensurePlatformTenant();
        ensurePlatformAdmin();
    }

    private void ensurePlatformTenant() {
        if (tenantRepository.findBySlug("platform").isPresent()) {
            log.debug("Platform tenant already exists");
            return;
        }

        Tenant platform = new Tenant();
        platform.setName("MXSuite Platform");
        platform.setSlug("platform");
        platform.setTenantType(TenantType.PLATFORM);
        platform.setActive(true);
        tenantRepository.save(platform);
        log.info("Created platform tenant");
    }

    private void ensurePlatformAdmin() {
        // Check if any PLATFORM_ADMIN exists
        boolean adminExists = userRepository.findAll().stream()
                .anyMatch(u -> u.getRole() == UserRole.PLATFORM_ADMIN && u.isActive());

        if (adminExists) {
            log.debug("Platform admin user already exists");
            return;
        }

        if (adminPassword == null || adminPassword.isBlank()) {
            log.warn("===================================================================");
            log.warn("  No PLATFORM_ADMIN user exists and no bootstrap password is set.");
            log.warn("  Set MXSUITE_ADMIN_PASSWORD in your .env file to create one.");
            log.warn("===================================================================");
            return;
        }

        Tenant platform = tenantRepository.findBySlug("platform").orElseThrow(
                () -> new IllegalStateException("Platform tenant must exist before creating admin user"));

        User admin = new User();
        admin.setEmail(adminEmail.toLowerCase().trim());
        admin.setPasswordHash(passwordEncoder.encode(adminPassword));
        admin.setFirstName(adminFirstName);
        admin.setLastName(adminLastName);
        admin.setRole(UserRole.PLATFORM_ADMIN);
        admin.setTenant(platform);
        admin.setActive(true);
        userRepository.save(admin);

        log.info("===================================================================");
        log.info("  Platform admin user created: {}", adminEmail);
        log.info("  IMPORTANT: Change the default password immediately after first login.");
        log.info("===================================================================");
    }
}
