package com.mxsuite.controller;

import com.mxsuite.model.MappingVersion;
import com.mxsuite.model.MappingVersionChange;
import com.mxsuite.service.MappingVersionService;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/projects/{projectId}/versions")
@Transactional(readOnly = true)
public class MappingVersionController {

    private final MappingVersionService versionService;

    public MappingVersionController(MappingVersionService versionService) {
        this.versionService = versionService;
    }

    // --- DTOs ---

    public record VersionDto(
            UUID id, int versionNumber, int changeCount, String label,
            String description, String source, UUID createdBy,
            String createdByName, Instant createdAt, Instant closedAt) {}

    public record VersionDetailDto(
            UUID id, int versionNumber, int changeCount, String label,
            String description, String source, UUID createdBy,
            String createdByName, Instant createdAt, Instant closedAt,
            List<ChangeDto> changes) {}

    public record ChangeDto(
            UUID id, UUID fieldMappingId, String changeType, String fieldName,
            String oldValue, String newValue, String sourceEntity,
            String sourceField, Instant createdAt) {}

    public record UpdateLabelRequest(String label) {}

    public record RollbackRequest(int targetVersion) {}

    // --- Endpoints ---

    @GetMapping
    public Page<VersionDto> list(@PathVariable UUID projectId,
                                  @RequestParam(required = false) String search,
                                  Pageable pageable) {
        return versionService.listVersions(projectId, search, pageable).map(this::toDto);
    }

    @GetMapping("/{versionId}")
    public ResponseEntity<VersionDetailDto> get(@PathVariable UUID projectId,
                                                 @PathVariable UUID versionId) {
        return versionService.getVersionWithChanges(versionId)
                .map(v -> ResponseEntity.ok(toDetailDto(v)))
                .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/compare")
    public ResponseEntity<List<Map<String, Object>>> compare(
            @PathVariable UUID projectId,
            @RequestParam int from,
            @RequestParam int to) {
        List<Map<String, Object>> diffs = versionService.compareVersions(projectId, from, to);
        return ResponseEntity.ok(diffs);
    }

    @PutMapping("/{versionId}/label")
    @Transactional
    public ResponseEntity<VersionDto> updateLabel(@PathVariable UUID projectId,
                                                   @PathVariable UUID versionId,
                                                   @RequestBody UpdateLabelRequest request) {
        MappingVersion updated = versionService.updateLabel(versionId, request.label());
        return ResponseEntity.ok(toDto(updated));
    }

    @PostMapping("/rollback")
    @Transactional
    public ResponseEntity<VersionDto> rollback(@PathVariable UUID projectId,
                                                @RequestBody RollbackRequest request) {
        MappingVersion rollbackVersion = versionService.rollback(projectId, request.targetVersion());
        return ResponseEntity.ok(toDto(rollbackVersion));
    }


    // --- Helpers ---

    private VersionDto toDto(MappingVersion v) {
        return new VersionDto(v.getId(), v.getVersionNumber(), v.getChangeCount(),
                v.getLabel(), v.getDescription(), v.getSource(),
                v.getCreatedBy(), v.getCreatedByName(),
                v.getCreatedAt(), v.getClosedAt());
    }

    private VersionDetailDto toDetailDto(MappingVersion v) {
        List<ChangeDto> changes = v.getChanges() != null
                ? v.getChanges().stream().map(this::toChangeDto).toList()
                : List.of();
        return new VersionDetailDto(v.getId(), v.getVersionNumber(), v.getChangeCount(),
                v.getLabel(), v.getDescription(), v.getSource(),
                v.getCreatedBy(), v.getCreatedByName(),
                v.getCreatedAt(), v.getClosedAt(), changes);
    }

    private ChangeDto toChangeDto(MappingVersionChange c) {
        return new ChangeDto(c.getId(), c.getFieldMappingId(), c.getChangeType(),
                c.getFieldName(), c.getOldValue(), c.getNewValue(),
                c.getSourceEntity(), c.getSourceField(), c.getCreatedAt());
    }
}
