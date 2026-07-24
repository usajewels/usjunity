package com.mxsuite.controller;

import com.mxsuite.model.Project;
import com.mxsuite.model.enums.MigrationPhase;
import com.mxsuite.model.enums.MigrationStatus;
import com.mxsuite.repository.PhaseTimeEntryRepository;
import com.mxsuite.repository.ProjectRepository;
import com.mxsuite.service.AnalyticsService;
import com.mxsuite.service.AnalyticsService.*;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.io.PrintWriter;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.*;

@RestController
@RequestMapping("/api/admin/analytics")
@PreAuthorize("hasAnyRole('PLATFORM_ADMIN', 'COACH_ADMIN', 'PLATFORM_SUPPORT')")
@Transactional(readOnly = true)
public class AnalyticsController {

    private final AnalyticsService analyticsService;
    private final ProjectRepository projectRepository;
    private final PhaseTimeEntryRepository phaseTimeEntryRepository;

    private static final DateTimeFormatter CSV_DATE = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss").withZone(ZoneOffset.UTC);
    private static final String[] PHASE_ORDER = {"DISCOVER", "MAP", "GENERATE", "DRY_RUN", "MIGRATE", "CUT_OVER"};

    public AnalyticsController(AnalyticsService analyticsService,
                               ProjectRepository projectRepository,
                               PhaseTimeEntryRepository phaseTimeEntryRepository) {
        this.analyticsService = analyticsService;
        this.projectRepository = projectRepository;
        this.phaseTimeEntryRepository = phaseTimeEntryRepository;
    }

    // Feature 1: Cross-Org Analytics
    @GetMapping("/cross-org")
    public CrossOrgAnalyticsDto getCrossOrgAnalytics() {
        return analyticsService.computeCrossOrgAnalytics();
    }

    // Feature 2: Phase-Level Benchmarks for a project
    @GetMapping("/projects/{projectId}/benchmarks")
    public List<PhaseBenchmarkDto> getProjectBenchmarks(@PathVariable UUID projectId) {
        return analyticsService.computeBenchmarks(projectId);
    }

    // Feature 3: SLA Alerts
    @GetMapping("/alerts")
    public List<SlaAlertDto> getAlerts() {
        return analyticsService.computeAlerts();
    }

    @GetMapping("/alerts/count")
    public Map<String, Long> getAlertCount() {
        return Map.of("count", analyticsService.computeAlertCount());
    }

    // Feature 4: CSV Export — detailed phase times
    @GetMapping("/export/phase-times")
    @PreAuthorize("hasAnyRole('PLATFORM_ADMIN', 'COACH_ADMIN')")
    public void exportPhaseTimes(HttpServletResponse response,
                                 @RequestParam(required = false) String status) throws IOException {
        response.setContentType("text/csv");
        response.setHeader("Content-Disposition", "attachment; filename=\"phase-times-export.csv\"");

        List<Project> projects = getFilteredProjects(status);

        try (PrintWriter w = response.getWriter()) {
            w.println("Project,Tenant,Owner,Status,Phase,Started,Completed,Duration (min),Duration (days)");
            for (Project project : projects) {
                String projName = csvEscape(project.getName());
                String tenant = csvEscape(project.getTenant().getName());
                String owner = csvEscape(project.getOwner().getFirstName() + " " + project.getOwner().getLastName());
                String projStatus = project.getMigrationStatus() != null ? project.getMigrationStatus().name() : "";

                phaseTimeEntryRepository.findByProjectIdOrderByStartedAt(project.getId()).forEach(entry -> {
                    long minutes;
                    if (entry.getCompletedAt() != null) {
                        minutes = java.time.Duration.between(entry.getStartedAt(), entry.getCompletedAt()).toMinutes();
                    } else {
                        minutes = java.time.Duration.between(entry.getStartedAt(), Instant.now()).toMinutes();
                    }
                    double days = minutes / 1440.0;
                    w.printf("%s,%s,%s,%s,%s,%s,%s,%d,%.1f%n",
                            projName, tenant, owner, projStatus,
                            entry.getPhase().name(),
                            CSV_DATE.format(entry.getStartedAt()),
                            entry.getCompletedAt() != null ? CSV_DATE.format(entry.getCompletedAt()) : "",
                            minutes,
                            days);
                });
            }
        }
    }

    // Feature 4: CSV Export — project summary
    @GetMapping("/export/project-summary")
    @PreAuthorize("hasAnyRole('PLATFORM_ADMIN', 'COACH_ADMIN')")
    public void exportProjectSummary(HttpServletResponse response,
                                     @RequestParam(required = false) String status) throws IOException {
        response.setContentType("text/csv");
        response.setHeader("Content-Disposition", "attachment; filename=\"project-summary-export.csv\"");

        List<Project> projects = getFilteredProjects(status);

        try (PrintWriter w = response.getWriter()) {
            w.println("Project,Tenant,Owner,Status,Current Phase,Total (days),DISCOVER (min),MAP (min),GENERATE (min),DRY_RUN (min),MIGRATE (min),CUT_OVER (min),Created");
            for (Project project : projects) {
                Map<String, Long> phaseDurations = new LinkedHashMap<>();
                for (String p : PHASE_ORDER) phaseDurations.put(p, 0L);

                phaseTimeEntryRepository.findByProjectIdOrderByStartedAt(project.getId()).forEach(entry -> {
                    long minutes;
                    if (entry.getCompletedAt() != null) {
                        minutes = java.time.Duration.between(entry.getStartedAt(), entry.getCompletedAt()).toMinutes();
                    } else {
                        minutes = java.time.Duration.between(entry.getStartedAt(), Instant.now()).toMinutes();
                    }
                    phaseDurations.put(entry.getPhase().name(), minutes);
                });

                long totalMinutes = phaseDurations.values().stream().mapToLong(Long::longValue).sum();
                double totalDays = totalMinutes / 1440.0;

                w.printf("%s,%s,%s,%s,%s,%.1f,%d,%d,%d,%d,%d,%d,%s%n",
                        csvEscape(project.getName()),
                        csvEscape(project.getTenant().getName()),
                        csvEscape(project.getOwner().getFirstName() + " " + project.getOwner().getLastName()),
                        project.getMigrationStatus() != null ? project.getMigrationStatus().name() : "",
                        project.getMigrationPhase() != null ? project.getMigrationPhase().name() : "",
                        totalDays,
                        phaseDurations.get("DISCOVER"),
                        phaseDurations.get("MAP"),
                        phaseDurations.get("GENERATE"),
                        phaseDurations.get("DRY_RUN"),
                        phaseDurations.get("MIGRATE"),
                        phaseDurations.get("CUT_OVER"),
                        CSV_DATE.format(project.getCreatedAt()));
            }
        }
    }

    // Feature 5: Coach Performance
    @GetMapping("/coach-performance")
    @PreAuthorize("hasAnyRole('PLATFORM_ADMIN', 'COACH_ADMIN')")
    public CoachLeaderboardDto getCoachPerformance() {
        return analyticsService.computeCoachPerformance();
    }

    // --- Helpers ---

    private List<Project> getFilteredProjects(String status) {
        List<Project> projects = projectRepository.findAllMigrationProjectsUnpaged();
        if (status != null && !status.isBlank()) {
            MigrationStatus ms = MigrationStatus.valueOf(status.toUpperCase());
            projects = projects.stream().filter(p -> p.getMigrationStatus() == ms).toList();
        }
        return projects;
    }

    private String csvEscape(String value) {
        if (value == null) return "";
        if (value.contains(",") || value.contains("\"") || value.contains("\n")) {
            return "\"" + value.replace("\"", "\"\"") + "\"";
        }
        return value;
    }
}
