package com.mxsuite.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mxsuite.audit.AuditService;
import com.mxsuite.model.EntityCoverageEntry;
import com.mxsuite.model.FieldMappingEntry;
import com.mxsuite.model.MappingCandidate;
import com.mxsuite.model.Project;
import com.mxsuite.model.SourceSchemaNode;
import com.mxsuite.model.enums.MappingStatus;
import com.mxsuite.repository.FieldMappingEntryRepository;
import com.mxsuite.repository.ProjectRepository;
import com.mxsuite.repository.SourceSchemaNodeRepository;
import com.mxsuite.security.UserPrincipal;
import com.mxsuite.service.MappingImportExportService;
import com.mxsuite.service.MappingVersionService;
import com.mxsuite.service.NotificationService;
import com.mxsuite.service.TargetSchemaService;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;

@RestController
@RequestMapping("/api/projects/{projectId}/mappings")
@Transactional(readOnly = true)
public class FieldMappingController {

    private final FieldMappingEntryRepository mappingRepository;
    private final SourceSchemaNodeRepository schemaNodeRepository;
    private final ProjectRepository projectRepository;
    private final AuditService auditService;
    private final NotificationService notificationService;
    private final MappingVersionService versionService;
    private final MappingImportExportService importExportService;
    private final TargetSchemaService targetSchemaService;

    public FieldMappingController(FieldMappingEntryRepository mappingRepository,
                                   SourceSchemaNodeRepository schemaNodeRepository,
                                   ProjectRepository projectRepository,
                                   AuditService auditService,
                                   NotificationService notificationService,
                                   MappingVersionService versionService,
                                   MappingImportExportService importExportService,
                                   TargetSchemaService targetSchemaService) {
        this.mappingRepository = mappingRepository;
        this.schemaNodeRepository = schemaNodeRepository;
        this.projectRepository = projectRepository;
        this.auditService = auditService;
        this.notificationService = notificationService;
        this.versionService = versionService;
        this.importExportService = importExportService;
        this.targetSchemaService = targetSchemaService;
    }

    // --- DTOs ---

    public record MappingDto(
            UUID id, String sourceEntity, String sourceField, String sampleValue,
            String targetEntity, String targetField, String coercion,
            BigDecimal confidencePct, MappingStatus mappingStatus,
            UUID ownerId, String customerComment,
            List<CandidateDto> candidates, Instant createdAt) {}

    public record CandidateDto(UUID id, String targetField, BigDecimal matchPct, String description) {}

    public record SchemaNodeDto(UUID id, String nodeName, String nodeType, Integer recordCount, List<SchemaNodeDto> children) {}

    public record MappingStatsDto(long all, long needsReview, long cfvProposals, long mapped, long rejected, long unmapped) {}

    public record UpdateMappingRequest(
            String targetEntity, String targetField, String coercion,
            MappingStatus mappingStatus, String customerComment) {}

    // --- Endpoints ---

    @GetMapping
    public Page<MappingDto> list(@PathVariable UUID projectId,
                                  @RequestParam(required = false) MappingStatus status,
                                  @RequestParam(required = false) String sourceEntity,
                                  Pageable pageable) {
        Page<FieldMappingEntry> page;
        if (status != null) {
            page = mappingRepository.findByProjectIdAndMappingStatus(projectId, status, pageable);
        } else if (sourceEntity != null) {
            page = mappingRepository.findByProjectIdAndSourceEntity(projectId, sourceEntity, pageable);
        } else {
            page = mappingRepository.findByProjectId(projectId, pageable);
        }
        return page.map(this::toDto);
    }

    @GetMapping("/export")
    public ResponseEntity<?> exportMappings(@PathVariable UUID projectId) {
        return projectRepository.findById(projectId)
                .map(project -> {
                    Map<String, Object> doc = importExportService.exportMappings(project);
                    String filename = project.getName().replaceAll("[^a-zA-Z0-9._-]", "_").toLowerCase()
                            + "-mappings.json";
                    return ResponseEntity.ok()
                            .header("Content-Disposition", "attachment; filename=\"" + filename + "\"")
                            .header("Content-Type", "application/json")
                            .body(doc);
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping("/import")
    @Transactional
    public ResponseEntity<?> importMappings(@PathVariable UUID projectId,
                                             @RequestParam("file") MultipartFile file,
                                             @AuthenticationPrincipal UserPrincipal principal) {
        if (file.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("message", "File is empty"));
        }
        return projectRepository.findById(projectId)
                .map(project -> {
                    try {
                        ObjectMapper mapper = new ObjectMapper();
                        @SuppressWarnings("unchecked")
                        Map<String, Object> importDoc = mapper.readValue(file.getInputStream(), Map.class);
                        var result = importExportService.importMappings(project, importDoc, principal);
                        return ResponseEntity.ok(Map.of(
                                "matched", result.matched(),
                                "updated", result.updated(),
                                "skippedNotFound", result.skippedNotFound(),
                                "skippedUnchanged", result.skippedUnchanged(),
                                "existingLeftUnmapped", result.existingLeftUnmapped(),
                                "warnings", result.warnings()));
                    } catch (IllegalArgumentException e) {
                        return ResponseEntity.badRequest().body(Map.of("message", e.getMessage()));
                    } catch (Exception e) {
                        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                                .body(Map.of("message", "Failed to process import: " + e.getMessage()));
                    }
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/{id}")
    public ResponseEntity<MappingDto> get(@PathVariable UUID projectId, @PathVariable UUID id) {
        return mappingRepository.findByIdWithCandidates(id)
                .map(m -> ResponseEntity.ok(toDto(m)))
                .orElse(ResponseEntity.notFound().build());
    }

    @PutMapping("/{id}")
    @Transactional
    public ResponseEntity<?> update(@PathVariable UUID projectId,
                                     @PathVariable UUID id,
                                     @RequestBody UpdateMappingRequest request,
                                     @AuthenticationPrincipal UserPrincipal principal) {
        return mappingRepository.findById(id)
                .map(mapping -> {
                    // Record changes before applying them
                    Map<String, String> changes = new LinkedHashMap<>();
                    if (principal.isPlatformUser()) {
                        if (request.targetEntity() != null) changes.put("targetEntity", request.targetEntity());
                        if (request.targetField() != null) changes.put("targetField", request.targetField());
                        if (request.coercion() != null) changes.put("coercion", request.coercion());
                        if (request.mappingStatus() != null) changes.put("mappingStatus", request.mappingStatus().name());
                    }
                    if (request.customerComment() != null) changes.put("customerComment", request.customerComment());
                    if (!changes.isEmpty()) {
                        versionService.recordChange(mapping, changes, "EDIT");
                    }

                    if (principal.isPlatformUser()) {
                        if (request.targetEntity() != null) mapping.setTargetEntity(request.targetEntity());
                        if (request.targetField() != null) mapping.setTargetField(request.targetField());
                        if (request.coercion() != null) mapping.setCoercion(request.coercion());
                        if (request.mappingStatus() != null) mapping.setMappingStatus(request.mappingStatus());
                    }
                    if (request.customerComment() != null) mapping.setCustomerComment(request.customerComment());
                    mappingRepository.save(mapping);
                    String fieldLabel = mapping.getSourceEntity() + "." + mapping.getSourceField();
                    auditService.log("UPDATE_MAPPING", "FieldMapping", mapping.getId(), fieldLabel);
                    if (principal.isPlatformUser()) {
                        UUID tenantId = mapping.getProject().getTenant().getId();
                        notificationService.notifyMappingUpdated(
                                tenantId, projectId, mapping.getId(), fieldLabel, principal.getFullName());
                    }
                    return ResponseEntity.ok(toDto(mapping));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping("/{id}/approve")
    @Transactional
    public ResponseEntity<?> approve(@PathVariable UUID projectId,
                                      @PathVariable UUID id,
                                      @AuthenticationPrincipal UserPrincipal principal) {
        return mappingRepository.findById(id)
                .map(mapping -> {
                    versionService.recordApproval(mapping);
                    mapping.setMappingStatus(MappingStatus.MAPPED);
                    mappingRepository.save(mapping);
                    String fieldLabel = mapping.getSourceEntity() + "." + mapping.getSourceField();
                    auditService.log("APPROVE_MAPPING", "FieldMapping", mapping.getId(), fieldLabel);
                    if (principal.isPlatformUser()) {
                        UUID tenantId = mapping.getProject().getTenant().getId();
                        notificationService.notifyMappingApproved(
                                tenantId, projectId, mapping.getId(), fieldLabel, principal.getFullName());
                    }
                    return ResponseEntity.ok(toDto(mapping));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/schema-tree")
    public List<SchemaNodeDto> schemaTree(@PathVariable UUID projectId) {
        List<SourceSchemaNode> roots = schemaNodeRepository.findByProjectIdAndParentIsNullOrderBySortOrder(projectId);
        return roots.stream().map(this::toSchemaNodeDto).toList();
    }

    @GetMapping("/stats")
    public MappingStatsDto stats(@PathVariable UUID projectId) {
        long all = mappingRepository.countByProjectIdAndMappingStatus(projectId, MappingStatus.MAPPED)
                + mappingRepository.countByProjectIdAndMappingStatus(projectId, MappingStatus.NEEDS_REVIEW)
                + mappingRepository.countByProjectIdAndMappingStatus(projectId, MappingStatus.CFV_PROPOSAL)
                + mappingRepository.countByProjectIdAndMappingStatus(projectId, MappingStatus.REJECTED)
                + mappingRepository.countByProjectIdAndMappingStatus(projectId, MappingStatus.UNMAPPED);
        return new MappingStatsDto(
                all,
                mappingRepository.countByProjectIdAndMappingStatus(projectId, MappingStatus.NEEDS_REVIEW),
                mappingRepository.countByProjectIdAndMappingStatus(projectId, MappingStatus.CFV_PROPOSAL),
                mappingRepository.countByProjectIdAndMappingStatus(projectId, MappingStatus.MAPPED),
                mappingRepository.countByProjectIdAndMappingStatus(projectId, MappingStatus.REJECTED),
                mappingRepository.countByProjectIdAndMappingStatus(projectId, MappingStatus.UNMAPPED)
        );
    }

    @GetMapping("/{mappingId}/change-history")
    public ResponseEntity<Map<String, Object>> fieldChangeHistory(
            @PathVariable UUID projectId,
            @PathVariable UUID mappingId,
            Pageable pageable) {
        return ResponseEntity.ok(versionService.getFieldHistory(mappingId, pageable));
    }

    @GetMapping("/target-schema")
    public ResponseEntity<Map<String, Object>> targetSchema(@PathVariable UUID projectId) {
        return ResponseEntity.ok(Map.of("targetSchema", targetSchemaService.getFlatFields()));
    }

    @PostMapping("/{id}/clone")
    @Transactional
    public ResponseEntity<?> cloneMapping(@PathVariable UUID projectId,
                                           @PathVariable UUID id,
                                           @RequestBody Map<String, String> body,
                                           @AuthenticationPrincipal UserPrincipal principal) {
        return mappingRepository.findById(id)
                .filter(m -> m.getProject().getId().equals(projectId))
                .map(source -> {
                    FieldMappingEntry clone = new FieldMappingEntry();
                    clone.setProject(source.getProject());
                    clone.setSourceEntity(source.getSourceEntity());
                    clone.setSourceField(source.getSourceField());
                    clone.setSampleValue(source.getSampleValue());
                    clone.setTargetField(body.get("targetField"));
                    clone.setTargetEntity(body.get("targetEntity"));
                    clone.setMappingStatus(MappingStatus.NEEDS_REVIEW);
                    clone = mappingRepository.save(clone);
                    String fieldLabel = clone.getSourceEntity() + "." + clone.getSourceField();
                    auditService.log("CLONE_MAPPING", "FieldMapping", clone.getId(), fieldLabel);
                    return ResponseEntity.ok(toDto(clone));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    // --- Entity Coverage ---

    public record EntityOverrideRequest(String entity, boolean active) {}

    @GetMapping("/entity-coverage")
    public ResponseEntity<?> getEntityCoverage(@PathVariable UUID projectId) {
        return projectRepository.findById(projectId)
                .map(project -> {
                    List<EntityCoverageEntry> coverage = project.getEntityCoverage();
                    return ResponseEntity.ok(coverage != null ? coverage : List.of());
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @PutMapping("/entity-coverage")
    @Transactional
    public ResponseEntity<?> updateEntityCoverage(@PathVariable UUID projectId,
                                                   @RequestBody List<EntityOverrideRequest> overrides,
                                                   @AuthenticationPrincipal UserPrincipal principal) {
        return projectRepository.findById(projectId)
                .map(project -> {
                    List<EntityCoverageEntry> coverage = project.getEntityCoverage();
                    if (coverage == null || coverage.isEmpty()) {
                        return ResponseEntity.badRequest()
                                .body(Map.of("message", "No entity coverage data available"));
                    }

                    Map<String, EntityCoverageEntry> byEntity = new LinkedHashMap<>();
                    for (EntityCoverageEntry e : coverage) {
                        byEntity.put(e.getEntity(), e);
                    }

                    for (EntityOverrideRequest ovr : overrides) {
                        EntityCoverageEntry entry = byEntity.get(ovr.entity());
                        if (entry != null) {
                            if (ovr.active() == entry.isDetected()) {
                                entry.setCoachOverride(null);
                            } else {
                                entry.setCoachOverride(ovr.active());
                            }
                        }
                    }

                    project.setEntityCoverage(new ArrayList<>(byEntity.values()));
                    projectRepository.save(project);

                    auditService.log("ENTITY_COVERAGE_OVERRIDE", "OnboardingProject", project.getId(),
                            overrides.size() + " entity overrides applied");

                    return ResponseEntity.ok(project.getEntityCoverage());
                })
                .orElse(ResponseEntity.notFound().build());
    }

    // --- Helpers ---

    private MappingDto toDto(FieldMappingEntry m) {
        List<CandidateDto> candidates = m.getCandidates() != null
                ? m.getCandidates().stream().map(this::toCandidateDto).toList()
                : List.of();
        return new MappingDto(
                m.getId(), m.getSourceEntity(), m.getSourceField(), m.getSampleValue(),
                m.getTargetEntity(), m.getTargetField(), m.getCoercion(),
                m.getConfidencePct(), m.getMappingStatus(),
                m.getOwnerId(), m.getCustomerComment(),
                candidates, m.getCreatedAt());
    }

    private CandidateDto toCandidateDto(MappingCandidate c) {
        return new CandidateDto(c.getId(), c.getTargetField(), c.getMatchPct(), c.getDescription());
    }

    private SchemaNodeDto toSchemaNodeDto(SourceSchemaNode node) {
        List<SchemaNodeDto> children = node.getChildren() != null
                ? node.getChildren().stream().map(this::toSchemaNodeDto).toList()
                : List.of();
        return new SchemaNodeDto(node.getId(), node.getNodeName(), node.getNodeType(), node.getRecordCount(), children);
    }
}
