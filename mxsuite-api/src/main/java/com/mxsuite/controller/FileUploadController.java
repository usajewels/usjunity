package com.mxsuite.controller;

import com.mxsuite.audit.AuditService;
import com.mxsuite.model.ProjectAsset;
import com.mxsuite.repository.ProjectAssetRepository;
import com.mxsuite.repository.ProjectRepository;
import com.mxsuite.repository.UserRepository;
import com.mxsuite.security.TenantContext;
import com.mxsuite.security.UserPrincipal;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.core.io.InputStreamResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@RestController
@RequestMapping("/api/projects/{projectId}/assets")
@Transactional(readOnly = true)
public class FileUploadController {

    private static final Logger log = LoggerFactory.getLogger(FileUploadController.class);

    private static final long MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
    private static final Set<String> ALLOWED_CONTENT_TYPES = Set.of(
            "text/csv",
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/json",
            "text/plain",
            "text/xml",
            "application/xml"
    );

    private final ProjectAssetRepository assetRepository;
    private final ProjectRepository projectRepository;
    private final UserRepository userRepository;
    private final AuditService auditService;
    private final String basePath;

    public FileUploadController(ProjectAssetRepository assetRepository,
                                 ProjectRepository projectRepository,
                                 UserRepository userRepository,
                                 AuditService auditService,
                                 @Value("${mxsuite.storage.local.base-path}") String basePath) {
        this.assetRepository = assetRepository;
        this.projectRepository = projectRepository;
        this.userRepository = userRepository;
        this.auditService = auditService;
        this.basePath = basePath;
    }

    @GetMapping
    public ResponseEntity<Page<ProjectAsset>> list(@PathVariable UUID projectId,
                                                     @AuthenticationPrincipal UserPrincipal principal,
                                                     Pageable pageable) {
        var project = projectRepository.findByIdWithTenant(projectId).orElse(null);
        if (project == null) return ResponseEntity.notFound().build();
        if (!hasAccess(project.getTenant().getId(), principal)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
        return ResponseEntity.ok(assetRepository.findByProjectId(projectId, pageable));
    }

    @PostMapping("/upload")
    @Transactional
    public ResponseEntity<?> upload(@PathVariable UUID projectId,
                                     @AuthenticationPrincipal UserPrincipal principal,
                                     @RequestParam("file") MultipartFile file,
                                     @RequestParam(value = "assetType", defaultValue = "DATA") String assetType) {
        // Validate project exists and user has access
        var project = projectRepository.findByIdWithTenant(projectId).orElse(null);
        if (project == null) return ResponseEntity.notFound().build();
        if (!hasAccess(project.getTenant().getId(), principal)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }

        // Validate file is not empty
        if (file.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "status", 400, "message", "File is empty"));
        }

        // Validate file size
        if (file.getSize() > MAX_FILE_SIZE) {
            return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).body(Map.of(
                    "status", 413, "message", "File exceeds maximum size of 50MB"));
        }

        // Validate content type
        String contentType = file.getContentType();
        if (contentType == null || !ALLOWED_CONTENT_TYPES.contains(contentType)) {
            log.warn("Rejected file upload with content type: {} from user {}", contentType, principal.email());
            return ResponseEntity.status(HttpStatus.UNSUPPORTED_MEDIA_TYPE).body(Map.of(
                    "status", 415,
                    "message", "File type not allowed. Accepted: CSV, Excel, JSON, XML, text"));
        }

        // Validate asset type
        if (!assetType.matches("^[A-Z_]+$")) {
            return ResponseEntity.badRequest().body(Map.of(
                    "status", 400, "message", "Invalid asset type"));
        }

        // Sanitize filename — prevent path traversal
        String originalFilename = file.getOriginalFilename();
        if (originalFilename == null) originalFilename = "unnamed";
        String sanitizedFilename = Paths.get(originalFilename).getFileName().toString()
                .replaceAll("[^a-zA-Z0-9._-]", "_");

        try {
            var user = userRepository.findById(principal.id()).orElseThrow();

            // Use UUID as storage name to prevent collisions and traversal
            String storageName = UUID.randomUUID() + "_" + sanitizedFilename;
            Path storagePath = Paths.get(basePath, project.getTenant().getId().toString(),
                    projectId.toString());

            // Verify resolved path is within base path (defense in depth)
            Path resolvedFile = storagePath.resolve(storageName).normalize();
            if (!resolvedFile.startsWith(Paths.get(basePath).normalize())) {
                log.error("Path traversal attempt detected: resolved={} base={}", resolvedFile, basePath);
                return ResponseEntity.badRequest().body(Map.of(
                        "status", 400, "message", "Invalid file path"));
            }

            Files.createDirectories(storagePath);
            Files.copy(file.getInputStream(), resolvedFile);

            ProjectAsset asset = new ProjectAsset();
            asset.setFilename(sanitizedFilename);
            asset.setContentType(contentType);
            asset.setFileSize(file.getSize());
            asset.setStoragePath(resolvedFile.toString());
            asset.setAssetType(assetType);
            asset.setProject(project);
            asset.setUploadedBy(user);
            asset = assetRepository.save(asset);

            auditService.log("UPLOAD", "ProjectAsset", asset.getId(), asset.getFilename());
            log.info("File uploaded: name='{}' size={} project={} by user={}",
                    sanitizedFilename, file.getSize(), projectId, principal.email());

            return ResponseEntity
                    .created(URI.create("/api/projects/" + projectId + "/assets/" + asset.getId()))
                    .body(asset);
        } catch (IOException e) {
            log.error("File upload failed for project {}: {}", projectId, e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of(
                    "status", 500, "message", "Failed to store file"));
        }
    }

    @GetMapping("/{assetId}/download")
    public ResponseEntity<Resource> download(@PathVariable UUID projectId,
                                              @PathVariable UUID assetId,
                                              @AuthenticationPrincipal UserPrincipal principal) {
        var project = projectRepository.findByIdWithTenant(projectId).orElse(null);
        if (project == null) return ResponseEntity.notFound().build();
        if (!hasAccess(project.getTenant().getId(), principal)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }

        var asset = assetRepository.findById(assetId).orElse(null);
        if (asset == null || !asset.getProject().getId().equals(projectId)) {
            return ResponseEntity.notFound().build();
        }

        try {
            Path filePath = Paths.get(asset.getStoragePath());
            if (!Files.exists(filePath)) {
                log.error("File not found on disk: {}", filePath);
                return ResponseEntity.notFound().build();
            }

            InputStreamResource resource = new InputStreamResource(Files.newInputStream(filePath));
            String contentType = asset.getContentType() != null ? asset.getContentType() : "application/octet-stream";

            return ResponseEntity.ok()
                    .contentType(MediaType.parseMediaType(contentType))
                    .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + asset.getFilename() + "\"")
                    .contentLength(asset.getFileSize())
                    .body(resource);
        } catch (IOException e) {
            log.error("File download failed for asset {}: {}", assetId, e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @DeleteMapping("/{assetId}")
    @Transactional
    public ResponseEntity<?> delete(@PathVariable UUID projectId,
                                     @PathVariable UUID assetId,
                                     @AuthenticationPrincipal UserPrincipal principal) {
        var project = projectRepository.findByIdWithTenant(projectId).orElse(null);
        if (project == null) return ResponseEntity.notFound().build();
        if (!hasAccess(project.getTenant().getId(), principal)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }

        var asset = assetRepository.findById(assetId).orElse(null);
        if (asset == null || !asset.getProject().getId().equals(projectId)) {
            return ResponseEntity.notFound().build();
        }

        try {
            Path filePath = Paths.get(asset.getStoragePath());
            Files.deleteIfExists(filePath);
        } catch (IOException e) {
            log.warn("Could not delete file from disk: {}", e.getMessage());
        }

        assetRepository.delete(asset);
        auditService.log("DELETE", "ProjectAsset", asset.getId(), asset.getFilename());
        log.info("File deleted: name='{}' project={} by user={}", asset.getFilename(), projectId, principal.email());

        return ResponseEntity.noContent().build();
    }

    private boolean hasAccess(UUID projectTenantId, UserPrincipal principal) {
        if (principal.isPlatformUser()) return true;
        UUID tenantId = TenantContext.getCurrentTenantId();
        return projectTenantId.equals(tenantId);
    }
}
