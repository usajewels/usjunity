package com.mxsuite.controller;

import com.mxsuite.audit.AuditService;
import com.mxsuite.model.Onboarding;
import com.mxsuite.model.enums.OnboardingStatus;
import com.mxsuite.repository.OnboardingRepository;
import com.mxsuite.repository.TenantRepository;
import com.mxsuite.repository.UserRepository;
import com.mxsuite.security.TenantContext;
import com.mxsuite.security.UserPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import org.apache.poi.ss.usermodel.*;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.DataFormatter;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.ss.usermodel.WorkbookFactory;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.*;

@RestController
@RequestMapping("/api/onboarding")
@Transactional(readOnly = true)
public class OnboardingController {

    private static final Logger log = LoggerFactory.getLogger(OnboardingController.class);
    private static final long MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
    private static final int SAMPLE_ROWS = 5;
    private static final int PREVIEW_ROWS = 10;

    private final OnboardingRepository onboardingRepository;
    private final TenantRepository tenantRepository;
    private final UserRepository userRepository;
    private final AuditService auditService;
    private final String basePath;

    public OnboardingController(OnboardingRepository onboardingRepository,
                                TenantRepository tenantRepository,
                                UserRepository userRepository,
                                AuditService auditService,
                                @Value("${mxsuite.storage.local.base-path}") String basePath) {
        this.onboardingRepository = onboardingRepository;
        this.tenantRepository = tenantRepository;
        this.userRepository = userRepository;
        this.auditService = auditService;
        this.basePath = basePath;
    }

    public record UpdateOnboardingRequest(
            OnboardingStatus status,
            Integer currentStep,
            List<Map<String, Object>> targetSchema,
            List<Map<String, Object>> mappings,
            @Size(max = 2000) String notes) {}

    // ---- GET / — Get current tenant's onboarding ----

    @GetMapping
    public ResponseEntity<?> get(@AuthenticationPrincipal UserPrincipal principal) {
        UUID tenantId = TenantContext.getCurrentTenantId();
        if (tenantId == null) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of(
                    "status", 403, "message", "No tenant context"));
        }
        var onboarding = onboardingRepository.findByTenantId(tenantId).orElse(null);
        if (onboarding == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(enrichModifierName(onboarding));
    }

    // ---- POST / — Create onboarding for current tenant ----

    @PostMapping
    @Transactional
    public ResponseEntity<?> create(@AuthenticationPrincipal UserPrincipal principal) {
        UUID tenantId = TenantContext.getCurrentTenantId();
        if (tenantId == null) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of(
                    "status", 403, "message", "No tenant context"));
        }

        // One per tenant
        if (onboardingRepository.findByTenantId(tenantId).isPresent()) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of(
                    "status", 409, "message", "Onboarding already exists for this tenant"));
        }

        var tenant = tenantRepository.findById(tenantId).orElse(null);
        if (tenant == null) {
            return ResponseEntity.notFound().build();
        }

        Onboarding onboarding = new Onboarding();
        onboarding.setTenant(tenant);
        onboarding.setStatus(OnboardingStatus.WELCOME);
        onboarding.setCurrentStep(0);
        onboarding = onboardingRepository.save(onboarding);

        auditService.log("CREATE", "Onboarding", onboarding.getId(), onboarding.getName());
        log.info("Onboarding created for tenant={} by user={}", tenantId, principal.email());

        return ResponseEntity
                .created(URI.create("/api/onboarding"))
                .body(enrichModifierName(onboarding));
    }

    // ---- PUT /{id} — Update onboarding ----

    @PutMapping("/{id}")
    @Transactional
    public ResponseEntity<?> update(@PathVariable("id") UUID id,
                                     @AuthenticationPrincipal UserPrincipal principal,
                                     @Valid @RequestBody UpdateOnboardingRequest request) {
        var onboarding = onboardingRepository.findById(id).orElse(null);
        if (onboarding == null) return ResponseEntity.notFound().build();
        if (!hasAccess(onboarding.getTenantId(), principal)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }

        if (request.status() != null) onboarding.setStatus(request.status());
        if (request.currentStep() != null) onboarding.setCurrentStep(request.currentStep());
        if (request.targetSchema() != null) onboarding.setTargetSchema(request.targetSchema());
        if (request.mappings() != null) onboarding.setMappings(request.mappings());
        if (request.notes() != null) onboarding.setNotes(request.notes());

        onboarding = onboardingRepository.save(onboarding);
        auditService.log("UPDATE", "Onboarding", onboarding.getId(), onboarding.getName());

        return ResponseEntity.ok(enrichModifierName(onboarding));
    }

    private static final Set<String> EXCEL_CONTENT_TYPES = Set.of(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.ms-excel"
    );

    private static final Set<String> ALLOWED_CONTENT_TYPES = Set.of(
            "text/csv", "text/plain", "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    // ---- POST /{id}/upload — Upload CSV or Excel and parse headers ----

    @PostMapping("/{id}/upload")
    @Transactional
    public ResponseEntity<?> uploadFile(@PathVariable("id") UUID id,
                                        @AuthenticationPrincipal UserPrincipal principal,
                                        @RequestParam("file") MultipartFile file) {
        var onboarding = onboardingRepository.findById(id).orElse(null);
        if (onboarding == null) return ResponseEntity.notFound().build();
        if (!hasAccess(onboarding.getTenantId(), principal)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }

        if (file.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("status", 400, "message", "File is empty"));
        }
        if (file.getSize() > MAX_FILE_SIZE) {
            return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).body(Map.of(
                    "status", 413, "message", "File exceeds maximum size of 50MB"));
        }

        String contentType = file.getContentType();
        String originalFilename = file.getOriginalFilename();
        if (originalFilename == null) originalFilename = "data.csv";
        boolean isExcel = isExcelFile(contentType, originalFilename);

        if (contentType != null && !ALLOWED_CONTENT_TYPES.contains(contentType)
                && !contentType.equals("text/plain")) {
            return ResponseEntity.status(HttpStatus.UNSUPPORTED_MEDIA_TYPE).body(Map.of(
                    "status", 415, "message", "Accepted formats: CSV, Excel (.xlsx, .xls)"));
        }

        try {
            // Store file to disk first
            String sanitized = Paths.get(originalFilename).getFileName().toString()
                    .replaceAll("[^a-zA-Z0-9._-]", "_");
            String storageName = UUID.randomUUID() + "_" + sanitized;
            Path storageDir = Paths.get(basePath, "onboarding", onboarding.getTenantId().toString());
            Path resolvedFile = storageDir.resolve(storageName).normalize();

            if (!resolvedFile.startsWith(Paths.get(basePath).normalize())) {
                return ResponseEntity.badRequest().body(Map.of("status", 400, "message", "Invalid file path"));
            }

            Files.createDirectories(storageDir);
            Files.copy(file.getInputStream(), resolvedFile);

            onboarding.setOriginalFilename(sanitized);
            onboarding.setStoragePath(resolvedFile.toString());
            onboarding.setFileSize(file.getSize());

            if (isExcel) {
                // Parse Excel — check sheet count
                try (InputStream is = Files.newInputStream(resolvedFile);
                     Workbook workbook = WorkbookFactory.create(is)) {
                    int sheetCount = workbook.getNumberOfSheets();

                    if (sheetCount > 1) {
                        // Multi-sheet: return sheet list for user selection
                        List<Map<String, Object>> sheets = new ArrayList<>();
                        for (int i = 0; i < sheetCount; i++) {
                            Sheet sheet = workbook.getSheetAt(i);
                            sheets.add(Map.of(
                                    "index", i,
                                    "name", sheet.getSheetName(),
                                    "rowCount", Math.max(0, sheet.getPhysicalNumberOfRows() - 1)
                            ));
                        }
                        onboarding.setStatus(OnboardingStatus.UPLOAD);
                        onboarding.setCurrentStep(1);
                        onboarding = onboardingRepository.save(onboarding);

                        Map<String, Object> response = new LinkedHashMap<>();
                        response.put("id", onboarding.getId());
                        response.put("sheets", sheets);
                        response.put("originalFilename", sanitized);
                        response.put("needsSheetSelection", true);
                        return ResponseEntity.ok(response);
                    }

                    // Single sheet — parse directly
                    parseExcelSheet(workbook.getSheetAt(0), onboarding);
                }
            } else {
                // Parse CSV
                parseCsvFile(resolvedFile, onboarding);
            }

            onboarding.setStatus(OnboardingStatus.MAPPING);
            onboarding.setCurrentStep(2);
            onboarding = onboardingRepository.save(onboarding);

            auditService.log("UPLOAD", "Onboarding", onboarding.getId(), sanitized);
            log.info("File uploaded for onboarding={}: {}", id, sanitized);

            return ResponseEntity.ok(enrichModifierName(onboarding));

        } catch (IOException e) {
            log.error("Upload failed for onboarding {}: {}", id, e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of(
                    "status", 500, "message", "Failed to process file"));
        }
    }

    // ---- POST /{id}/select-sheet — Select sheet from multi-sheet Excel ----

    public record SelectSheetRequest(int sheetIndex) {}

    @PostMapping("/{id}/select-sheet")
    @Transactional
    public ResponseEntity<?> selectSheet(@PathVariable("id") UUID id,
                                          @AuthenticationPrincipal UserPrincipal principal,
                                          @RequestBody SelectSheetRequest request) {
        var onboarding = onboardingRepository.findById(id).orElse(null);
        if (onboarding == null) return ResponseEntity.notFound().build();
        if (!hasAccess(onboarding.getTenantId(), principal)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
        if (onboarding.getStoragePath() == null) {
            return ResponseEntity.badRequest().body(Map.of("status", 400, "message", "No file uploaded yet"));
        }

        try (InputStream is = Files.newInputStream(Paths.get(onboarding.getStoragePath()));
             Workbook workbook = WorkbookFactory.create(is)) {

            if (request.sheetIndex() < 0 || request.sheetIndex() >= workbook.getNumberOfSheets()) {
                return ResponseEntity.badRequest().body(Map.of("status", 400, "message", "Invalid sheet index"));
            }

            Sheet sheet = workbook.getSheetAt(request.sheetIndex());
            onboarding.setSheetName(sheet.getSheetName());
            parseExcelSheet(sheet, onboarding);

            onboarding.setStatus(OnboardingStatus.MAPPING);
            onboarding.setCurrentStep(2);
            onboarding = onboardingRepository.save(onboarding);

            auditService.log("SELECT_SHEET", "Onboarding", onboarding.getId(), sheet.getSheetName());
            log.info("Sheet '{}' selected for onboarding={}", sheet.getSheetName(), id);

            return ResponseEntity.ok(enrichModifierName(onboarding));

        } catch (IOException e) {
            log.error("Sheet selection failed for onboarding {}: {}", id, e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of(
                    "status", 500, "message", "Failed to parse Excel sheet"));
        }
    }

    // ---- GET /{id}/preview — Get first N rows of uploaded CSV ----

    @GetMapping("/{id}/preview")
    public ResponseEntity<?> preview(@PathVariable("id") UUID id,
                                      @AuthenticationPrincipal UserPrincipal principal) {
        var onboarding = onboardingRepository.findById(id).orElse(null);
        if (onboarding == null) return ResponseEntity.notFound().build();
        if (!hasAccess(onboarding.getTenantId(), principal)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
        if (onboarding.getStoragePath() == null) {
            return ResponseEntity.badRequest().body(Map.of("status", 400, "message", "No file uploaded yet"));
        }

        try {
            Path filePath = Paths.get(onboarding.getStoragePath());
            if (!Files.exists(filePath)) {
                return ResponseEntity.notFound().build();
            }

            String filename = filePath.getFileName().toString().toLowerCase();
            boolean isExcel = filename.endsWith(".xlsx") || filename.endsWith(".xls");

            List<List<String>> rows = new ArrayList<>();

            if (isExcel) {
                try (InputStream is = Files.newInputStream(filePath);
                     Workbook workbook = WorkbookFactory.create(is)) {
                    Sheet sheet = onboarding.getSheetName() != null
                            ? workbook.getSheet(onboarding.getSheetName())
                            : workbook.getSheetAt(0);
                    if (sheet == null) sheet = workbook.getSheetAt(0);

                    DataFormatter formatter = new DataFormatter();
                    for (int r = 0; r <= Math.min(sheet.getLastRowNum(), PREVIEW_ROWS); r++) {
                        Row row = sheet.getRow(r);
                        if (row == null) continue;
                        List<String> values = new ArrayList<>();
                        for (int c = 0; c < row.getLastCellNum(); c++) {
                            Cell cell = row.getCell(c);
                            values.add(cell != null ? formatter.formatCellValue(cell).trim() : "");
                        }
                        rows.add(values);
                    }
                }
            } else {
                try (BufferedReader reader = Files.newBufferedReader(filePath, StandardCharsets.UTF_8)) {
                    String line;
                    int count = 0;
                    while ((line = reader.readLine()) != null && count <= PREVIEW_ROWS) {
                        rows.add(parseCsvLine(line));
                        count++;
                    }
                }
            }

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("headers", rows.isEmpty() ? List.of() : rows.get(0));
            result.put("rows", rows.size() > 1 ? rows.subList(1, rows.size()) : List.of());
            result.put("totalRows", onboarding.getRowCount());

            return ResponseEntity.ok(result);

        } catch (IOException e) {
            log.error("Preview failed for onboarding {}: {}", id, e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    // ---- POST /{id}/submit — Submit onboarding ----

    @PostMapping("/{id}/submit")
    @Transactional
    public ResponseEntity<?> submit(@PathVariable("id") UUID id,
                                     @AuthenticationPrincipal UserPrincipal principal) {
        var onboarding = onboardingRepository.findById(id).orElse(null);
        if (onboarding == null) return ResponseEntity.notFound().build();
        if (!hasAccess(onboarding.getTenantId(), principal)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }

        onboarding.setStatus(OnboardingStatus.SUBMITTED);
        onboarding.setCurrentStep(4);
        onboarding = onboardingRepository.save(onboarding);

        auditService.log("SUBMIT", "Onboarding", onboarding.getId(), onboarding.getName());
        log.info("Onboarding submitted: id={} tenant={}", id, onboarding.getTenantId());

        return ResponseEntity.ok(enrichModifierName(onboarding));
    }

    // ---- POST /{id}/reopen — Send back to mapping for edits ----

    @PostMapping("/{id}/reopen")
    @Transactional
    public ResponseEntity<?> reopen(@PathVariable("id") UUID id,
                                     @AuthenticationPrincipal UserPrincipal principal) {
        var onboarding = onboardingRepository.findById(id).orElse(null);
        if (onboarding == null) return ResponseEntity.notFound().build();
        if (!hasAccess(onboarding.getTenantId(), principal)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }

        if (onboarding.getStatus() == OnboardingStatus.COMPLETED) {
            return ResponseEntity.badRequest().body(Map.of(
                    "status", 400, "message", "Cannot reopen a completed onboarding"));
        }

        onboarding.setStatus(OnboardingStatus.MAPPING);
        onboarding.setCurrentStep(2);
        onboarding = onboardingRepository.save(onboarding);

        auditService.log("REOPEN", "Onboarding", onboarding.getId(), onboarding.getName());
        log.info("Onboarding reopened: id={} by user={}", id, principal.email());

        return ResponseEntity.ok(enrichModifierName(onboarding));
    }

    // ---- DELETE /{id} — Reset onboarding (delete and start over) ----

    @DeleteMapping("/{id}")
    @Transactional
    public ResponseEntity<?> reset(@PathVariable("id") UUID id,
                                    @AuthenticationPrincipal UserPrincipal principal) {
        var onboarding = onboardingRepository.findById(id).orElse(null);
        if (onboarding == null) return ResponseEntity.notFound().build();
        if (!hasAccess(onboarding.getTenantId(), principal)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }

        // Clean up stored file
        if (onboarding.getStoragePath() != null) {
            try {
                Files.deleteIfExists(Paths.get(onboarding.getStoragePath()));
            } catch (IOException e) {
                log.warn("Failed to delete file for onboarding {}: {}", id, e.getMessage());
            }
        }

        onboardingRepository.delete(onboarding);

        auditService.log("DELETE", "Onboarding", id, onboarding.getName());
        log.info("Onboarding deleted: id={} tenant={} by user={}", id, onboarding.getTenantId(), principal.email());

        return ResponseEntity.noContent().build();
    }

    // ---- Helpers ----

    private boolean isExcelFile(String contentType, String filename) {
        if (contentType != null && EXCEL_CONTENT_TYPES.contains(contentType)) return true;
        if (filename == null) return false;
        String lower = filename.toLowerCase();
        return lower.endsWith(".xlsx") || lower.endsWith(".xls");
    }

    private void parseCsvFile(Path filePath, Onboarding onboarding) throws IOException {
        List<String> headers;
        List<List<String>> sampleRows = new ArrayList<>();
        int totalRows = 0;

        try (BufferedReader reader = Files.newBufferedReader(filePath, StandardCharsets.UTF_8)) {
            String headerLine = reader.readLine();
            if (headerLine == null || headerLine.isBlank()) {
                throw new IOException("CSV file is empty or has no headers");
            }
            headers = parseCsvLine(headerLine);

            String line;
            while ((line = reader.readLine()) != null) {
                totalRows++;
                if (sampleRows.size() < SAMPLE_ROWS) {
                    sampleRows.add(parseCsvLine(line));
                }
            }
        }

        onboarding.setRowCount(totalRows);
        onboarding.setSourceColumns(buildSourceColumns(headers, sampleRows));
    }

    private void parseExcelSheet(Sheet sheet, Onboarding onboarding) {
        DataFormatter formatter = new DataFormatter();
        Row headerRow = sheet.getRow(0);
        if (headerRow == null) return;

        List<String> headers = new ArrayList<>();
        for (int i = 0; i < headerRow.getLastCellNum(); i++) {
            Cell cell = headerRow.getCell(i);
            headers.add(cell != null ? formatter.formatCellValue(cell).trim() : "Column" + (i + 1));
        }

        List<List<String>> sampleRows = new ArrayList<>();
        int totalRows = 0;
        for (int r = 1; r <= sheet.getLastRowNum(); r++) {
            Row row = sheet.getRow(r);
            if (row == null) continue;
            totalRows++;
            if (sampleRows.size() < SAMPLE_ROWS) {
                List<String> values = new ArrayList<>();
                for (int c = 0; c < headers.size(); c++) {
                    Cell cell = row.getCell(c);
                    values.add(cell != null ? formatter.formatCellValue(cell).trim() : "");
                }
                sampleRows.add(values);
            }
        }

        onboarding.setRowCount(totalRows);
        onboarding.setSourceColumns(buildSourceColumns(headers, sampleRows));
    }

    private List<Map<String, Object>> buildSourceColumns(List<String> headers, List<List<String>> sampleRows) {
        List<Map<String, Object>> sourceColumns = new ArrayList<>();
        for (int i = 0; i < headers.size(); i++) {
            Map<String, Object> col = new LinkedHashMap<>();
            col.put("name", headers.get(i));
            List<String> samples = new ArrayList<>();
            for (List<String> row : sampleRows) {
                if (i < row.size()) {
                    samples.add(row.get(i));
                }
            }
            col.put("sampleValues", samples);
            sourceColumns.add(col);
        }
        return sourceColumns;
    }

    private Onboarding enrichModifierName(Onboarding onboarding) {
        if (onboarding.getLastModifiedBy() != null) {
            userRepository.findById(onboarding.getLastModifiedBy()).ifPresent(u ->
                    onboarding.setLastModifiedByName(u.getFirstName() + " " + u.getLastName()));
        }
        return onboarding;
    }

    private boolean hasAccess(UUID onboardingTenantId, UserPrincipal principal) {
        if (principal.isPlatformUser()) return true;
        UUID tenantId = TenantContext.getCurrentTenantId();
        return onboardingTenantId.equals(tenantId);
    }

    private List<String> parseCsvLine(String line) {
        List<String> fields = new ArrayList<>();
        boolean inQuotes = false;
        StringBuilder current = new StringBuilder();

        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (c == '"') {
                if (inQuotes && i + 1 < line.length() && line.charAt(i + 1) == '"') {
                    current.append('"');
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (c == ',' && !inQuotes) {
                fields.add(current.toString());
                current = new StringBuilder();
            } else {
                current.append(c);
            }
        }
        fields.add(current.toString());
        return fields;
    }
}
