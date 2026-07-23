package com.mxsuite.service;

import com.mxsuite.model.ProjectDataUpload;
import com.mxsuite.model.enums.UploadStatus;
import com.mxsuite.repository.ProjectDataUploadRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.BufferedReader;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Map;
import java.util.UUID;

/**
 * Processes large CSV files asynchronously after chunked upload.
 * Streams rows line-by-line to avoid loading the entire file into memory.
 * Broadcasts progress via WebSocket for real-time UI updates.
 */
@Service
public class BatchImportService {

    private static final Logger log = LoggerFactory.getLogger(BatchImportService.class);
    private static final int PROGRESS_BROADCAST_INTERVAL = 1000;
    private static final int DB_UPDATE_INTERVAL = 5000;

    private final ProjectDataUploadRepository uploadRepository;
    private final SimpMessagingTemplate messagingTemplate;

    public BatchImportService(ProjectDataUploadRepository uploadRepository,
                              SimpMessagingTemplate messagingTemplate) {
        this.uploadRepository = uploadRepository;
        this.messagingTemplate = messagingTemplate;
    }

    @Async("importExecutor")
    public void processImport(UUID projectId, UUID uploadId, UUID userId) {
        log.info("Starting batch import for project={} upload={}", projectId, uploadId);

        ProjectDataUpload upload = uploadRepository.findById(uploadId).orElse(null);
        if (upload == null) {
            log.error("Upload not found: {}", uploadId);
            return;
        }

        Path filePath = Paths.get(upload.getStoragePath());
        if (!Files.exists(filePath)) {
            updateStatus(upload, "FAILED", 0, 0, "File not found: " + filePath);
            broadcastProgress(userId, upload);
            return;
        }

        try (BufferedReader reader = Files.newBufferedReader(filePath, StandardCharsets.UTF_8)) {
            // Skip header line
            String headerLine = reader.readLine();
            if (headerLine == null) {
                updateStatus(upload, "FAILED", 0, 0, "File is empty");
                broadcastProgress(userId, upload);
                return;
            }

            int totalRows = upload.getRowCount() != null ? upload.getRowCount() : 0;
            int processedRows = 0;
            String line;

            while ((line = reader.readLine()) != null) {
                if (line.isBlank()) continue;

                // Process the row — apply mapping rules
                processRow(line, processedRows);
                processedRows++;

                // Broadcast progress periodically
                if (processedRows % PROGRESS_BROADCAST_INTERVAL == 0) {
                    int pct = totalRows > 0 ? (int) ((long) processedRows * 100 / totalRows) : 0;
                    upload.setImportProgressPct(pct);
                    upload.setImportedRowCount(processedRows);
                    broadcastProgress(userId, upload);
                }

                // Persist to DB less frequently
                if (processedRows % DB_UPDATE_INTERVAL == 0) {
                    int pct = totalRows > 0 ? (int) ((long) processedRows * 100 / totalRows) : 0;
                    updateStatus(upload, "PROCESSING", pct, processedRows, null);
                }
            }

            // Final update
            updateStatus(upload, "COMPLETED", 100, processedRows, null);
            upload.setUploadStatus(UploadStatus.COMPLETED);
            uploadRepository.save(upload);
            broadcastProgress(userId, upload);

            log.info("Batch import completed for project={}: {} rows processed", projectId, processedRows);

        } catch (IOException e) {
            log.error("Batch import failed for project={}: {}", projectId, e.getMessage(), e);
            updateStatus(upload, "FAILED", upload.getImportProgressPct(),
                    upload.getImportedRowCount(), e.getMessage());
            broadcastProgress(userId, upload);
        }
    }

    /**
     * Process a single row. This is where mapping rules would be applied
     * to transform source data into target format.
     * Currently a placeholder — actual transformation logic will be added
     * when the target data model is finalized.
     */
    private void processRow(String csvLine, int rowIndex) {
        // TODO: Apply approved mapping rules to transform and insert the row
        // For now, this counts rows and tracks progress.
        // Future implementation will:
        // 1. Parse the CSV line
        // 2. Look up approved field mappings for this project
        // 3. Transform source fields to target fields
        // 4. Insert into target tables in batches
    }

    @Transactional
    protected void updateStatus(ProjectDataUpload upload, String status, int pct, int rowCount, String error) {
        upload.setImportStatus(status);
        upload.setImportProgressPct(pct);
        upload.setImportedRowCount(rowCount);
        upload.setImportError(error);
        uploadRepository.save(upload);
    }

    private void broadcastProgress(UUID userId, ProjectDataUpload upload) {
        try {
            Map<String, Object> payload = Map.of(
                    "status", upload.getImportStatus() != null ? upload.getImportStatus() : "NONE",
                    "progressPct", upload.getImportProgressPct() != null ? upload.getImportProgressPct() : 0,
                    "importedRowCount", upload.getImportedRowCount() != null ? upload.getImportedRowCount() : 0,
                    "totalRowCount", upload.getRowCount() != null ? upload.getRowCount() : 0
            );
            messagingTemplate.convertAndSendToUser(
                    userId.toString(), "/queue/import-progress", payload);
        } catch (Exception e) {
            log.debug("Failed to broadcast import progress: {}", e.getMessage());
        }
    }
}
