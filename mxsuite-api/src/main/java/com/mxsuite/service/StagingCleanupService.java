package com.mxsuite.service;

import com.mxsuite.model.ProjectDataUpload;
import com.mxsuite.repository.ProjectDataUploadRepository;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;

/**
 * Safety-net cleanup: drops staging schemas/databases for uploads that have been
 * exported to S3 but whose staging data was not cleaned up (e.g., due to a crash).
 * Runs daily.
 */
@Service
@ConditionalOnBean(StagingService.class)
public class StagingCleanupService {

    private static final Logger log = LoggerFactory.getLogger(StagingCleanupService.class);

    private final ProjectDataUploadRepository uploadRepository;
    private final StagingService stagingService;
    private final Counter cleanupCounter;
    private final Counter stagingRowsCounter;
    private final Counter exportFilesCounter;
    private final Timer stagingTimer;
    private final Timer exportTimer;

    public StagingCleanupService(ProjectDataUploadRepository uploadRepository,
                                  StagingService stagingService,
                                  MeterRegistry meterRegistry) {
        this.uploadRepository = uploadRepository;
        this.stagingService = stagingService;

        this.cleanupCounter = Counter.builder("mxsuite.staging.cleanup")
                .description("Number of stale staging schemas cleaned up")
                .register(meterRegistry);
        this.stagingRowsCounter = Counter.builder("mxsuite.staging.rows")
                .description("Total rows staged to SQL Server")
                .register(meterRegistry);
        this.exportFilesCounter = Counter.builder("mxsuite.export.files")
                .description("Total Parquet files exported to S3")
                .register(meterRegistry);
        this.stagingTimer = Timer.builder("mxsuite.staging.duration")
                .description("Time to stage upload data")
                .register(meterRegistry);
        this.exportTimer = Timer.builder("mxsuite.export.duration")
                .description("Time to export Parquet to S3")
                .register(meterRegistry);
    }

    /**
     * Run daily at 3 AM — clean up staging data for uploads that were exported
     * more than 7 days ago but still have staging status = STAGED.
     */
    @Scheduled(cron = "0 0 3 * * *")
    public void cleanupStaleStagingData() {
        Instant cutoff = Instant.now().minus(7, ChronoUnit.DAYS);
        List<ProjectDataUpload> stale = uploadRepository.findStaleStagingAfterExport(cutoff);

        if (stale.isEmpty()) {
            log.debug("No stale staging data to clean up");
            return;
        }

        log.info("Found {} uploads with stale staging data, cleaning up...", stale.size());
        for (ProjectDataUpload upload : stale) {
            try {
                stagingService.dropStaging(upload.getId());
                cleanupCounter.increment();
                log.info("Cleaned up stale staging for upload={}", upload.getId());
            } catch (Exception e) {
                log.warn("Failed to clean up staging for upload={}: {}", upload.getId(), e.getMessage());
            }
        }
    }

    // --- Metrics accessors for other services to record ---

    public void recordStagingRows(long rows) {
        stagingRowsCounter.increment(rows);
    }

    public void recordExportFiles(int files) {
        exportFilesCounter.increment(files);
    }

    public Timer getStagingTimer() {
        return stagingTimer;
    }

    public Timer getExportTimer() {
        return exportTimer;
    }
}
