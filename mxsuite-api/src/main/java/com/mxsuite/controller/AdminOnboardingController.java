package com.mxsuite.controller;

import com.mxsuite.audit.AuditService;
import com.mxsuite.model.FieldMappingEntry;
import com.mxsuite.model.Onboarding;
import com.mxsuite.model.Project;
import com.mxsuite.model.enums.MappingStatus;
import com.mxsuite.model.enums.OnboardingStatus;
import com.mxsuite.model.ProjectDataUpload;
import com.mxsuite.repository.FieldMappingEntryRepository;
import com.mxsuite.repository.OnboardingRepository;
import com.mxsuite.repository.ProjectDataUploadRepository;
import com.mxsuite.repository.TenantRepository;
import com.mxsuite.repository.UserRepository;
import com.mxsuite.service.MappingVersionService;
import com.mxsuite.service.TargetSchemaService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/admin/tenants/{tenantId}/onboarding")
@PreAuthorize("hasAnyRole('PLATFORM_ADMIN', 'COACH_ADMIN', 'PLATFORM_SUPPORT')")
@Transactional(readOnly = true)
public class AdminOnboardingController {

    private static final Logger log = LoggerFactory.getLogger(AdminOnboardingController.class);

    private final OnboardingRepository onboardingRepository;
    private final TenantRepository tenantRepository;
    private final UserRepository userRepository;
    private final FieldMappingEntryRepository mappingRepository;
    private final ProjectDataUploadRepository uploadRepository;
    private final AuditService auditService;
    private final MappingVersionService versionService;
    private final TargetSchemaService targetSchemaService;

    public AdminOnboardingController(OnboardingRepository onboardingRepository,
                                     TenantRepository tenantRepository,
                                     UserRepository userRepository,
                                     FieldMappingEntryRepository mappingRepository,
                                     ProjectDataUploadRepository uploadRepository,
                                     AuditService auditService,
                                     MappingVersionService versionService,
                                     TargetSchemaService targetSchemaService) {
        this.onboardingRepository = onboardingRepository;
        this.tenantRepository = tenantRepository;
        this.userRepository = userRepository;
        this.mappingRepository = mappingRepository;
        this.uploadRepository = uploadRepository;
        this.auditService = auditService;
        this.versionService = versionService;
        this.targetSchemaService = targetSchemaService;
    }

    // --- DTOs ---

    public record MappingDto(
            UUID id, String sourceEntity, String sourceField, String sampleValue,
            String targetEntity, String targetField, String coercion,
            BigDecimal confidencePct, MappingStatus mappingStatus,
            String customerComment, Instant createdAt) {}

    private MappingDto toDto(FieldMappingEntry e) {
        return new MappingDto(e.getId(), e.getSourceEntity(), e.getSourceField(),
                e.getSampleValue(), e.getTargetEntity(), e.getTargetField(),
                e.getCoercion(), e.getConfidencePct(), e.getMappingStatus(),
                e.getCustomerComment(), e.getCreatedAt());
    }

    // ---- Schema / legacy onboarding endpoints ----

    @GetMapping
    public ResponseEntity<?> getByTenant(@PathVariable("tenantId") UUID tenantId) {
        var onboarding = onboardingRepository.findByTenantId(tenantId).orElse(null);
        if (onboarding == null) {
            return ResponseEntity.notFound().build();
        }
        enrichModifierName(onboarding);
        return ResponseEntity.ok(onboarding);
    }

    @GetMapping("/schema")
    public ResponseEntity<?> getSchema(@PathVariable("tenantId") UUID tenantId) {
        var onboarding = onboardingRepository.findByTenantId(tenantId).orElse(null);
        List<Map<String, Object>> stored = (onboarding != null) ? onboarding.getTargetSchema() : null;

        // Use stored schema only if it's v2 format (has entity info).
        // Legacy schemas without entity grouping fall through to the default.
        List<Map<String, Object>> schema;
        if (stored != null && !stored.isEmpty() && hasEntityInfo(stored)) {
            schema = stored;
        } else {
            schema = targetSchemaService.getFlatFields();
        }
        return ResponseEntity.ok(Map.of(
                "targetSchema", schema,
                "hasOnboarding", onboarding != null
        ));
    }

    private static boolean hasEntityInfo(List<Map<String, Object>> schema) {
        return schema.stream().anyMatch(f -> f.get("entity") != null);
    }

    @GetMapping("/schema/v2")
    public ResponseEntity<?> getSchemaV2(@PathVariable("tenantId") UUID tenantId) {
        return ResponseEntity.ok(targetSchemaService.getHierarchicalSchema());
    }

    public record UpdateSchemaRequest(List<Map<String, Object>> targetSchema) {}

    @PutMapping("/schema")
    @PreAuthorize("hasAnyRole('PLATFORM_ADMIN', 'COACH_ADMIN', 'PLATFORM_SUPPORT')")
    @Transactional
    public ResponseEntity<?> updateSchema(@PathVariable("tenantId") UUID tenantId,
                                          @RequestBody UpdateSchemaRequest request) {
        var tenant = tenantRepository.findById(tenantId).orElse(null);
        if (tenant == null) {
            return ResponseEntity.notFound().build();
        }

        var onboarding = onboardingRepository.findByTenantId(tenantId).orElse(null);
        if (onboarding == null) {
            onboarding = new Onboarding();
            onboarding.setTenant(tenant);
            onboarding.setStatus(OnboardingStatus.WELCOME);
            onboarding.setCurrentStep(0);
            log.info("Auto-created onboarding for tenant={} during schema configuration", tenant.getSlug());
        }

        onboarding.setTargetSchema(request.targetSchema());
        onboarding = onboardingRepository.save(onboarding);

        auditService.log("UPDATE_SCHEMA", "Onboarding", onboarding.getId(), tenant.getName());
        log.info("Updated onboarding schema for tenant={}, {} fields", tenant.getSlug(),
                request.targetSchema() != null ? request.targetSchema().size() : 0);

        return ResponseEntity.ok(Map.of("targetSchema", onboarding.getTargetSchema()));
    }

    // ---- Onboarding project / mapping endpoints (for coaches) ----

    @GetMapping("/project")
    public ResponseEntity<?> getProject(@PathVariable("tenantId") UUID tenantId) {
        var tenant = tenantRepository.findById(tenantId).orElse(null);
        if (tenant == null) return ResponseEntity.notFound().build();

        Project project = tenant.getOnboardingProject();
        if (project == null) {
            return ResponseEntity.ok(Map.of("hasProject", false));
        }

        UUID pid = project.getId();
        long mapped = mappingRepository.countByProjectIdAndMappingStatus(pid, MappingStatus.MAPPED);
        long needsReview = mappingRepository.countByProjectIdAndMappingStatus(pid, MappingStatus.NEEDS_REVIEW);
        long unmapped = mappingRepository.countByProjectIdAndMappingStatus(pid, MappingStatus.UNMAPPED);
        long rejected = mappingRepository.countByProjectIdAndMappingStatus(pid, MappingStatus.REJECTED);
        long total = mapped + needsReview + unmapped + rejected
                + mappingRepository.countByProjectIdAndMappingStatus(pid, MappingStatus.CFV_PROPOSAL);

        // Build response with upload/staging/export info from latest upload
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("hasProject", true);
        result.put("projectId", project.getId());
        result.put("projectName", project.getName());
        result.put("migrationPhase", project.getMigrationPhase());
        result.put("migrationStatus", project.getMigrationStatus());
        result.put("mappingStats", Map.of(
                "total", total, "mapped", mapped,
                "needsReview", needsReview, "unmapped", unmapped, "rejected", rejected));

        uploadRepository.findFirstByProjectIdOrderByCreatedAtDesc(pid).ifPresent(upload -> {
            result.put("uploadId", upload.getId());
            result.put("uploadFilename", upload.getOriginalFilename());
            result.put("uploadRowCount", upload.getRowCount());
            result.put("stagingStatus", upload.getStagingStatus());
            result.put("s3ExportStatus", upload.getS3ExportStatus());
            if (upload.getS3ExportedAt() != null) {
                result.put("s3ExportedAt", upload.getS3ExportedAt().toString());
            }
        });

        return ResponseEntity.ok(result);
    }

    @GetMapping("/project/mappings")
    public ResponseEntity<?> listMappings(@PathVariable("tenantId") UUID tenantId, Pageable pageable) {
        var tenant = tenantRepository.findById(tenantId).orElse(null);
        if (tenant == null) return ResponseEntity.notFound().build();

        Project project = tenant.getOnboardingProject();
        if (project == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("message", "Tenant has no onboarding project yet"));
        }

        Page<FieldMappingEntry> page = mappingRepository.findByProjectId(project.getId(), pageable);
        return ResponseEntity.ok(page.map(this::toDto));
    }

    @GetMapping("/project/mappings/stats")
    public ResponseEntity<?> mappingStats(@PathVariable("tenantId") UUID tenantId) {
        var tenant = tenantRepository.findById(tenantId).orElse(null);
        if (tenant == null) return ResponseEntity.notFound().build();

        Project project = tenant.getOnboardingProject();
        if (project == null) {
            return ResponseEntity.ok(Map.of("total", 0, "mapped", 0, "needsReview", 0,
                    "unmapped", 0, "rejected", 0));
        }

        UUID pid = project.getId();
        long mapped = mappingRepository.countByProjectIdAndMappingStatus(pid, MappingStatus.MAPPED);
        long needsReview = mappingRepository.countByProjectIdAndMappingStatus(pid, MappingStatus.NEEDS_REVIEW);
        long unmapped = mappingRepository.countByProjectIdAndMappingStatus(pid, MappingStatus.UNMAPPED);
        long rejected = mappingRepository.countByProjectIdAndMappingStatus(pid, MappingStatus.REJECTED);
        long total = mapped + needsReview + unmapped + rejected
                + mappingRepository.countByProjectIdAndMappingStatus(pid, MappingStatus.CFV_PROPOSAL);

        return ResponseEntity.ok(Map.of("total", total, "mapped", mapped,
                "needsReview", needsReview, "unmapped", unmapped, "rejected", rejected));
    }

    @PutMapping("/project/mappings/{mappingId}")
    @Transactional
    public ResponseEntity<?> updateMapping(@PathVariable("tenantId") UUID tenantId,
                                            @PathVariable("mappingId") UUID mappingId,
                                            @RequestBody Map<String, Object> body) {
        var tenant = tenantRepository.findById(tenantId).orElse(null);
        if (tenant == null) return ResponseEntity.notFound().build();

        Project project = tenant.getOnboardingProject();
        if (project == null) return ResponseEntity.notFound().build();

        FieldMappingEntry mapping = mappingRepository.findById(mappingId).orElse(null);
        if (mapping == null || !mapping.getProject().getId().equals(project.getId())) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
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
        auditService.log("UPDATE", "FieldMapping", mappingId,
                mapping.getSourceField() + " → " + mapping.getTargetField());
        return ResponseEntity.ok(toDto(mapping));
    }

    @PostMapping("/project/mappings/{mappingId}/approve")
    @Transactional
    public ResponseEntity<?> approveMapping(@PathVariable("tenantId") UUID tenantId,
                                             @PathVariable("mappingId") UUID mappingId) {
        var tenant = tenantRepository.findById(tenantId).orElse(null);
        if (tenant == null) return ResponseEntity.notFound().build();

        Project project = tenant.getOnboardingProject();
        if (project == null) return ResponseEntity.notFound().build();

        FieldMappingEntry mapping = mappingRepository.findById(mappingId).orElse(null);
        if (mapping == null || !mapping.getProject().getId().equals(project.getId())) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        }

        versionService.recordApproval(mapping);
        mapping.setMappingStatus(MappingStatus.MAPPED);
        mappingRepository.save(mapping);

        auditService.log("APPROVE", "FieldMapping", mappingId,
                mapping.getSourceField() + " → " + mapping.getTargetField());
        return ResponseEntity.ok(toDto(mapping));
    }

    @DeleteMapping("/project/mappings")
    @PreAuthorize("hasRole('PLATFORM_ADMIN')")
    @Transactional
    public ResponseEntity<?> clearMappings(@PathVariable("tenantId") UUID tenantId) {
        var tenant = tenantRepository.findById(tenantId).orElse(null);
        if (tenant == null) return ResponseEntity.notFound().build();

        Project project = tenant.getOnboardingProject();
        if (project == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("message", "Tenant has no onboarding project"));
        }

        long count = mappingRepository.countByProjectIdAndMappingStatus(project.getId(), MappingStatus.MAPPED)
                + mappingRepository.countByProjectIdAndMappingStatus(project.getId(), MappingStatus.NEEDS_REVIEW)
                + mappingRepository.countByProjectIdAndMappingStatus(project.getId(), MappingStatus.UNMAPPED)
                + mappingRepository.countByProjectIdAndMappingStatus(project.getId(), MappingStatus.REJECTED)
                + mappingRepository.countByProjectIdAndMappingStatus(project.getId(), MappingStatus.CFV_PROPOSAL);

        mappingRepository.deleteByProjectId(project.getId());

        auditService.log("CLEAR_MAPPINGS", "Project", project.getId(),
                "Cleared " + count + " mappings for re-mapping");
        log.info("Cleared {} mappings for tenant={}, project={}", count, tenant.getSlug(), project.getId());

        return ResponseEntity.ok(Map.of("cleared", count));
    }

    // ---- Internal helpers ----

    private void enrichModifierName(Onboarding onboarding) {
        if (onboarding.getLastModifiedBy() != null) {
            userRepository.findById(onboarding.getLastModifiedBy()).ifPresent(u ->
                    onboarding.setLastModifiedByName(u.getFirstName() + " " + u.getLastName()));
        }
    }

    /** Assign a primary coach to this tenant's onboarding. */
    @PutMapping("/assign-coach")
    @Transactional
    public ResponseEntity<?> assignCoach(@PathVariable UUID tenantId,
                                          @RequestBody Map<String, UUID> body) {
        UUID coachId = body.get("coachId");
        return onboardingRepository.findByTenantId(tenantId)
                .map(ob -> {
                    if (coachId != null) {
                        userRepository.findById(coachId).ifPresent(ob::setAssignedTo);
                    } else {
                        ob.setAssignedTo(null);
                    }
                    onboardingRepository.save(ob);
                    return ResponseEntity.ok(Map.of(
                            "assignedToId", coachId != null ? coachId : "",
                            "message", coachId != null ? "Primary coach assigned" : "Primary coach removed"
                    ));
                })
                .orElse(ResponseEntity.notFound().build());
    }
}
