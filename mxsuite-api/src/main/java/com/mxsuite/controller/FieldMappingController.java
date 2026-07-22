package com.mxsuite.controller;

import com.mxsuite.audit.AuditService;
import com.mxsuite.model.FieldMappingEntry;
import com.mxsuite.model.MappingCandidate;
import com.mxsuite.model.SourceSchemaNode;
import com.mxsuite.model.enums.MappingStatus;
import com.mxsuite.repository.FieldMappingEntryRepository;
import com.mxsuite.repository.SourceSchemaNodeRepository;
import com.mxsuite.security.UserPrincipal;
import com.mxsuite.service.MappingVersionService;
import com.mxsuite.service.NotificationService;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;

@RestController
@RequestMapping("/api/projects/{projectId}/mappings")
@Transactional(readOnly = true)
public class FieldMappingController {

    private final FieldMappingEntryRepository mappingRepository;
    private final SourceSchemaNodeRepository schemaNodeRepository;
    private final AuditService auditService;
    private final NotificationService notificationService;
    private final MappingVersionService versionService;

    public FieldMappingController(FieldMappingEntryRepository mappingRepository,
                                   SourceSchemaNodeRepository schemaNodeRepository,
                                   AuditService auditService,
                                   NotificationService notificationService,
                                   MappingVersionService versionService) {
        this.mappingRepository = mappingRepository;
        this.schemaNodeRepository = schemaNodeRepository;
        this.auditService = auditService;
        this.notificationService = notificationService;
        this.versionService = versionService;
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
