package com.mxsuite.controller;

import com.mxsuite.model.Invitation;
import com.mxsuite.model.enums.TenantType;
import com.mxsuite.model.enums.UserRole;
import com.mxsuite.repository.*;
import com.mxsuite.security.ActiveSessionRegistry;
import io.micrometer.core.instrument.*;
import org.springframework.boot.SpringBootVersion;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.lang.management.ManagementFactory;
import java.lang.management.MemoryMXBean;
import java.lang.management.OperatingSystemMXBean;
import java.lang.management.RuntimeMXBean;
import java.lang.management.ThreadMXBean;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;

@RestController
@RequestMapping("/api/admin/platform-dashboard")
@PreAuthorize("hasRole('PLATFORM_ADMIN')")
@Transactional(readOnly = true)
public class AdminDashboardController {

    private final TenantRepository tenantRepository;
    private final UserRepository userRepository;
    private final ProjectRepository projectRepository;
    private final ProjectAssetRepository assetRepository;
    private final InvitationRepository invitationRepository;
    private final AuditEventRepository auditEventRepository;
    private final ActiveSessionRegistry sessionRegistry;
    private final MeterRegistry meterRegistry;

    public AdminDashboardController(TenantRepository tenantRepository,
                                     UserRepository userRepository,
                                     ProjectRepository projectRepository,
                                     ProjectAssetRepository assetRepository,
                                     InvitationRepository invitationRepository,
                                     AuditEventRepository auditEventRepository,
                                     ActiveSessionRegistry sessionRegistry,
                                     MeterRegistry meterRegistry) {
        this.tenantRepository = tenantRepository;
        this.userRepository = userRepository;
        this.projectRepository = projectRepository;
        this.assetRepository = assetRepository;
        this.invitationRepository = invitationRepository;
        this.auditEventRepository = auditEventRepository;
        this.sessionRegistry = sessionRegistry;
        this.meterRegistry = meterRegistry;
    }

    // --- DTOs ---

    public record AdminDashboardDto(
            long totalOrganizations,
            long totalUsers,
            long activeCoaches,
            long onboardingsInProgress,
            SystemHealthDto systemHealth,
            List<DependencyDto> dependencies,
            List<ActiveSessionDto> activeSessions,
            ApiMetricsDto apiMetrics,
            StorageDto storage,
            AuditStatsDto auditStats,
            InvitationStatsDto invitationStats) {}

    public record SystemHealthDto(
            long heapUsed,
            long heapMax,
            long nonHeapUsed,
            int threadCount,
            int peakThreadCount,
            int daemonThreadCount,
            double cpuUsage,
            long uptimeMillis,
            String javaVersion,
            String springBootVersion,
            String osName,
            int availableProcessors,
            int dbPoolActive,
            int dbPoolIdle,
            int dbPoolMax) {}

    public record DependencyDto(
            String group,
            String name,
            String version,
            String category) {}

    public record ActiveSessionDto(
            String userId,
            String email,
            String fullName,
            String role,
            String tenantName,
            String firstSeen,
            String lastActive,
            String ipAddress) {}

    public record ApiMetricsDto(
            long totalRequests,
            double avgResponseMs,
            double maxResponseMs,
            long clientErrors,
            long serverErrors,
            List<EndpointMetricDto> topEndpoints) {}

    public record EndpointMetricDto(
            String method,
            String uri,
            long count,
            double avgMs) {}

    public record StorageDto(
            long totalFiles,
            long totalBytes) {}

    public record AuditStatsDto(
            long eventsToday,
            long eventsThisWeek,
            long eventsThisMonth) {}

    public record InvitationStatsDto(
            long pending,
            long accepted,
            long total) {}

    // --- Endpoint ---

    @GetMapping
    public ResponseEntity<AdminDashboardDto> getDashboard() {

        // Platform stats
        long totalOrgs = tenantRepository.findAll().stream()
                .filter(t -> t.getTenantType() == TenantType.CUSTOMER)
                .count();
        long totalUsers = userRepository.countByActive(true);
        long activeCoaches = userRepository.findByRoleIn(
                List.of(UserRole.PLATFORM_SUPPORT)).stream()
                .filter(u -> u.isActive())
                .count();
        long onboardingsInProgress = projectRepository.countAllActiveMigrations();

        // System health
        SystemHealthDto systemHealth = buildSystemHealth();

        // Dependencies
        List<DependencyDto> dependencies = buildDependencies();

        // Active sessions
        List<ActiveSessionDto> activeSessions = sessionRegistry.getActiveSessions().stream()
                .map(s -> new ActiveSessionDto(
                        s.userId().toString(),
                        s.email(),
                        s.fullName(),
                        s.role(),
                        s.tenantName(),
                        s.firstSeen().toString(),
                        s.lastActive().toString(),
                        s.ipAddress()))
                .toList();

        // API metrics
        ApiMetricsDto apiMetrics = buildApiMetrics();

        // Storage
        StorageDto storage = buildStorage();

        // Audit stats
        AuditStatsDto auditStats = buildAuditStats();

        // Invitation stats
        InvitationStatsDto invitationStats = buildInvitationStats();

        return ResponseEntity.ok(new AdminDashboardDto(
                totalOrgs,
                totalUsers,
                activeCoaches,
                onboardingsInProgress,
                systemHealth,
                dependencies,
                activeSessions,
                apiMetrics,
                storage,
                auditStats,
                invitationStats));
    }

    // --- Helpers ---

    private SystemHealthDto buildSystemHealth() {
        MemoryMXBean memory = ManagementFactory.getMemoryMXBean();
        ThreadMXBean threads = ManagementFactory.getThreadMXBean();
        RuntimeMXBean runtime = ManagementFactory.getRuntimeMXBean();
        OperatingSystemMXBean os = ManagementFactory.getOperatingSystemMXBean();

        long heapUsed = memory.getHeapMemoryUsage().getUsed();
        long heapMax = memory.getHeapMemoryUsage().getMax();
        long nonHeapUsed = memory.getNonHeapMemoryUsage().getUsed();

        double cpuUsage = -1;
        if (os instanceof com.sun.management.OperatingSystemMXBean sunOs) {
            cpuUsage = sunOs.getProcessCpuLoad();
        }

        int dbPoolActive = (int) gaugeValue("hikaricp.connections.active");
        int dbPoolIdle = (int) gaugeValue("hikaricp.connections.idle");
        int dbPoolMax = (int) gaugeValue("hikaricp.connections.max");

        return new SystemHealthDto(
                heapUsed, heapMax, nonHeapUsed,
                threads.getThreadCount(), threads.getPeakThreadCount(), threads.getDaemonThreadCount(),
                cpuUsage, runtime.getUptime(),
                System.getProperty("java.version"),
                SpringBootVersion.getVersion(),
                os.getName() + " " + os.getArch(),
                os.getAvailableProcessors(),
                dbPoolActive, dbPoolIdle, dbPoolMax);
    }

    private ApiMetricsDto buildApiMetrics() {
        // Read HTTP server request metrics from Micrometer
        var timers = meterRegistry.find("http.server.requests").timers();
        long totalRequests = 0;
        double totalTime = 0;
        double maxResponse = 0;
        long clientErrors = 0;
        long serverErrors = 0;
        List<EndpointMetricDto> endpoints = new ArrayList<>();

        for (Timer timer : timers) {
            long count = timer.count();
            if (count == 0) continue;

            totalRequests += count;
            totalTime += timer.totalTime(java.util.concurrent.TimeUnit.MILLISECONDS);
            double maxMs = timer.max(java.util.concurrent.TimeUnit.MILLISECONDS);
            if (maxMs > maxResponse) maxResponse = maxMs;

            // Parse tags for status and URI
            String status = timer.getId().getTag("status");
            String uri = timer.getId().getTag("uri");
            String method = timer.getId().getTag("method");

            if (status != null) {
                int statusCode = Integer.parseInt(status);
                if (statusCode >= 400 && statusCode < 500) clientErrors += count;
                if (statusCode >= 500) serverErrors += count;
            }

            if (uri != null && !uri.startsWith("/actuator") && count > 2) {
                double avgMs = timer.totalTime(java.util.concurrent.TimeUnit.MILLISECONDS) / count;
                endpoints.add(new EndpointMetricDto(
                        method != null ? method : "?",
                        uri, count, Math.round(avgMs * 10.0) / 10.0));
            }
        }

        // Sort by count descending, take top 10
        endpoints.sort((a, b) -> Long.compare(b.count(), a.count()));
        if (endpoints.size() > 10) {
            endpoints = endpoints.subList(0, 10);
        }

        double avgResponseMs = totalRequests > 0 ? Math.round((totalTime / totalRequests) * 10.0) / 10.0 : 0;

        return new ApiMetricsDto(
                totalRequests, avgResponseMs,
                Math.round(maxResponse * 10.0) / 10.0,
                clientErrors, serverErrors, endpoints);
    }

    private StorageDto buildStorage() {
        long totalFiles = assetRepository.count();
        long totalBytes = assetRepository.sumAllFileSize();
        return new StorageDto(totalFiles, totalBytes);
    }

    private AuditStatsDto buildAuditStats() {
        Instant now = Instant.now();
        Instant startOfDay = now.truncatedTo(ChronoUnit.DAYS);
        Instant startOfWeek = now.minus(7, ChronoUnit.DAYS);
        Instant startOfMonth = now.minus(30, ChronoUnit.DAYS);

        long eventsToday = auditEventRepository.countByTimestampAfter(startOfDay);
        long eventsThisWeek = auditEventRepository.countByTimestampAfter(startOfWeek);
        long eventsThisMonth = auditEventRepository.countByTimestampAfter(startOfMonth);

        return new AuditStatsDto(eventsToday, eventsThisWeek, eventsThisMonth);
    }

    private InvitationStatsDto buildInvitationStats() {
        long pending = invitationRepository.countByStatus(Invitation.InvitationStatus.PENDING);
        long accepted = invitationRepository.countByStatus(Invitation.InvitationStatus.ACCEPTED);
        long total = invitationRepository.count();
        return new InvitationStatsDto(pending, accepted, total);
    }

    private double gaugeValue(String metricName) {
        Gauge gauge = meterRegistry.find(metricName).gauge();
        return gauge != null ? gauge.value() : 0;
    }

    private List<DependencyDto> buildDependencies() {
        List<DependencyDto> deps = new ArrayList<>();

        deps.add(dep("org.springframework.boot", "Spring Boot",
                SpringBootVersion.getVersion(), "Framework"));
        deps.add(dep("org.springframework.security", "Spring Security",
                packageVersion(org.springframework.security.core.SpringSecurityCoreVersion.class), "Security"));
        deps.add(dep("org.springframework.data", "Spring Data JPA",
                packageVersion(org.springframework.data.jpa.repository.JpaRepository.class), "Framework"));
        deps.add(dep("org.postgresql", "PostgreSQL Driver",
                classVersion("org.postgresql.Driver"), "Database"));
        deps.add(dep("org.flywaydb", "Flyway",
                packageVersion(org.flywaydb.core.Flyway.class), "Database"));
        deps.add(dep("io.micrometer", "Micrometer Core",
                packageVersion(io.micrometer.core.instrument.MeterRegistry.class), "Observability"));
        deps.add(dep("io.jsonwebtoken", "JJWT",
                packageVersion(io.jsonwebtoken.Jwts.class), "Security"));
        deps.add(dep("org.springdoc", "SpringDoc OpenAPI",
                packageVersion(org.springdoc.core.configuration.SpringDocConfiguration.class), "Documentation"));
        deps.add(dep("org.apache.poi", "Apache POI",
                packageVersion(org.apache.poi.ss.usermodel.Workbook.class), "File Processing"));
        deps.add(dep("com.fasterxml.jackson.core", "Jackson",
                packageVersion(com.fasterxml.jackson.core.JsonFactory.class), "Serialization"));
        deps.add(dep("org.apache.tomcat.embed", "Embedded Tomcat",
                packageVersion(org.apache.catalina.startup.Tomcat.class), "Server"));
        deps.add(dep("com.zaxxer", "HikariCP",
                packageVersion(com.zaxxer.hikari.HikariDataSource.class), "Database"));
        deps.add(dep("org.hibernate.orm", "Hibernate",
                packageVersion(org.hibernate.Session.class), "ORM"));
        deps.add(dep("ch.qos.logback", "Logback",
                packageVersion(ch.qos.logback.classic.Logger.class), "Logging"));
        deps.add(dep("org.projectlombok", "Lombok",
                "1.18.34", "Dev Tools"));

        return deps;
    }

    private static DependencyDto dep(String group, String name, String version, String category) {
        return new DependencyDto(group, name, version != null ? version : "unknown", category);
    }

    private static String packageVersion(Class<?> clazz) {
        Package pkg = clazz.getPackage();
        if (pkg != null) {
            String v = pkg.getImplementationVersion();
            if (v != null) return v;
            v = pkg.getSpecificationVersion();
            if (v != null) return v;
        }
        return null;
    }

    /** Load a class by name at runtime (for runtime-scoped deps like the PG driver). */
    private static String classVersion(String className) {
        try {
            return packageVersion(Class.forName(className));
        } catch (ClassNotFoundException e) {
            return null;
        }
    }
}
