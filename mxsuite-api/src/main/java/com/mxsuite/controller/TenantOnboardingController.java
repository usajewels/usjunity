package com.mxsuite.controller;

import com.mxsuite.audit.AuditService;
import com.mxsuite.model.*;
import com.mxsuite.model.enums.*;
import com.mxsuite.repository.*;
import com.mxsuite.security.TenantContext;
import com.mxsuite.security.UserPrincipal;
import com.mxsuite.service.AiMappingService;
import com.mxsuite.service.BatchImportService;
import com.mxsuite.service.FileParsingService;
import com.mxsuite.service.MappingVersionService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Instant;
import java.util.*;

@RestController
@RequestMapping("/api/my-onboarding")
@Transactional(readOnly = true)
public class TenantOnboardingController {

    private static final Logger log = LoggerFactory.getLogger(TenantOnboardingController.class);
    private static final long MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

    private final TenantRepository tenantRepository;
    private final ProjectRepository projectRepository;
    private final PhaseGateRepository phaseGateRepository;
    private final ProjectDataUploadRepository uploadRepository;
    private final FieldMappingEntryRepository mappingRepository;
    private final SemanticDecisionRepository decisionRepository;
    private final ReconciliationReportRepository reconRepository;
    private final SourceSchemaNodeRepository schemaNodeRepository;
    private final UserRepository userRepository;
    private final FileParsingService fileParsingService;
    private final AuditService auditService;
    private final MappingVersionService versionService;
    private final AiMappingService aiMappingService;
    private final BatchImportService batchImportService;
    private final String basePath;

    public TenantOnboardingController(TenantRepository tenantRepository,
                                       ProjectRepository projectRepository,
                                       PhaseGateRepository phaseGateRepository,
                                       ProjectDataUploadRepository uploadRepository,
                                       FieldMappingEntryRepository mappingRepository,
                                       SemanticDecisionRepository decisionRepository,
                                       ReconciliationReportRepository reconRepository,
                                       SourceSchemaNodeRepository schemaNodeRepository,
                                       UserRepository userRepository,
                                       FileParsingService fileParsingService,
                                       AuditService auditService,
                                       MappingVersionService versionService,
                                       AiMappingService aiMappingService,
                                       BatchImportService batchImportService,
                                       @Value("${mxsuite.storage.local.base-path}") String basePath) {
        this.tenantRepository = tenantRepository;
        this.projectRepository = projectRepository;
        this.phaseGateRepository = phaseGateRepository;
        this.uploadRepository = uploadRepository;
        this.mappingRepository = mappingRepository;
        this.decisionRepository = decisionRepository;
        this.reconRepository = reconRepository;
        this.schemaNodeRepository = schemaNodeRepository;
        this.userRepository = userRepository;
        this.fileParsingService = fileParsingService;
        this.auditService = auditService;
        this.versionService = versionService;
        this.aiMappingService = aiMappingService;
        this.batchImportService = batchImportService;
        this.basePath = basePath;
    }

    // --- DTOs ---

    public record TenantOnboardingDto(
            UUID projectId, String projectName,
            MigrationPhase migrationPhase, MigrationStatus migrationStatus,
            BigDecimal reconciliationPct, List<PhaseGateDto> phaseGates,
            String uploadStatus, String uploadFilename, Integer uploadRowCount,
            MappingStatsDto mappingStats, DecisionStatsDto decisionStats,
            Instant createdAt) {}

    public record PhaseGateDto(
            MigrationPhase phase, GateStatus gateStatus,
            String clearedByName, Instant clearedAt) {}

    public record MappingStatsDto(long total, long mapped, long needsReview, long unmapped) {}

    public record DecisionStatsDto(long total, long open, long approved, long rejected) {}

    public record UploadResultDto(
            UUID id, String originalFilename, int rowCount,
            List<Map<String, Object>> sourceColumns,
            boolean needsSheetSelection, List<SheetDto> sheets,
            boolean hasExistingMappings, long existingMappedCount) {}

    public record SheetDto(int index, String name, int rowCount) {}

    public record SelectSheetRequest(int sheetIndex) {}

    public record ConfirmUploadRequest(boolean preserveApproved) {}

    public record PreviewUploadRequest(String csvText, String originalFilename, long totalFileSize) {}

    public record ImportStatusDto(String status, int progressPct, int importedRowCount,
                                   int totalRowCount, String error, boolean isPreviewOnly) {}

    public record FieldMappingDto(
            UUID id, String sourceEntity, String sourceField, String sampleValue,
            String targetEntity, String targetField, String coercion,
            BigDecimal confidencePct, MappingStatus mappingStatus,
            String customerComment, Instant createdAt) {}

    private FieldMappingDto toMappingDto(FieldMappingEntry e) {
        return new FieldMappingDto(e.getId(), e.getSourceEntity(), e.getSourceField(),
                e.getSampleValue(), e.getTargetEntity(), e.getTargetField(),
                e.getCoercion(), e.getConfidencePct(), e.getMappingStatus(),
                e.getCustomerComment(), e.getCreatedAt());
    }

    // --- GET /my-onboarding — Get or auto-create tenant's onboarding project ---

    @GetMapping
    @Transactional
    public ResponseEntity<?> getMyOnboarding(@AuthenticationPrincipal UserPrincipal principal) {
        UUID tenantId = TenantContext.getCurrentTenantId();
        if (tenantId == null) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("message", "No tenant context"));
        }

        Tenant tenant = tenantRepository.findById(tenantId).orElse(null);
        if (tenant == null) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("message", "Tenant not found"));
        }

        Project project = tenant.getOnboardingProject();
        if (project == null) {
            // Auto-create the tenant's onboarding project
            User owner = userRepository.findById(principal.id()).orElse(null);
            if (owner == null) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("message", "User not found"));
            }
            project = new Project();
            project.setName(tenant.getName() + " Onboarding");
            project.setTenant(tenant);
            project.setOwner(owner);
            project.setMigrationPhase(MigrationPhase.DISCOVER);
            project.setMigrationStatus(MigrationStatus.ACTIVE);
            project.setTargetSystem("GrowthZone");
            project.setReconciliationPct(BigDecimal.ZERO);
            project = projectRepository.save(project);

            // Create initial phase gates
            for (MigrationPhase phase : MigrationPhase.values()) {
                PhaseGate gate = new PhaseGate();
                gate.setProject(project);
                gate.setPhase(phase);
                gate.setGateStatus(GateStatus.PENDING);
                phaseGateRepository.save(gate);
            }

            tenant.setOnboardingProject(project);
            tenantRepository.save(tenant);

            auditService.log("CREATE", "OnboardingProject", project.getId(), project.getName());
            log.info("Auto-created onboarding project for tenant={}: project={}", tenantId, project.getId());
        }

        return ResponseEntity.ok(buildDto(project));
    }

    // --- POST /my-onboarding/upload — Upload data file ---

    @PostMapping("/upload")
    @Transactional
    public ResponseEntity<?> upload(@RequestParam("file") MultipartFile file,
                                     @AuthenticationPrincipal UserPrincipal principal) {
        Project project = resolveProject();
        if (project == null) return notFound();

        if (file.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("message", "File is empty"));
        }
        if (file.getSize() > MAX_FILE_SIZE) {
            return ResponseEntity.badRequest().body(Map.of("message", "File exceeds 50 MB limit"));
        }

        String originalFilename = file.getOriginalFilename();
        String sanitized = originalFilename != null
                ? originalFilename.replaceAll("[^a-zA-Z0-9._-]", "_") : "upload.csv";
        boolean isExcel = fileParsingService.isExcelFile(file.getContentType(), sanitized);

        try {
            // Store file
            String storageName = UUID.randomUUID() + "_" + sanitized;
            Path storageDir = Paths.get(basePath, "onboarding", project.getTenant().getId().toString());
            Path resolvedFile = storageDir.resolve(storageName).normalize();

            if (!resolvedFile.startsWith(Paths.get(basePath).normalize())) {
                return ResponseEntity.badRequest().body(Map.of("message", "Invalid file path"));
            }

            Files.createDirectories(storageDir);
            Files.copy(file.getInputStream(), resolvedFile);

            // Check for existing user-finalized mappings (MAPPED or REJECTED)
            long existingMapped = mappingRepository.countByProjectIdAndMappingStatus(
                    project.getId(), MappingStatus.MAPPED);
            long existingRejected = mappingRepository.countByProjectIdAndMappingStatus(
                    project.getId(), MappingStatus.REJECTED);
            long existingFinalized = existingMapped + existingRejected;

            if (isExcel) {
                List<FileParsingService.SheetInfo> sheets = fileParsingService.listExcelSheets(resolvedFile);
                if (sheets.size() > 1) {
                    // Multi-sheet: save upload record and return sheet list
                    ProjectDataUpload upload = new ProjectDataUpload();
                    upload.setProject(project);
                    upload.setOriginalFilename(sanitized);
                    upload.setStoragePath(resolvedFile.toString());
                    upload.setUploadStatus(UploadStatus.PENDING);
                    upload = uploadRepository.save(upload);

                    List<SheetDto> sheetDtos = sheets.stream()
                            .map(s -> new SheetDto(s.index(), s.name(), s.rowCount()))
                            .toList();

                    return ResponseEntity.ok(new UploadResultDto(
                            upload.getId(), sanitized, 0, List.of(), true, sheetDtos,
                            existingFinalized > 0, existingFinalized));
                }

                // Single sheet
                FileParsingService.ParsedFileResult result = fileParsingService.parseExcelSheet(resolvedFile, 0);

                if (existingFinalized > 0) {
                    // Defer processing — store upload as PENDING, let frontend confirm
                    return savePendingUpload(project, sanitized, resolvedFile, result,
                            sheets.get(0).name(), existingFinalized);
                }

                return saveUploadResult(project, sanitized, resolvedFile, result, sheets.get(0).name());
            } else {
                FileParsingService.ParsedFileResult result = fileParsingService.parseCsvFile(resolvedFile);

                if (existingFinalized > 0) {
                    return savePendingUpload(project, sanitized, resolvedFile, result,
                            null, existingFinalized);
                }

                return saveUploadResult(project, sanitized, resolvedFile, result, null);
            }

        } catch (IOException e) {
            log.error("Upload failed for project {}: {}", project.getId(), e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("message", "Failed to process file"));
        }
    }

    // --- POST /my-onboarding/upload-preview — Upload CSV preview text for large files ---

    @PostMapping("/upload-preview")
    @Transactional
    public ResponseEntity<?> uploadPreview(@RequestBody PreviewUploadRequest request,
                                            @AuthenticationPrincipal UserPrincipal principal) {
        Project project = resolveProject();
        if (project == null) return notFound();

        if (request.csvText() == null || request.csvText().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("message", "CSV preview text is empty"));
        }

        String filename = request.originalFilename() != null
                ? request.originalFilename().replaceAll("[^a-zA-Z0-9._-]", "_") : "preview.csv";

        FileParsingService.ParsedFileResult result = fileParsingService.parseCsvContent(request.csvText());
        if (result.headers().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("message", "No headers found in preview data"));
        }

        // Check for existing user-finalized mappings
        long existingMapped = mappingRepository.countByProjectIdAndMappingStatus(
                project.getId(), MappingStatus.MAPPED);
        long existingRejected = mappingRepository.countByProjectIdAndMappingStatus(
                project.getId(), MappingStatus.REJECTED);
        long existingFinalized = existingMapped + existingRejected;

        if (existingFinalized > 0) {
            // Save as PENDING — let frontend confirm preserve/fresh
            ProjectDataUpload upload = new ProjectDataUpload();
            upload.setProject(project);
            upload.setOriginalFilename(filename);
            upload.setRowCount(result.totalRows());
            upload.setSourceColumns(result.sourceColumns());
            upload.setUploadStatus(UploadStatus.PENDING);
            upload.setTotalFileSize(request.totalFileSize());
            uploadRepository.save(upload);

            log.info("Preview upload pending confirmation for project {}: {} (existing finalized: {})",
                    project.getId(), filename, existingFinalized);

            return ResponseEntity.ok(new UploadResultDto(
                    upload.getId(), filename, result.totalRows(),
                    result.sourceColumns(), false, List.of(), true, existingFinalized));
        }

        // No existing mappings — process immediately
        ProjectDataUpload upload = new ProjectDataUpload();
        upload.setProject(project);
        upload.setOriginalFilename(filename);
        upload.setRowCount(result.totalRows());
        upload.setSourceColumns(result.sourceColumns());
        upload.setUploadStatus(UploadStatus.PREVIEW_ONLY);
        upload.setTotalFileSize(request.totalFileSize());
        uploadRepository.save(upload);

        createSchemaNodes(project, result);
        createAutoMappings(project, result);

        auditService.log("UPLOAD_PREVIEW", "OnboardingProject", project.getId(), filename);
        log.info("Preview uploaded for onboarding project {}: {} ({} preview rows, {} total file size)",
                project.getId(), filename, result.totalRows(), request.totalFileSize());

        return ResponseEntity.ok(new UploadResultDto(
                upload.getId(), filename, result.totalRows(),
                result.sourceColumns(), false, List.of(), false, 0));
    }

    // --- POST /my-onboarding/select-sheet — Select sheet from multi-sheet Excel ---

    @PostMapping("/select-sheet")
    @Transactional
    public ResponseEntity<?> selectSheet(@RequestBody SelectSheetRequest request,
                                          @AuthenticationPrincipal UserPrincipal principal) {
        Project project = resolveProject();
        if (project == null) return notFound();

        String storagePath = getUploadPath(project);
        if (storagePath == null) {
            return ResponseEntity.badRequest().body(Map.of("message", "No file uploaded yet"));
        }

        try {
            Path filePath = Paths.get(storagePath);
            List<FileParsingService.SheetInfo> sheets = fileParsingService.listExcelSheets(filePath);

            if (request.sheetIndex() < 0 || request.sheetIndex() >= sheets.size()) {
                return ResponseEntity.badRequest().body(Map.of("message", "Invalid sheet index"));
            }

            FileParsingService.ParsedFileResult result =
                    fileParsingService.parseExcelSheet(filePath, request.sheetIndex());
            String sheetName = sheets.get(request.sheetIndex()).name();

            // Check for existing user-finalized mappings
            long existingMapped = mappingRepository.countByProjectIdAndMappingStatus(
                    project.getId(), MappingStatus.MAPPED);
            long existingRejected = mappingRepository.countByProjectIdAndMappingStatus(
                    project.getId(), MappingStatus.REJECTED);
            long existingFinalized = existingMapped + existingRejected;

            ProjectDataUpload upload = uploadRepository.findFirstByProjectIdOrderByCreatedAtDesc(project.getId())
                    .orElse(new ProjectDataUpload());
            upload.setProject(project);
            upload.setOriginalFilename(filePath.getFileName().toString());
            upload.setSheetName(sheetName);
            upload.setRowCount(result.totalRows());
            upload.setSourceColumns(result.sourceColumns());

            if (existingFinalized > 0) {
                upload.setUploadStatus(UploadStatus.PENDING);
                uploadRepository.save(upload);
                return ResponseEntity.ok(new UploadResultDto(
                        upload.getId(), upload.getOriginalFilename(), result.totalRows(),
                        result.sourceColumns(), false, List.of(), true, existingFinalized));
            }

            upload.setUploadStatus(UploadStatus.PARSED);
            uploadRepository.save(upload);
            createSchemaNodes(project, result);
            createAutoMappings(project, result);

            return ResponseEntity.ok(new UploadResultDto(
                    upload.getId(), upload.getOriginalFilename(), result.totalRows(),
                    result.sourceColumns(), false, List.of(), false, 0));

        } catch (IOException e) {
            log.error("Sheet selection failed for project {}: {}", project.getId(), e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("message", "Failed to parse Excel sheet"));
        }
    }

    // --- POST /my-onboarding/upload/confirm — Confirm pending upload and process mappings ---

    @PostMapping("/upload/confirm")
    @Transactional
    public ResponseEntity<?> confirmUpload(@RequestBody ConfirmUploadRequest request,
                                            @AuthenticationPrincipal UserPrincipal principal) {
        Project project = resolveProject();
        if (project == null) return notFound();

        ProjectDataUpload upload = uploadRepository.findFirstByProjectIdOrderByCreatedAtDesc(project.getId())
                .orElse(null);
        if (upload == null || upload.getUploadStatus() != UploadStatus.PENDING) {
            return ResponseEntity.badRequest().body(Map.of("message", "No pending upload to confirm"));
        }

        try {
            Path filePath = Paths.get(upload.getStoragePath());
            if (!Files.exists(filePath)) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND)
                        .body(Map.of("message", "Uploaded file no longer exists"));
            }

            // Parse the file again to get headers and source columns
            FileParsingService.ParsedFileResult result;
            boolean isExcel = fileParsingService.isExcelFile(null, filePath.getFileName().toString());
            if (isExcel) {
                int sheetIndex = 0;
                if (upload.getSheetName() != null) {
                    List<FileParsingService.SheetInfo> sheets = fileParsingService.listExcelSheets(filePath);
                    for (int i = 0; i < sheets.size(); i++) {
                        if (sheets.get(i).name().equals(upload.getSheetName())) {
                            sheetIndex = i;
                            break;
                        }
                    }
                }
                result = fileParsingService.parseExcelSheet(filePath, sheetIndex);
            } else {
                result = fileParsingService.parseCsvFile(filePath);
            }

            // Process schema and mappings
            createSchemaNodes(project, result);
            if (request.preserveApproved()) {
                createSmartMappings(project, result);
            } else {
                createAutoMappings(project, result);
            }

            upload.setUploadStatus(UploadStatus.PARSED);
            uploadRepository.save(upload);

            auditService.log("UPLOAD", "OnboardingProject", project.getId(),
                    upload.getOriginalFilename() + (request.preserveApproved() ? " (preserved)" : " (fresh)"));
            log.info("Upload confirmed for project {}: {} preserveApproved={}",
                    project.getId(), upload.getOriginalFilename(), request.preserveApproved());

            return ResponseEntity.ok(new UploadResultDto(
                    upload.getId(), upload.getOriginalFilename(), result.totalRows(),
                    result.sourceColumns(), false, List.of(), false, 0));

        } catch (IOException e) {
            log.error("Confirm upload failed for project {}: {}", project.getId(), e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("message", "Failed to process file"));
        }
    }

    // --- GET /my-onboarding/upload/preview — Preview uploaded data ---

    @GetMapping("/upload/preview")
    public ResponseEntity<?> preview(@AuthenticationPrincipal UserPrincipal principal) {
        Project project = resolveProject();
        if (project == null) return notFound();

        ProjectDataUpload upload = uploadRepository.findFirstByProjectIdOrderByCreatedAtDesc(project.getId())
                .orElse(null);
        if (upload == null) {
            return ResponseEntity.badRequest().body(Map.of("message", "No file uploaded yet"));
        }

        // For PREVIEW_ONLY uploads (no physical file), build preview from sourceColumns
        if (upload.getUploadStatus() == UploadStatus.PREVIEW_ONLY && upload.getStoragePath() == null) {
            List<String> headers = new ArrayList<>();
            List<List<String>> rows = new ArrayList<>();
            if (upload.getSourceColumns() != null) {
                for (Map<String, Object> col : upload.getSourceColumns()) {
                    headers.add(String.valueOf(col.get("name")));
                }
                // Build rows from sample values (transpose columns to rows)
                int maxSamples = upload.getSourceColumns().stream()
                        .mapToInt(col -> col.get("sampleValues") instanceof List<?> l ? l.size() : 0)
                        .max().orElse(0);
                for (int r = 0; r < maxSamples; r++) {
                    List<String> row = new ArrayList<>();
                    for (Map<String, Object> col : upload.getSourceColumns()) {
                        Object sv = col.get("sampleValues");
                        if (sv instanceof List<?> list && r < list.size()) {
                            row.add(String.valueOf(list.get(r)));
                        } else {
                            row.add("");
                        }
                    }
                    rows.add(row);
                }
            }
            return ResponseEntity.ok(Map.of(
                    "headers", headers, "rows", rows,
                    "totalRows", upload.getRowCount() != null ? upload.getRowCount() : 0));
        }

        String storagePath = upload.getStoragePath();
        if (storagePath == null) {
            return ResponseEntity.badRequest().body(Map.of("message", "No file uploaded yet"));
        }

        try {
            Path filePath = Paths.get(storagePath);
            if (!Files.exists(filePath)) return ResponseEntity.notFound().build();

            String sheetName = upload != null ? upload.getSheetName() : null;
            int totalRows = upload != null && upload.getRowCount() != null ? upload.getRowCount() : 0;
            FileParsingService.PreviewResult preview = fileParsingService.getPreview(filePath, sheetName, totalRows);

            return ResponseEntity.ok(Map.of(
                    "headers", preview.headers(),
                    "rows", preview.rows(),
                    "totalRows", preview.totalRows()));

        } catch (IOException e) {
            log.error("Preview failed for project {}: {}", project.getId(), e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    // --- GET /my-onboarding/mappings — List mappings ---

    @GetMapping("/mappings")
    public ResponseEntity<?> listMappings(@AuthenticationPrincipal UserPrincipal principal,
                                           Pageable pageable) {
        Project project = resolveProject();
        if (project == null) return notFound();

        Page<FieldMappingEntry> page = mappingRepository.findByProjectId(project.getId(), pageable);
        return ResponseEntity.ok(page.map(this::toMappingDto));
    }

    // --- PUT /my-onboarding/mappings/{id} — Update mapping (tenant: customerComment only) ---

    @PutMapping("/mappings/{id}")
    @Transactional
    public ResponseEntity<?> updateMapping(@PathVariable UUID id,
                                            @RequestBody Map<String, Object> body,
                                            @AuthenticationPrincipal UserPrincipal principal) {
        Project project = resolveProject();
        if (project == null) return notFound();

        FieldMappingEntry mapping = mappingRepository.findById(id).orElse(null);
        if (mapping == null || !mapping.getProject().getId().equals(project.getId())) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }

        // Record version changes before applying
        Map<String, String> changes = new LinkedHashMap<>();
        if (body.containsKey("customerComment")) {
            changes.put("customerComment", (String) body.get("customerComment"));
        }
        if (Boolean.TRUE.equals(body.get("skip"))) {
            changes.put("targetField", null);
            changes.put("targetEntity", null);
            changes.put("mappingStatus", MappingStatus.REJECTED.name());
        } else if (Boolean.TRUE.equals(body.get("unskip"))) {
            changes.put("mappingStatus", MappingStatus.UNMAPPED.name());
        } else if (body.containsKey("targetField")) {
            changes.put("targetField", (String) body.get("targetField"));
            changes.put("targetEntity", (String) body.get("targetEntity"));
            String tf = (String) body.get("targetField");
            changes.put("mappingStatus", tf != null ? MappingStatus.NEEDS_REVIEW.name() : MappingStatus.UNMAPPED.name());
        }
        if (!changes.isEmpty()) {
            versionService.recordChange(mapping, changes, "EDIT");
        }

        // Apply changes
        if (body.containsKey("customerComment")) {
            mapping.setCustomerComment((String) body.get("customerComment"));
        }
        if (Boolean.TRUE.equals(body.get("skip"))) {
            mapping.setTargetField(null);
            mapping.setTargetEntity(null);
            mapping.setConfidencePct(null);
            mapping.setMappingStatus(MappingStatus.REJECTED);
        } else if (Boolean.TRUE.equals(body.get("unskip"))) {
            mapping.setMappingStatus(MappingStatus.UNMAPPED);
        } else if (body.containsKey("targetField")) {
            mapping.setTargetField((String) body.get("targetField"));
            mapping.setTargetEntity((String) body.get("targetEntity"));
            if (mapping.getTargetField() != null) {
                mapping.setMappingStatus(MappingStatus.NEEDS_REVIEW);
            } else {
                mapping.setMappingStatus(MappingStatus.UNMAPPED);
            }
        }

        mappingRepository.save(mapping);
        return ResponseEntity.ok(toMappingDto(mapping));
    }

    // --- POST /my-onboarding/mappings/{id}/approve — Approve a mapping ---

    @PostMapping("/mappings/{id}/approve")
    @Transactional
    public ResponseEntity<?> approveMapping(@PathVariable UUID id,
                                             @AuthenticationPrincipal UserPrincipal principal) {
        Project project = resolveProject();
        if (project == null) return notFound();

        FieldMappingEntry mapping = mappingRepository.findById(id).orElse(null);
        if (mapping == null || !mapping.getProject().getId().equals(project.getId())) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }

        versionService.recordApproval(mapping);
        mapping.setMappingStatus(MappingStatus.MAPPED);
        mappingRepository.save(mapping);

        auditService.log("APPROVE", "FieldMapping", id, mapping.getSourceField() + " → " + mapping.getTargetField());
        return ResponseEntity.ok(toMappingDto(mapping));
    }

    // --- GET /my-onboarding/mappings/stats — Mapping counts by status ---

    @GetMapping("/mappings/stats")
    public ResponseEntity<?> mappingStats(@AuthenticationPrincipal UserPrincipal principal) {
        Project project = resolveProject();
        if (project == null) return notFound();

        UUID pid = project.getId();
        long mapped = mappingRepository.countByProjectIdAndMappingStatus(pid, MappingStatus.MAPPED);
        long needsReview = mappingRepository.countByProjectIdAndMappingStatus(pid, MappingStatus.NEEDS_REVIEW);
        long unmapped = mappingRepository.countByProjectIdAndMappingStatus(pid, MappingStatus.UNMAPPED);
        long total = mapped + needsReview + unmapped
                + mappingRepository.countByProjectIdAndMappingStatus(pid, MappingStatus.CFV_PROPOSAL)
                + mappingRepository.countByProjectIdAndMappingStatus(pid, MappingStatus.REJECTED);

        return ResponseEntity.ok(new MappingStatsDto(total, mapped, needsReview, unmapped));
    }

    // --- GET /my-onboarding/decisions — List decisions ---

    @GetMapping("/decisions")
    public ResponseEntity<?> listDecisions(@AuthenticationPrincipal UserPrincipal principal,
                                            Pageable pageable) {
        Project project = resolveProject();
        if (project == null) return notFound();

        Page<SemanticDecision> page = decisionRepository.findByProjectId(project.getId(), pageable);
        return ResponseEntity.ok(page);
    }

    // --- PUT /my-onboarding/decisions/{id} — Update decision (select option, approve/reject) ---

    @PutMapping("/decisions/{id}")
    @Transactional
    public ResponseEntity<?> updateDecision(@PathVariable UUID id,
                                             @RequestBody Map<String, Object> body,
                                             @AuthenticationPrincipal UserPrincipal principal) {
        Project project = resolveProject();
        if (project == null) return notFound();

        SemanticDecision decision = decisionRepository.findById(id).orElse(null);
        if (decision == null || !decision.getProject().getId().equals(project.getId())) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }

        if (body.containsKey("selectedOption")) {
            decision.setSelectedOption((Integer) body.get("selectedOption"));
        }
        if (body.containsKey("decisionStatus")) {
            decision.setDecisionStatus(DecisionStatus.valueOf((String) body.get("decisionStatus")));
        }

        decisionRepository.save(decision);
        auditService.log("UPDATE", "SemanticDecision", id, decision.getTitle());
        return ResponseEntity.ok(decision);
    }

    // --- GET /my-onboarding/status — Get reconciliation status ---

    @GetMapping("/status")
    public ResponseEntity<?> getStatus(@AuthenticationPrincipal UserPrincipal principal) {
        Project project = resolveProject();
        if (project == null) return notFound();

        var report = reconRepository.findFirstByProjectIdOrderByCreatedAtDesc(project.getId()).orElse(null);

        Map<String, Object> status = new LinkedHashMap<>();
        status.put("projectName", project.getName());
        status.put("migrationPhase", project.getMigrationPhase());
        status.put("migrationStatus", project.getMigrationStatus());
        status.put("reconciliationPct", project.getReconciliationPct());

        if (report != null) {
            status.put("hasReport", true);
            status.put("overallStatus", report.getOverallStatus());
            status.put("warningCount", report.getWarningCount());
            status.put("signedOff", report.isSignedOff());
            status.put("signerName", report.getSignerName());
            status.put("signerRole", report.getSignerRole());
            status.put("tiers", report.getTiers());
            status.put("tableBreakdown", report.getTableBreakdown());
            status.put("warningDetail", report.getWarningDetail());
        } else {
            status.put("hasReport", false);
        }

        return ResponseEntity.ok(status);
    }

    // --- GET /my-onboarding/versions — List mapping versions ---

    @GetMapping("/versions")
    public ResponseEntity<?> listVersions(@RequestParam(required = false) String search,
                                           Pageable pageable) {
        Project project = resolveProject();
        if (project == null) return notFound();
        var page = versionService.listVersions(project.getId(), search, pageable);
        return ResponseEntity.ok(page.map(v -> Map.of(
                "id", v.getId(), "versionNumber", v.getVersionNumber(),
                "changeCount", v.getChangeCount(), "label", v.getLabel() != null ? v.getLabel() : "",
                "description", v.getDescription() != null ? v.getDescription() : "",
                "source", v.getSource(), "createdByName", v.getCreatedByName() != null ? v.getCreatedByName() : "",
                "createdAt", v.getCreatedAt())));
    }

    // --- GET /my-onboarding/versions/{versionId} — Version detail with changes ---

    @GetMapping("/versions/{versionId}")
    public ResponseEntity<?> getVersion(@PathVariable UUID versionId) {
        return versionService.getVersionWithChanges(versionId)
                .map(v -> {
                    var changes = v.getChanges().stream().map(c -> Map.<String, Object>of(
                            "id", c.getId(), "fieldMappingId", c.getFieldMappingId(),
                            "changeType", c.getChangeType(), "fieldName", c.getFieldName(),
                            "oldValue", c.getOldValue() != null ? c.getOldValue() : "",
                            "newValue", c.getNewValue() != null ? c.getNewValue() : "",
                            "sourceEntity", c.getSourceEntity(), "sourceField", c.getSourceField(),
                            "createdAt", c.getCreatedAt())).toList();
                    return ResponseEntity.ok(Map.of(
                            "id", v.getId(), "versionNumber", v.getVersionNumber(),
                            "changeCount", v.getChangeCount(), "description", v.getDescription() != null ? v.getDescription() : "",
                            "source", v.getSource(), "createdByName", v.getCreatedByName() != null ? v.getCreatedByName() : "",
                            "createdAt", v.getCreatedAt(), "changes", changes));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    // --- GET /my-onboarding/mappings/{mappingId}/change-history — Per-field change history ---

    @GetMapping("/mappings/{mappingId}/change-history")
    public ResponseEntity<?> fieldChangeHistory(@PathVariable UUID mappingId, Pageable pageable) {
        Project project = resolveProject();
        if (project == null) return notFound();
        return ResponseEntity.ok(versionService.getFieldHistory(mappingId, pageable));
    }

    // --- POST /my-onboarding/versions/rollback — Rollback to a previous version ---

    @PostMapping("/versions/rollback")
    @Transactional
    public ResponseEntity<?> rollbackVersion(@RequestBody Map<String, Integer> body) {
        Project project = resolveProject();
        if (project == null) return notFound();
        int targetVersion = body.getOrDefault("targetVersion", 0);
        if (targetVersion <= 0) {
            return ResponseEntity.badRequest().body(Map.of("message", "Invalid target version"));
        }
        var rollback = versionService.rollback(project.getId(), targetVersion);
        return ResponseEntity.ok(Map.of("versionNumber", rollback.getVersionNumber(),
                "description", rollback.getDescription()));
    }

    // --- POST /my-onboarding/import/chunk — Receive a chunk of a large file ---

    @PostMapping("/import/chunk")
    @Transactional
    public ResponseEntity<?> uploadChunk(@RequestParam("chunkIndex") int chunkIndex,
                                          @RequestParam("totalChunks") int totalChunks,
                                          @RequestParam("file") MultipartFile chunk,
                                          @RequestParam("filename") String filename,
                                          @AuthenticationPrincipal UserPrincipal principal) {
        Project project = resolveProject();
        if (project == null) return notFound();

        ProjectDataUpload upload = uploadRepository.findFirstByProjectIdOrderByCreatedAtDesc(project.getId())
                .orElse(null);
        if (upload == null) {
            return ResponseEntity.badRequest().body(Map.of("message", "No upload found. Upload a preview first."));
        }

        try {
            // Write chunk to assembly directory
            Path chunkDir = Paths.get(basePath, "onboarding",
                    project.getTenant().getId().toString(), "chunks", upload.getId().toString());
            Path resolvedDir = chunkDir.normalize();
            if (!resolvedDir.startsWith(Paths.get(basePath).normalize())) {
                return ResponseEntity.badRequest().body(Map.of("message", "Invalid path"));
            }
            Files.createDirectories(resolvedDir);

            Path chunkFile = resolvedDir.resolve("chunk_" + String.format("%05d", chunkIndex));
            Files.copy(chunk.getInputStream(), chunkFile,
                    java.nio.file.StandardCopyOption.REPLACE_EXISTING);

            upload.setChunksTotal(totalChunks);
            upload.setChunksReceived(chunkIndex + 1);
            upload.setImportStatus("UPLOADING");
            uploadRepository.save(upload);

            log.info("Chunk {}/{} received for upload {} (project {})",
                    chunkIndex + 1, totalChunks, upload.getId(), project.getId());

            // If all chunks received, assemble into final file
            if (chunkIndex + 1 >= totalChunks) {
                String sanitized = filename != null
                        ? filename.replaceAll("[^a-zA-Z0-9._-]", "_") : "import.csv";
                String storageName = UUID.randomUUID() + "_" + sanitized;
                Path storageDir = Paths.get(basePath, "onboarding", project.getTenant().getId().toString());
                Path assembledFile = storageDir.resolve(storageName).normalize();

                if (!assembledFile.startsWith(Paths.get(basePath).normalize())) {
                    return ResponseEntity.badRequest().body(Map.of("message", "Invalid path"));
                }

                // Concatenate all chunks
                try (var out = Files.newOutputStream(assembledFile)) {
                    for (int i = 0; i < totalChunks; i++) {
                        Path cp = resolvedDir.resolve("chunk_" + String.format("%05d", i));
                        Files.copy(cp, out);
                    }
                }

                // Clean up chunk directory
                for (int i = 0; i < totalChunks; i++) {
                    Files.deleteIfExists(resolvedDir.resolve("chunk_" + String.format("%05d", i)));
                }
                Files.deleteIfExists(resolvedDir);

                upload.setStoragePath(assembledFile.toString());
                upload.setOriginalFilename(sanitized);
                upload.setImportStatus("UPLOADED");
                uploadRepository.save(upload);

                log.info("All chunks assembled for upload {} → {}", upload.getId(), assembledFile);
            }

            return ResponseEntity.ok(Map.of(
                    "chunksReceived", upload.getChunksReceived(),
                    "chunksTotal", totalChunks,
                    "assembled", chunkIndex + 1 >= totalChunks));

        } catch (IOException e) {
            log.error("Chunk upload failed for project {}: {}", project.getId(), e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("message", "Failed to store chunk"));
        }
    }

    // --- POST /my-onboarding/import/start — Start async batch import ---

    @PostMapping("/import/start")
    @Transactional
    public ResponseEntity<?> startImport(@AuthenticationPrincipal UserPrincipal principal) {
        Project project = resolveProject();
        if (project == null) return notFound();

        ProjectDataUpload upload = uploadRepository.findFirstByProjectIdOrderByCreatedAtDesc(project.getId())
                .orElse(null);
        if (upload == null || upload.getStoragePath() == null) {
            return ResponseEntity.badRequest().body(Map.of("message", "No file available for import. Upload chunks first."));
        }
        if ("PROCESSING".equals(upload.getImportStatus())) {
            return ResponseEntity.badRequest().body(Map.of("message", "Import is already in progress"));
        }

        upload.setImportStatus("PROCESSING");
        upload.setImportProgressPct(0);
        upload.setImportedRowCount(0);
        upload.setImportError(null);
        uploadRepository.save(upload);

        // Kick off async import
        batchImportService.processImport(project.getId(), upload.getId(), principal.id());

        log.info("Batch import started for project {} upload {}", project.getId(), upload.getId());

        return ResponseEntity.ok(new ImportStatusDto("PROCESSING", 0, 0,
                upload.getRowCount() != null ? upload.getRowCount() : 0, null, true));
    }

    // --- GET /my-onboarding/import/status — Get import progress ---

    @GetMapping("/import/status")
    public ResponseEntity<?> importStatus(@AuthenticationPrincipal UserPrincipal principal) {
        Project project = resolveProject();
        if (project == null) return notFound();

        ProjectDataUpload upload = uploadRepository.findFirstByProjectIdOrderByCreatedAtDesc(project.getId())
                .orElse(null);
        if (upload == null) {
            return ResponseEntity.ok(new ImportStatusDto("NONE", 0, 0, 0, null, false));
        }

        boolean previewOnly = upload.getUploadStatus() == UploadStatus.PREVIEW_ONLY;
        return ResponseEntity.ok(new ImportStatusDto(
                upload.getImportStatus() != null ? upload.getImportStatus() : "NONE",
                upload.getImportProgressPct() != null ? upload.getImportProgressPct() : 0,
                upload.getImportedRowCount() != null ? upload.getImportedRowCount() : 0,
                upload.getRowCount() != null ? upload.getRowCount() : 0,
                upload.getImportError(),
                previewOnly));
    }

    // ---- Internal helpers ----

    private Project resolveProject() {
        UUID tenantId = TenantContext.getCurrentTenantId();
        if (tenantId == null) return null;
        Tenant tenant = tenantRepository.findById(tenantId).orElse(null);
        if (tenant == null) return null;
        return tenant.getOnboardingProject();
    }

    private ResponseEntity<?> notFound() {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(Map.of("message", "No onboarding project found. Visit overview to create one."));
    }

    private TenantOnboardingDto buildDto(Project project) {
        List<PhaseGate> gates = phaseGateRepository.findByProjectIdOrderByPhase(project.getId());
        List<PhaseGateDto> gateDtos = gates.stream()
                .map(g -> new PhaseGateDto(g.getPhase(), g.getGateStatus(), null, g.getClearedAt()))
                .toList();

        // Upload status
        ProjectDataUpload latestUpload = uploadRepository
                .findFirstByProjectIdOrderByCreatedAtDesc(project.getId()).orElse(null);
        String uploadStatus = latestUpload == null ? "NONE"
                : latestUpload.getUploadStatus() == UploadStatus.PARSED ? "PARSED" : "UPLOADED";
        String uploadFilename = latestUpload != null ? latestUpload.getOriginalFilename() : null;
        Integer uploadRowCount = latestUpload != null ? latestUpload.getRowCount() : null;

        // Mapping stats
        UUID pid = project.getId();
        long mapped = mappingRepository.countByProjectIdAndMappingStatus(pid, MappingStatus.MAPPED);
        long needsReview = mappingRepository.countByProjectIdAndMappingStatus(pid, MappingStatus.NEEDS_REVIEW);
        long unmapped = mappingRepository.countByProjectIdAndMappingStatus(pid, MappingStatus.UNMAPPED);
        long cfv = mappingRepository.countByProjectIdAndMappingStatus(pid, MappingStatus.CFV_PROPOSAL);
        long rejected = mappingRepository.countByProjectIdAndMappingStatus(pid, MappingStatus.REJECTED);
        MappingStatsDto mappingStats = new MappingStatsDto(mapped + needsReview + unmapped + cfv + rejected,
                mapped, needsReview, unmapped);

        // Decision stats
        long dOpen = decisionRepository.countByProjectIdAndDecisionStatus(pid, DecisionStatus.OPEN);
        long dApproved = decisionRepository.countByProjectIdAndDecisionStatus(pid, DecisionStatus.APPROVED);
        long dRejected = decisionRepository.countByProjectIdAndDecisionStatus(pid, DecisionStatus.REJECTED);
        DecisionStatsDto decisionStats = new DecisionStatsDto(dOpen + dApproved + dRejected, dOpen, dApproved, dRejected);

        return new TenantOnboardingDto(
                project.getId(), project.getName(),
                project.getMigrationPhase(), project.getMigrationStatus(),
                project.getReconciliationPct(), gateDtos,
                uploadStatus, uploadFilename, uploadRowCount,
                mappingStats, decisionStats, project.getCreatedAt());
    }

    private ResponseEntity<?> saveUploadResult(Project project, String filename, Path filePath,
                                                FileParsingService.ParsedFileResult result, String sheetName) {
        ProjectDataUpload upload = new ProjectDataUpload();
        upload.setProject(project);
        upload.setOriginalFilename(filename);
        upload.setSheetName(sheetName);
        upload.setRowCount(result.totalRows());
        upload.setSourceColumns(result.sourceColumns());
        upload.setStoragePath(filePath.toString());
        upload.setUploadStatus(UploadStatus.PARSED);
        uploadRepository.save(upload);

        // Create source schema nodes and auto-map to target fields
        createSchemaNodes(project, result);
        createAutoMappings(project, result);

        auditService.log("UPLOAD", "OnboardingProject", project.getId(), filename);
        log.info("File uploaded for onboarding project {}: {}", project.getId(), filename);

        return ResponseEntity.ok(new UploadResultDto(
                upload.getId(), filename, result.totalRows(),
                result.sourceColumns(), false, List.of(), false, 0));
    }

    /** Store upload as PENDING — file is saved but mappings are NOT processed yet. */
    private ResponseEntity<?> savePendingUpload(Project project, String filename, Path filePath,
                                                 FileParsingService.ParsedFileResult result,
                                                 String sheetName, long existingFinalized) {
        ProjectDataUpload upload = new ProjectDataUpload();
        upload.setProject(project);
        upload.setOriginalFilename(filename);
        upload.setSheetName(sheetName);
        upload.setRowCount(result.totalRows());
        upload.setSourceColumns(result.sourceColumns());
        upload.setStoragePath(filePath.toString());
        upload.setUploadStatus(UploadStatus.PENDING);
        uploadRepository.save(upload);

        log.info("Upload pending confirmation for project {}: {} (existing finalized: {})",
                project.getId(), filename, existingFinalized);

        return ResponseEntity.ok(new UploadResultDto(
                upload.getId(), filename, result.totalRows(),
                result.sourceColumns(), false, List.of(), true, existingFinalized));
    }

    private void createSchemaNodes(Project project, FileParsingService.ParsedFileResult result) {
        // Clear existing schema nodes for this project
        schemaNodeRepository.deleteByProjectId(project.getId());

        // Create parent ENTITY node
        SourceSchemaNode parent = new SourceSchemaNode();
        parent.setProject(project);
        parent.setNodeName("Uploaded Data");
        parent.setNodeType("ENTITY");
        parent.setRecordCount(result.totalRows());
        parent.setSortOrder(0);
        parent = schemaNodeRepository.save(parent);

        // Create FIELD nodes for each column
        for (int i = 0; i < result.headers().size(); i++) {
            SourceSchemaNode field = new SourceSchemaNode();
            field.setProject(project);
            field.setParent(parent);
            field.setNodeName(result.headers().get(i));
            field.setNodeType("FIELD");
            field.setSortOrder(i);
            schemaNodeRepository.save(field);
        }
    }

    private String getUploadPath(Project project) {
        return uploadRepository.findFirstByProjectIdOrderByCreatedAtDesc(project.getId())
                .map(ProjectDataUpload::getStoragePath)
                .orElse(null);
    }

    // --- Auto-mapping logic ---

    private static final List<TargetFieldDef> TARGET_FIELDS = List.of(
            new TargetFieldDef("Contact", "firstName", "First name",
                    Set.of("firstname", "first", "fname", "givenname")),
            new TargetFieldDef("Contact", "lastName", "Last name",
                    Set.of("lastname", "last", "lname", "surname", "familyname")),
            new TargetFieldDef("Contact", "email", "Email address",
                    Set.of("email", "emailaddress", "mail", "contactemail", "primaryemail")),
            new TargetFieldDef("Contact", "phone", "Phone number",
                    Set.of("phone", "phonenumber", "telephone", "tel", "primaryphone", "mobile",
                            "cellphone", "cell", "workphone")),
            new TargetFieldDef("Contact", "company", "Company / Organization",
                    Set.of("company", "companyname", "organization", "organisation", "org",
                            "employer", "business", "firm")),
            new TargetFieldDef("Contact", "title", "Job title",
                    Set.of("title", "jobtitle", "position", "role", "designation")),
            new TargetFieldDef("Contact", "address1", "Street address line 1",
                    Set.of("address1", "address", "streetaddress", "street", "addressline1",
                            "mailingaddress", "primaryaddress")),
            new TargetFieldDef("Contact", "address2", "Street address line 2",
                    Set.of("address2", "addressline2", "suite", "apt", "unit")),
            new TargetFieldDef("Contact", "city", "City",
                    Set.of("city", "town", "locality")),
            new TargetFieldDef("Contact", "state", "State / Province",
                    Set.of("state", "province", "region", "stateprovince")),
            new TargetFieldDef("Contact", "zip", "Zip / Postal code",
                    Set.of("zip", "zipcode", "postalcode", "postal", "postcode")),
            new TargetFieldDef("Contact", "country", "Country",
                    Set.of("country", "countrycode", "nation")),
            new TargetFieldDef("Membership", "memberType", "Membership type",
                    Set.of("membertype", "membershiptype", "membership", "type", "category",
                            "memberlevel", "membershiplevel", "level")),
            new TargetFieldDef("Membership", "joinDate", "Join / Start date",
                    Set.of("joindate", "startdate", "datejoined", "membershipstart", "membersince",
                            "enrollmentdate", "activationdate", "signupdate")),
            new TargetFieldDef("Membership", "expirationDate", "Expiration date",
                    Set.of("expirationdate", "expdate", "expiration", "enddate", "renewaldate",
                            "membershipend", "expiry", "expirydate")),
            new TargetFieldDef("Membership", "notes", "Notes / Comments",
                    Set.of("notes", "comments", "description", "memo", "remarks", "note", "comment"))
    );

    private record TargetFieldDef(String entity, String field, String description, Set<String> aliases) {}

    private record FieldMatch(TargetFieldDef target, BigDecimal confidence) {}

    private void createAutoMappings(Project project, FileParsingService.ParsedFileResult result) {
        // If headers haven't changed, just update sample values — don't re-map
        List<FieldMappingEntry> existing = mappingRepository.findAllByProjectId(project.getId());
        if (!existing.isEmpty() && headersMatch(existing, result.headers())) {
            updateSampleValues(existing, result);
            log.info("Headers unchanged for project {} — preserved {} existing mappings",
                    project.getId(), existing.size());
            return;
        }

        // Clear existing mappings for this project
        mappingRepository.deleteByProjectId(project.getId());

        // Try AI-powered mapping first, fall back to rule-based
        if (aiMappingService.isAvailable()) {
            try {
                createAiMappings(project, result);
                return;
            } catch (Exception e) {
                log.warn("AI mapping failed for project {}, falling back to rule-based: {}",
                        project.getId(), e.getMessage());
                // Clear any partial AI results
                mappingRepository.deleteByProjectId(project.getId());
            }
        }

        createRuleBasedMappings(project, result);
    }

    /**
     * Check if the existing mapping source fields match the new upload headers.
     */
    private boolean headersMatch(List<FieldMappingEntry> existing, List<String> newHeaders) {
        Set<String> existingNormalized = new HashSet<>();
        for (FieldMappingEntry e : existing) {
            existingNormalized.add(normalize(e.getSourceField()));
        }
        Set<String> newNormalized = new HashSet<>();
        for (String h : newHeaders) {
            newNormalized.add(normalize(h));
        }
        return existingNormalized.equals(newNormalized);
    }

    /**
     * Update sample values on existing mappings from the new upload without changing mappings.
     */
    private void updateSampleValues(List<FieldMappingEntry> existing, FileParsingService.ParsedFileResult result) {
        Map<String, String> newSamples = new HashMap<>();
        for (int i = 0; i < result.headers().size(); i++) {
            String sampleValue = null;
            if (result.sourceColumns() != null && i < result.sourceColumns().size()) {
                Object sv = result.sourceColumns().get(i).get("sampleValues");
                if (sv instanceof List<?> list && !list.isEmpty()) {
                    sampleValue = String.valueOf(list.get(0));
                }
            }
            newSamples.put(normalize(result.headers().get(i)), sampleValue);
        }
        for (FieldMappingEntry e : existing) {
            String key = normalize(e.getSourceField());
            if (newSamples.containsKey(key)) {
                e.setSampleValue(newSamples.get(key));
                mappingRepository.save(e);
            }
        }
    }

    private void createAiMappings(Project project, FileParsingService.ParsedFileResult result) {
        // Build inputs for AI service
        List<AiMappingService.FieldInput> sourceFields = new ArrayList<>();
        Map<String, String> sampleValues = new HashMap<>();

        for (int i = 0; i < result.headers().size(); i++) {
            String header = result.headers().get(i);
            String sampleValue = null;
            if (result.sourceColumns() != null && i < result.sourceColumns().size()) {
                Object sv = result.sourceColumns().get(i).get("sampleValues");
                if (sv instanceof List<?> list && !list.isEmpty()) {
                    sampleValue = String.valueOf(list.get(0));
                }
            }
            sourceFields.add(new AiMappingService.FieldInput(header, sampleValue));
            sampleValues.put(header, sampleValue);
        }

        List<AiMappingService.TargetFieldDef> targetDefs = TARGET_FIELDS.stream()
                .map(t -> new AiMappingService.TargetFieldDef(t.entity(), t.field(), t.description()))
                .toList();

        // Call Claude
        List<AiMappingService.AiMapping> aiMappings = aiMappingService.mapFields(sourceFields, targetDefs);

        // Convert AI results to FieldMappingEntry records
        Set<String> usedTargets = new HashSet<>();
        int matched = 0;

        for (AiMappingService.AiMapping aim : aiMappings) {
            FieldMappingEntry entry = new FieldMappingEntry();
            entry.setProject(project);
            entry.setSourceEntity("Uploaded Data");
            entry.setSourceField(aim.sourceField());
            entry.setSampleValue(sampleValues.get(aim.sourceField()));

            if (aim.targetField() != null && !usedTargets.contains(aim.targetField())
                    && aim.confidence().compareTo(BigDecimal.valueOf(40)) > 0) {
                usedTargets.add(aim.targetField());
                entry.setTargetEntity(aim.targetEntity());
                entry.setTargetField(aim.targetField());
                entry.setConfidencePct(aim.confidence());
                entry.setMappingStatus(MappingStatus.NEEDS_REVIEW);
                matched++;

                // Also add rule-based candidates for alternatives
                entry = mappingRepository.save(entry);
                String normalized = normalize(aim.sourceField());
                List<FieldMatch> ruleMatches = findMatches(normalized);
                int order = 0;
                for (FieldMatch m : ruleMatches) {
                    if (m.target().field().equals(aim.targetField())) continue;
                    MappingCandidate candidate = new MappingCandidate();
                    candidate.setFieldMapping(entry);
                    candidate.setTargetField(m.target().field());
                    candidate.setMatchPct(m.confidence());
                    candidate.setDescription(m.target().description());
                    candidate.setSortOrder(order++);
                    entry.getCandidates().add(candidate);
                }
                if (!entry.getCandidates().isEmpty()) {
                    mappingRepository.save(entry);
                }
            } else {
                entry.setMappingStatus(MappingStatus.UNMAPPED);
                mappingRepository.save(entry);
            }
        }

        log.info("AI-mapped {} fields for project {} ({} matched)",
                result.headers().size(), project.getId(), matched);
    }

    private void createRuleBasedMappings(Project project, FileParsingService.ParsedFileResult result) {
        Set<String> usedTargets = new HashSet<>();

        for (int i = 0; i < result.headers().size(); i++) {
            String header = result.headers().get(i);
            String normalized = normalize(header);

            // Get sample value from sourceColumns
            String sampleValue = null;
            if (result.sourceColumns() != null && i < result.sourceColumns().size()) {
                Object sv = result.sourceColumns().get(i).get("sampleValues");
                if (sv instanceof List<?> list && !list.isEmpty()) {
                    sampleValue = String.valueOf(list.get(0));
                }
            }

            // Find best match
            List<FieldMatch> matches = findMatches(normalized);

            FieldMappingEntry entry = new FieldMappingEntry();
            entry.setProject(project);
            entry.setSourceEntity("Uploaded Data");
            entry.setSourceField(header);
            entry.setSampleValue(sampleValue);

            if (!matches.isEmpty()) {
                // Pick best match that hasn't been used
                FieldMatch best = null;
                for (FieldMatch m : matches) {
                    if (!usedTargets.contains(m.target().field())) {
                        best = m;
                        break;
                    }
                }

                if (best != null) {
                    usedTargets.add(best.target().field());
                    entry.setTargetEntity(best.target().entity());
                    entry.setTargetField(best.target().field());
                    entry.setConfidencePct(best.confidence());
                    entry.setMappingStatus(MappingStatus.NEEDS_REVIEW);

                    // Add other matches as candidates
                    entry = mappingRepository.save(entry);
                    int order = 0;
                    for (FieldMatch m : matches) {
                        if (m.target().field().equals(best.target().field())) continue;
                        MappingCandidate candidate = new MappingCandidate();
                        candidate.setFieldMapping(entry);
                        candidate.setTargetField(m.target().field());
                        candidate.setMatchPct(m.confidence());
                        candidate.setDescription(m.target().description());
                        candidate.setSortOrder(order++);
                        entry.getCandidates().add(candidate);
                    }
                    if (!entry.getCandidates().isEmpty()) {
                        mappingRepository.save(entry);
                    }
                } else {
                    entry.setMappingStatus(MappingStatus.UNMAPPED);
                    mappingRepository.save(entry);
                }
            } else {
                entry.setMappingStatus(MappingStatus.UNMAPPED);
                mappingRepository.save(entry);
            }
        }

        log.info("Rule-based mapped {} fields for project {} ({} matched)",
                result.headers().size(), project.getId(), usedTargets.size());
    }

    /**
     * Smart re-mapping: preserve user-finalized mappings (MAPPED, REJECTED) when
     * column names haven't changed, and re-map everything else fresh.
     */
    private void createSmartMappings(Project project, FileParsingService.ParsedFileResult result) {
        // Load existing mappings keyed by normalized source field name
        List<FieldMappingEntry> existingMappings = mappingRepository.findAllByProjectId(project.getId());
        Map<String, FieldMappingEntry> existingBySource = new HashMap<>();
        for (FieldMappingEntry e : existingMappings) {
            existingBySource.put(normalize(e.getSourceField()), e);
        }

        // Track which existing mappings are still relevant (matched to a new column)
        Set<String> matchedExisting = new HashSet<>();
        // Track which target fields are already taken by preserved mappings
        Set<String> usedTargets = new HashSet<>();

        int preserved = 0;
        int remapped = 0;

        // First pass: identify preserved mappings and collect their target fields
        for (String header : result.headers()) {
            String normalized = normalize(header);
            FieldMappingEntry existing = existingBySource.get(normalized);
            if (existing != null && (existing.getMappingStatus() == MappingStatus.MAPPED
                    || existing.getMappingStatus() == MappingStatus.REJECTED)) {
                matchedExisting.add(normalized);
                if (existing.getTargetField() != null) {
                    usedTargets.add(existing.getTargetField());
                }
            }
        }

        // Second pass: process each column in the new file
        for (int i = 0; i < result.headers().size(); i++) {
            String header = result.headers().get(i);
            String normalized = normalize(header);

            // Get sample value from new upload
            String sampleValue = null;
            if (result.sourceColumns() != null && i < result.sourceColumns().size()) {
                Object sv = result.sourceColumns().get(i).get("sampleValues");
                if (sv instanceof List<?> list && !list.isEmpty()) {
                    sampleValue = String.valueOf(list.get(0));
                }
            }

            FieldMappingEntry existing = existingBySource.get(normalized);

            if (existing != null && (existing.getMappingStatus() == MappingStatus.MAPPED
                    || existing.getMappingStatus() == MappingStatus.REJECTED)) {
                // Preserve this mapping — just update the sample value
                existing.setSampleValue(sampleValue);
                existing.setSourceField(header); // use exact casing from new file
                mappingRepository.save(existing);
                preserved++;
            } else {
                // Delete old mapping if it exists (was NEEDS_REVIEW or UNMAPPED)
                if (existing != null) {
                    mappingRepository.delete(existing);
                }

                // Create fresh auto-mapping
                List<FieldMatch> matches = findMatches(normalized);

                FieldMappingEntry entry = new FieldMappingEntry();
                entry.setProject(project);
                entry.setSourceEntity("Uploaded Data");
                entry.setSourceField(header);
                entry.setSampleValue(sampleValue);

                if (!matches.isEmpty()) {
                    FieldMatch best = null;
                    for (FieldMatch m : matches) {
                        if (!usedTargets.contains(m.target().field())) {
                            best = m;
                            break;
                        }
                    }

                    if (best != null) {
                        usedTargets.add(best.target().field());
                        entry.setTargetEntity(best.target().entity());
                        entry.setTargetField(best.target().field());
                        entry.setConfidencePct(best.confidence());
                        entry.setMappingStatus(MappingStatus.NEEDS_REVIEW);

                        entry = mappingRepository.save(entry);
                        int order = 0;
                        for (FieldMatch m : matches) {
                            if (m.target().field().equals(best.target().field())) continue;
                            MappingCandidate candidate = new MappingCandidate();
                            candidate.setFieldMapping(entry);
                            candidate.setTargetField(m.target().field());
                            candidate.setMatchPct(m.confidence());
                            candidate.setDescription(m.target().description());
                            candidate.setSortOrder(order++);
                            entry.getCandidates().add(candidate);
                        }
                        if (!entry.getCandidates().isEmpty()) {
                            mappingRepository.save(entry);
                        }
                    } else {
                        entry.setMappingStatus(MappingStatus.UNMAPPED);
                        mappingRepository.save(entry);
                    }
                } else {
                    entry.setMappingStatus(MappingStatus.UNMAPPED);
                    mappingRepository.save(entry);
                }
                remapped++;
            }
        }

        // Delete mappings for columns that no longer exist in the new file
        Set<String> newHeaders = new HashSet<>();
        for (String header : result.headers()) {
            newHeaders.add(normalize(header));
        }
        int removed = 0;
        for (FieldMappingEntry e : existingMappings) {
            if (!newHeaders.contains(normalize(e.getSourceField()))) {
                mappingRepository.delete(e);
                removed++;
            }
        }

        log.info("Smart re-mapped for project {}: {} preserved, {} remapped, {} removed",
                project.getId(), preserved, remapped, removed);
    }

    private List<FieldMatch> findMatches(String normalized) {
        List<FieldMatch> matches = new ArrayList<>();
        for (TargetFieldDef target : TARGET_FIELDS) {
            // Tier 1: Exact alias match → 95%
            if (target.aliases().contains(normalized)) {
                matches.add(new FieldMatch(target, new BigDecimal("95.00")));
                continue;
            }
            // Tier 2: Normalized target field name match → 90%
            if (normalize(target.field()).equals(normalized)) {
                matches.add(new FieldMatch(target, new BigDecimal("90.00")));
                continue;
            }
            // Tier 3: Partial match — source contains target or vice versa → 70%
            String normalizedTarget = normalize(target.field());
            if (normalized.contains(normalizedTarget) || normalizedTarget.contains(normalized)) {
                matches.add(new FieldMatch(target, new BigDecimal("70.00")));
                continue;
            }
            // Tier 4: Check if any alias is a substring → 65%
            boolean aliasSubstringMatch = false;
            for (String alias : target.aliases()) {
                if (normalized.contains(alias) || alias.contains(normalized)) {
                    matches.add(new FieldMatch(target, new BigDecimal("65.00")));
                    aliasSubstringMatch = true;
                    break;
                }
            }
            if (aliasSubstringMatch) continue;
            // Tier 5: Jaro-Winkler similarity against field name and aliases → scaled confidence
            double bestSimilarity = jaroWinkler(normalized, normalizedTarget);
            for (String alias : target.aliases()) {
                bestSimilarity = Math.max(bestSimilarity, jaroWinkler(normalized, alias));
            }
            if (bestSimilarity >= 0.82) {
                // Scale: 0.82 → 50%, 1.0 → 60%  (linear between)
                double confidence = 50.0 + (bestSimilarity - 0.82) / (1.0 - 0.82) * 10.0;
                matches.add(new FieldMatch(target, BigDecimal.valueOf(confidence).setScale(2, java.math.RoundingMode.HALF_UP)));
            }
        }
        matches.sort((a, b) -> b.confidence().compareTo(a.confidence()));
        return matches;
    }

    /**
     * Jaro-Winkler similarity: returns 0.0–1.0.
     * Optimized for short strings like field names; boosts score when strings share a common prefix.
     */
    private static double jaroWinkler(String s1, String s2) {
        if (s1.equals(s2)) return 1.0;
        if (s1.isEmpty() || s2.isEmpty()) return 0.0;

        int maxDist = Math.max(s1.length(), s2.length()) / 2 - 1;
        if (maxDist < 0) maxDist = 0;

        boolean[] s1Matched = new boolean[s1.length()];
        boolean[] s2Matched = new boolean[s2.length()];
        int matches = 0;

        for (int i = 0; i < s1.length(); i++) {
            int lo = Math.max(0, i - maxDist);
            int hi = Math.min(i + maxDist + 1, s2.length());
            for (int j = lo; j < hi; j++) {
                if (s2Matched[j] || s1.charAt(i) != s2.charAt(j)) continue;
                s1Matched[i] = true;
                s2Matched[j] = true;
                matches++;
                break;
            }
        }
        if (matches == 0) return 0.0;

        int transpositions = 0;
        int k = 0;
        for (int i = 0; i < s1.length(); i++) {
            if (!s1Matched[i]) continue;
            while (!s2Matched[k]) k++;
            if (s1.charAt(i) != s2.charAt(k)) transpositions++;
            k++;
        }

        double jaro = ((double) matches / s1.length()
                + (double) matches / s2.length()
                + (matches - transpositions / 2.0) / matches) / 3.0;

        // Winkler prefix boost (up to 4 chars)
        int prefix = 0;
        for (int i = 0; i < Math.min(4, Math.min(s1.length(), s2.length())); i++) {
            if (s1.charAt(i) == s2.charAt(i)) prefix++;
            else break;
        }
        return jaro + prefix * 0.1 * (1.0 - jaro);
    }

    private static String normalize(String s) {
        return s.toLowerCase().replaceAll("[^a-z0-9]", "");
    }
}
