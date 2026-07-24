package com.mxsuite.service;

import com.mxsuite.config.AnalyticsProperties;
import com.mxsuite.model.PhaseTimeEntry;
import com.mxsuite.model.Project;
import com.mxsuite.model.User;
import com.mxsuite.model.enums.MigrationPhase;
import com.mxsuite.model.enums.MigrationStatus;
import com.mxsuite.repository.PhaseTimeEntryRepository;
import com.mxsuite.repository.ProjectRepository;
import com.mxsuite.repository.UserRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

@Service
@Transactional(readOnly = true)
public class AnalyticsService {

    private final PhaseTimeEntryRepository phaseTimeEntryRepository;
    private final ProjectRepository projectRepository;
    private final UserRepository userRepository;
    private final AnalyticsProperties analyticsProperties;

    public AnalyticsService(PhaseTimeEntryRepository phaseTimeEntryRepository,
                            ProjectRepository projectRepository,
                            UserRepository userRepository,
                            AnalyticsProperties analyticsProperties) {
        this.phaseTimeEntryRepository = phaseTimeEntryRepository;
        this.projectRepository = projectRepository;
        this.userRepository = userRepository;
        this.analyticsProperties = analyticsProperties;
    }

    // --- DTOs ---

    public record PhaseAvgDurationDto(String phase, double avgMinutes, double medianMinutes, long projectCount) {}
    public record CycleTimeTrendPointDto(String month, double avgCycleTimeDays, long completedCount) {}

    public record CrossOrgAnalyticsDto(
            long totalCompleted, long totalInFlight, long totalCancelled,
            double avgCycleTimeDays,
            List<PhaseAvgDurationDto> avgDurationPerPhase,
            Map<String, Long> phaseDistribution,
            List<CycleTimeTrendPointDto> cycleTimeTrend) {}

    public record PhaseBenchmarkDto(
            String phase, long projectDurationMinutes, double platformAvgMinutes,
            double percentAboveAvg, boolean significantlySlower) {}

    public record SlaAlertDto(
            UUID projectId, String projectName, String tenantName, String ownerName,
            String phase, long minutesInPhase, long thresholdMinutes, double percentOverThreshold) {}

    public record CoachPerformanceDto(
            UUID coachId, String coachName, String coachEmail,
            long projectsCompleted, long projectsInFlight, double avgCycleTimeDays,
            List<PhaseAvgDurationDto> phaseBreakdown) {}

    public record CoachLeaderboardDto(List<CoachPerformanceDto> coaches, double overallAvgCycleTimeDays) {}

    // --- Feature 1: Cross-Org Analytics ---

    public CrossOrgAnalyticsDto computeCrossOrgAnalytics() {
        long completed = projectRepository.countByMigrationStatus(MigrationStatus.COMPLETED);
        long inFlight = projectRepository.countAllActiveMigrations();
        long cancelled = projectRepository.countByMigrationStatus(MigrationStatus.CANCELLED);

        Double avgDays = phaseTimeEntryRepository.computeAvgCycleTimeDays();
        double avgCycleTime = avgDays != null ? avgDays : 0.0;

        List<PhaseAvgDurationDto> avgPerPhase = computeAvgDurationPerPhase();
        Map<String, Long> distribution = computePhaseDistribution();
        List<CycleTimeTrendPointDto> trend = computeCycleTimeTrend();

        return new CrossOrgAnalyticsDto(completed, inFlight, cancelled, avgCycleTime, avgPerPhase, distribution, trend);
    }

    public List<PhaseAvgDurationDto> computeAvgDurationPerPhase() {
        return phaseTimeEntryRepository.computeAvgDurationPerPhase().stream()
                .map(row -> new PhaseAvgDurationDto(
                        (String) row[0],
                        ((Number) row[1]).doubleValue(),
                        ((Number) row[2]).doubleValue(),
                        ((Number) row[3]).longValue()))
                .toList();
    }

    public Map<String, Long> computePhaseDistribution() {
        Map<String, Long> result = new LinkedHashMap<>();
        for (MigrationPhase phase : MigrationPhase.values()) {
            result.put(phase.name(), 0L);
        }
        projectRepository.countActiveProjectsByPhase().forEach(row -> {
            MigrationPhase phase = (MigrationPhase) row[0];
            long count = ((Number) row[1]).longValue();
            result.put(phase.name(), count);
        });
        return result;
    }

    public List<CycleTimeTrendPointDto> computeCycleTimeTrend() {
        return phaseTimeEntryRepository.computeCycleTimeTrendByMonth().stream()
                .map(row -> new CycleTimeTrendPointDto(
                        (String) row[0],
                        ((Number) row[1]).doubleValue(),
                        ((Number) row[2]).longValue()))
                .toList();
    }

    // --- Feature 2: Phase-Level Benchmarking ---

    public List<PhaseBenchmarkDto> computeBenchmarks(UUID projectId) {
        List<PhaseTimeEntry> entries = phaseTimeEntryRepository.findByProjectIdOrderByStartedAt(projectId);
        Map<String, Double> platformAvgs = computeAvgDurationPerPhase().stream()
                .collect(Collectors.toMap(PhaseAvgDurationDto::phase, PhaseAvgDurationDto::avgMinutes));

        List<PhaseBenchmarkDto> benchmarks = new ArrayList<>();
        for (PhaseTimeEntry entry : entries) {
            String phase = entry.getPhase().name();
            long durationMinutes;
            if (entry.getCompletedAt() != null) {
                durationMinutes = Duration.between(entry.getStartedAt(), entry.getCompletedAt()).toMinutes();
            } else {
                durationMinutes = Duration.between(entry.getStartedAt(), Instant.now()).toMinutes();
            }

            Double avg = platformAvgs.get(phase);
            if (avg == null || avg <= 0) continue;

            double percentAbove = ((durationMinutes - avg) / avg) * 100.0;
            benchmarks.add(new PhaseBenchmarkDto(phase, durationMinutes, avg, percentAbove, percentAbove > 50.0));
        }
        return benchmarks;
    }

    // --- Feature 3: SLA Alerts ---

    public List<SlaAlertDto> computeAlerts() {
        Map<String, Long> thresholds = analyticsProperties.phaseThresholdsMinutes();
        List<PhaseTimeEntry> activeEntries = phaseTimeEntryRepository.findAllActivePhaseEntries();
        Instant now = Instant.now();

        List<SlaAlertDto> alerts = new ArrayList<>();
        for (PhaseTimeEntry entry : activeEntries) {
            String phase = entry.getPhase().name();
            Long threshold = thresholds.get(phase);
            if (threshold == null) continue;

            long minutesInPhase = Duration.between(entry.getStartedAt(), now).toMinutes();
            if (minutesInPhase > threshold) {
                Project project = entry.getProject();
                double pctOver = ((minutesInPhase - threshold) / (double) threshold) * 100.0;
                alerts.add(new SlaAlertDto(
                        project.getId(),
                        project.getName(),
                        project.getTenant().getName(),
                        project.getOwner().getFirstName() + " " + project.getOwner().getLastName(),
                        phase,
                        minutesInPhase,
                        threshold,
                        pctOver));
            }
        }
        alerts.sort(Comparator.comparingDouble(SlaAlertDto::percentOverThreshold).reversed());
        return alerts;
    }

    public long computeAlertCount() {
        return computeAlerts().size();
    }

    // --- Feature 5: Coach Performance ---

    public CoachLeaderboardDto computeCoachPerformance() {
        List<User> coaches = userRepository.findActiveCoaches();
        Double overallAvg = phaseTimeEntryRepository.computeAvgCycleTimeDays();
        double overallAvgDays = overallAvg != null ? overallAvg : 0.0;

        List<CoachPerformanceDto> coachMetrics = new ArrayList<>();
        for (User coach : coaches) {
            UUID coachId = coach.getId();
            long completed = projectRepository.countByOwnerIdAndMigrationStatus(coachId, MigrationStatus.COMPLETED);
            long inFlight = projectRepository.countActiveByOwnerId(coachId);

            // Compute per-coach avg cycle time
            double avgDays = 0.0;
            if (completed > 0) {
                // Use phase time entries to compute coach's avg cycle time
                List<PhaseTimeEntry> allEntries = phaseTimeEntryRepository.findByProjectIdOrderByStartedAt(coachId);
                // Instead use the per-owner query approach — compute from projects
                avgDays = computeCoachAvgCycleTime(coachId);
            }

            List<PhaseAvgDurationDto> breakdown = phaseTimeEntryRepository
                    .computeAvgDurationPerPhaseByOwner(coachId).stream()
                    .map(row -> new PhaseAvgDurationDto(
                            (String) row[0],
                            ((Number) row[1]).doubleValue(),
                            0.0, // no median for per-coach
                            ((Number) row[2]).longValue()))
                    .toList();

            coachMetrics.add(new CoachPerformanceDto(
                    coachId,
                    coach.getFirstName() + " " + coach.getLastName(),
                    coach.getEmail(),
                    completed, inFlight, avgDays, breakdown));
        }

        coachMetrics.sort(Comparator.comparingDouble(CoachPerformanceDto::avgCycleTimeDays));
        return new CoachLeaderboardDto(coachMetrics, overallAvgDays);
    }

    private double computeCoachAvgCycleTime(UUID coachId) {
        // Get all completed projects for this coach
        List<Project> projects = projectRepository.findAllMigrationProjectsUnpaged().stream()
                .filter(p -> p.getOwner().getId().equals(coachId))
                .filter(p -> p.getMigrationStatus() == MigrationStatus.COMPLETED)
                .toList();

        if (projects.isEmpty()) return 0.0;

        double totalDays = 0.0;
        int count = 0;
        for (Project project : projects) {
            List<PhaseTimeEntry> entries = phaseTimeEntryRepository.findByProjectIdOrderByStartedAt(project.getId());
            if (entries.isEmpty()) continue;

            Instant start = entries.getFirst().getStartedAt();
            Instant end = entries.stream()
                    .filter(e -> e.getCompletedAt() != null)
                    .map(PhaseTimeEntry::getCompletedAt)
                    .max(Instant::compareTo)
                    .orElse(null);
            if (end == null) continue;

            totalDays += Duration.between(start, end).toMinutes() / 1440.0;
            count++;
        }
        return count > 0 ? totalDays / count : 0.0;
    }
}
