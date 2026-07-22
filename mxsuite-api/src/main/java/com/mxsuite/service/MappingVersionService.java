package com.mxsuite.service;

import com.mxsuite.model.*;
import com.mxsuite.model.enums.MappingStatus;
import com.mxsuite.repository.FieldMappingEntryRepository;
import com.mxsuite.repository.MappingVersionRepository;
import com.mxsuite.security.UserPrincipal;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.*;

@Service
public class MappingVersionService {

    private static final Logger log = LoggerFactory.getLogger(MappingVersionService.class);
    private static final Duration SESSION_GAP = Duration.ofMinutes(30);

    private final MappingVersionRepository versionRepository;
    private final FieldMappingEntryRepository mappingRepository;

    public MappingVersionService(MappingVersionRepository versionRepository,
                                  FieldMappingEntryRepository mappingRepository) {
        this.versionRepository = versionRepository;
        this.mappingRepository = mappingRepository;
    }

    // ---- Change tracking (called before save) ----

    /**
     * Record changes to a mapping. Call this BEFORE persisting the new values.
     * Pass the current (old) entity state and a map of the new values being applied.
     */
    @Transactional
    public void recordChange(FieldMappingEntry mapping, Map<String, String> newValues, String source) {
        UserPrincipal principal = getCurrentPrincipal();
        if (principal == null) {
            log.warn("Cannot record mapping version change — no authenticated principal");
            return;
        }

        UUID projectId = mapping.getProject().getId();
        MappingVersion version = getOrCreateVersion(projectId, mapping.getProject(), principal, source);

        for (Map.Entry<String, String> entry : newValues.entrySet()) {
            String fieldName = entry.getKey();
            String newValue = entry.getValue();
            String oldValue = getFieldValue(mapping, fieldName);

            // Skip if value hasn't actually changed
            if (Objects.equals(oldValue, newValue)) continue;

            MappingVersionChange change = new MappingVersionChange();
            change.setMappingVersion(version);
            change.setFieldMappingId(mapping.getId());
            change.setChangeType(resolveChangeType(fieldName, newValue));
            change.setFieldName(fieldName);
            change.setOldValue(oldValue);
            change.setNewValue(newValue);
            change.setSourceEntity(mapping.getSourceEntity());
            change.setSourceField(mapping.getSourceField());
            version.getChanges().add(change);
        }

        version.setChangeCount(version.getChanges().size());
        version.setDescription(buildDescription(version));
        versionRepository.save(version);
    }

    /**
     * Convenience for recording an approval.
     */
    @Transactional
    public void recordApproval(FieldMappingEntry mapping) {
        recordChange(mapping,
                Map.of("mappingStatus", MappingStatus.MAPPED.name()),
                "EDIT");
    }

    // ---- Snapshot capture ----

    /**
     * Capture a full snapshot of all mappings for a project and attach to the given version.
     */
    @Transactional
    public void captureSnapshot(MappingVersion version) {
        UUID projectId = version.getProject().getId();
        List<FieldMappingEntry> all = mappingRepository.findAllByProjectId(projectId);

        List<Map<String, Object>> snapshot = new ArrayList<>();
        for (FieldMappingEntry m : all) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", m.getId().toString());
            row.put("sourceEntity", m.getSourceEntity());
            row.put("sourceField", m.getSourceField());
            row.put("sampleValue", m.getSampleValue());
            row.put("targetEntity", m.getTargetEntity());
            row.put("targetField", m.getTargetField());
            row.put("coercion", m.getCoercion());
            row.put("confidencePct", m.getConfidencePct() != null ? m.getConfidencePct().toString() : null);
            row.put("mappingStatus", m.getMappingStatus().name());
            row.put("customerComment", m.getCustomerComment());
            snapshot.add(row);
        }
        version.setSnapshot(snapshot);
        versionRepository.save(version);
    }

    // ---- Rollback ----

    /**
     * Rollback all mappings to the state captured in the given version's snapshot.
     * Creates a new version of source=ROLLBACK documenting what changed.
     */
    @Transactional
    public MappingVersion rollback(UUID projectId, int targetVersionNumber) {
        UserPrincipal principal = getCurrentPrincipal();
        if (principal == null) throw new IllegalStateException("No authenticated principal");

        MappingVersion targetVersion = versionRepository
                .findByProjectIdAndVersionNumber(projectId, targetVersionNumber)
                .orElseThrow(() -> new IllegalArgumentException("Version " + targetVersionNumber + " not found"));

        if (targetVersion.getSnapshot() == null || targetVersion.getSnapshot().isEmpty()) {
            throw new IllegalStateException("Version " + targetVersionNumber + " has no snapshot to restore from");
        }

        // Close any open version first
        closeOpenVersion(projectId, principal.id());

        // Create rollback version
        Project project = targetVersion.getProject();
        int nextNum = versionRepository.findMaxVersionNumber(projectId) + 1;
        MappingVersion rollbackVersion = new MappingVersion();
        rollbackVersion.setProject(project);
        rollbackVersion.setVersionNumber(nextNum);
        rollbackVersion.setSource("ROLLBACK");
        rollbackVersion.setCreatedBy(principal.id());
        rollbackVersion.setCreatedByName(principal.getFullName());
        rollbackVersion.setDescription("Rollback to version " + targetVersionNumber);

        // Build a lookup of snapshot state by mapping ID
        Map<String, Map<String, Object>> snapshotById = new HashMap<>();
        for (Map<String, Object> row : targetVersion.getSnapshot()) {
            snapshotById.put((String) row.get("id"), row);
        }

        // Apply snapshot state to current mappings and record changes
        List<FieldMappingEntry> currentMappings = mappingRepository.findAllByProjectId(projectId);
        for (FieldMappingEntry mapping : currentMappings) {
            Map<String, Object> snapRow = snapshotById.get(mapping.getId().toString());
            if (snapRow == null) continue;

            // Compare and record changes
            applySnapshotRow(mapping, snapRow, rollbackVersion);
        }

        rollbackVersion.setChangeCount(rollbackVersion.getChanges().size());
        rollbackVersion.setClosedAt(Instant.now());

        // Capture snapshot of the new state
        versionRepository.save(rollbackVersion);
        mappingRepository.saveAll(currentMappings);
        captureSnapshot(rollbackVersion);

        log.info("Rolled back project {} to version {}, created version {}", projectId, targetVersionNumber, nextNum);
        return rollbackVersion;
    }

    // ---- Query ----

    public Page<MappingVersion> listVersions(UUID projectId, Pageable pageable) {
        return versionRepository.findByProjectIdOrderByVersionNumberDesc(projectId, pageable);
    }

    public Page<MappingVersion> listVersions(UUID projectId, String search, Pageable pageable) {
        if (search != null && !search.isBlank()) {
            return versionRepository.searchVersions(projectId, search.trim(), pageable);
        }
        return versionRepository.findByProjectIdOrderByVersionNumberDesc(projectId, pageable);
    }

    /**
     * Get the paginated change history for a single field mapping, across all versions.
     */
    public Map<String, Object> getFieldHistory(UUID fieldMappingId, Pageable pageable) {
        Page<MappingVersionChange> page = versionRepository.findChangesByFieldMappingId(fieldMappingId, pageable);
        List<Map<String, Object>> content = new ArrayList<>();
        for (MappingVersionChange c : page.getContent()) {
            MappingVersion v = c.getMappingVersion();
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", c.getId().toString());
            row.put("changeType", c.getChangeType());
            row.put("fieldName", c.getFieldName());
            row.put("oldValue", c.getOldValue());
            row.put("newValue", c.getNewValue());
            row.put("createdAt", c.getCreatedAt().toString());
            row.put("versionNumber", v.getVersionNumber());
            row.put("source", v.getSource());
            row.put("createdByName", v.getCreatedByName());
            content.add(row);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("content", content);
        result.put("totalElements", page.getTotalElements());
        result.put("totalPages", page.getTotalPages());
        result.put("page", page.getNumber());
        return result;
    }

    public Optional<MappingVersion> getVersionWithChanges(UUID versionId) {
        return versionRepository.findByIdWithChanges(versionId);
    }

    public Optional<MappingVersion> getVersionByNumber(UUID projectId, int versionNumber) {
        return versionRepository.findByProjectIdAndVersionNumber(projectId, versionNumber);
    }

    /**
     * Compare two versions and return the changes between them.
     */
    public List<Map<String, Object>> compareVersions(UUID projectId, int fromVersion, int toVersion) {
        MappingVersion from = versionRepository.findByProjectIdAndVersionNumber(projectId, fromVersion)
                .orElseThrow(() -> new IllegalArgumentException("Version " + fromVersion + " not found"));
        MappingVersion to = versionRepository.findByProjectIdAndVersionNumber(projectId, toVersion)
                .orElseThrow(() -> new IllegalArgumentException("Version " + toVersion + " not found"));

        if (from.getSnapshot() == null || to.getSnapshot() == null) {
            throw new IllegalStateException("Both versions must have snapshots for comparison");
        }

        // Build lookup by mapping ID
        Map<String, Map<String, Object>> fromById = new HashMap<>();
        for (Map<String, Object> row : from.getSnapshot()) {
            fromById.put((String) row.get("id"), row);
        }

        List<Map<String, Object>> diffs = new ArrayList<>();
        for (Map<String, Object> toRow : to.getSnapshot()) {
            String id = (String) toRow.get("id");
            Map<String, Object> fromRow = fromById.get(id);

            List<Map<String, String>> fieldDiffs = new ArrayList<>();
            String[] fieldsToCompare = {"targetEntity", "targetField", "coercion", "mappingStatus", "customerComment"};

            for (String field : fieldsToCompare) {
                String fromVal = fromRow != null ? Objects.toString(fromRow.get(field), null) : null;
                String toVal = Objects.toString(toRow.get(field), null);
                if (!Objects.equals(fromVal, toVal)) {
                    fieldDiffs.add(Map.of(
                            "field", field,
                            "from", fromVal != null ? fromVal : "",
                            "to", toVal != null ? toVal : ""
                    ));
                }
            }

            if (!fieldDiffs.isEmpty()) {
                Map<String, Object> diff = new LinkedHashMap<>();
                diff.put("mappingId", id);
                diff.put("sourceEntity", toRow.get("sourceEntity"));
                diff.put("sourceField", toRow.get("sourceField"));
                diff.put("changes", fieldDiffs);
                diffs.add(diff);
            }
        }

        return diffs;
    }

    /**
     * Update the label on a version.
     */
    @Transactional
    public MappingVersion updateLabel(UUID versionId, String label) {
        MappingVersion version = versionRepository.findById(versionId)
                .orElseThrow(() -> new IllegalArgumentException("Version not found"));
        version.setLabel(label);
        return versionRepository.save(version);
    }

    // ---- Internal helpers ----

    private MappingVersion getOrCreateVersion(UUID projectId, Project project, UserPrincipal principal, String source) {
        // Check for an open version by this user
        Optional<MappingVersion> existing = versionRepository.findOpenVersionForUser(projectId, principal.id());

        if (existing.isPresent()) {
            MappingVersion v = existing.get();
            // Check if session is still within the gap window
            Instant lastActivity = v.getChanges().isEmpty() ? v.getCreatedAt()
                    : v.getChanges().get(v.getChanges().size() - 1).getCreatedAt();
            if (Duration.between(lastActivity, Instant.now()).compareTo(SESSION_GAP) <= 0) {
                return v;
            }
            // Session expired — close it and capture snapshot
            v.setClosedAt(Instant.now());
            captureSnapshot(v);
            versionRepository.save(v);
        }

        // Create new version
        int nextNum = versionRepository.findMaxVersionNumber(projectId) + 1;
        MappingVersion version = new MappingVersion();
        version.setProject(project);
        version.setVersionNumber(nextNum);
        version.setSource(source);
        version.setCreatedBy(principal.id());
        version.setCreatedByName(principal.getFullName());
        return versionRepository.save(version);
    }

    private void closeOpenVersion(UUID projectId, UUID userId) {
        versionRepository.findOpenVersionForUser(projectId, userId).ifPresent(v -> {
            v.setClosedAt(Instant.now());
            captureSnapshot(v);
            versionRepository.save(v);
        });
    }

    private String getFieldValue(FieldMappingEntry mapping, String fieldName) {
        return switch (fieldName) {
            case "targetEntity" -> mapping.getTargetEntity();
            case "targetField" -> mapping.getTargetField();
            case "coercion" -> mapping.getCoercion();
            case "mappingStatus" -> mapping.getMappingStatus() != null ? mapping.getMappingStatus().name() : null;
            case "customerComment" -> mapping.getCustomerComment();
            default -> null;
        };
    }

    private String resolveChangeType(String fieldName, String newValue) {
        return switch (fieldName) {
            case "targetEntity", "targetField" -> "TARGET_CHANGED";
            case "coercion" -> "COERCION_CHANGED";
            case "customerComment" -> "COMMENT_CHANGED";
            case "mappingStatus" -> {
                if ("MAPPED".equals(newValue)) yield "APPROVED";
                if ("REJECTED".equals(newValue)) yield "SKIPPED";
                if ("UNMAPPED".equals(newValue) || "NEEDS_REVIEW".equals(newValue)) yield "RESTORED";
                yield "STATUS_CHANGED";
            }
            default -> "STATUS_CHANGED";
        };
    }

    private String buildDescription(MappingVersion version) {
        int count = version.getChangeCount();
        if (count == 0) return "No changes";

        // Count by type
        Map<String, Integer> typeCounts = new HashMap<>();
        for (MappingVersionChange c : version.getChanges()) {
            typeCounts.merge(c.getChangeType(), 1, Integer::sum);
        }

        List<String> parts = new ArrayList<>();
        if (typeCounts.containsKey("TARGET_CHANGED"))
            parts.add(typeCounts.get("TARGET_CHANGED") + " mapping" + (typeCounts.get("TARGET_CHANGED") > 1 ? "s" : "") + " updated");
        if (typeCounts.containsKey("APPROVED"))
            parts.add(typeCounts.get("APPROVED") + " approved");
        if (typeCounts.containsKey("SKIPPED"))
            parts.add(typeCounts.get("SKIPPED") + " skipped");
        if (typeCounts.containsKey("COMMENT_CHANGED"))
            parts.add(typeCounts.get("COMMENT_CHANGED") + " comment" + (typeCounts.get("COMMENT_CHANGED") > 1 ? "s" : ""));
        if (typeCounts.containsKey("COERCION_CHANGED"))
            parts.add(typeCounts.get("COERCION_CHANGED") + " coercion" + (typeCounts.get("COERCION_CHANGED") > 1 ? "s" : "") + " changed");
        if (typeCounts.containsKey("RESTORED"))
            parts.add(typeCounts.get("RESTORED") + " restored");

        return parts.isEmpty() ? count + " changes" : String.join(", ", parts);
    }

    private void applySnapshotRow(FieldMappingEntry mapping, Map<String, Object> snapRow,
                                   MappingVersion rollbackVersion) {
        String[] fields = {"targetEntity", "targetField", "coercion", "mappingStatus", "customerComment"};

        for (String field : fields) {
            String snapVal = Objects.toString(snapRow.get(field), null);
            String currentVal = getFieldValue(mapping, field);

            if (!Objects.equals(currentVal, snapVal)) {
                MappingVersionChange change = new MappingVersionChange();
                change.setMappingVersion(rollbackVersion);
                change.setFieldMappingId(mapping.getId());
                change.setChangeType("RESTORED");
                change.setFieldName(field);
                change.setOldValue(currentVal);
                change.setNewValue(snapVal);
                change.setSourceEntity(mapping.getSourceEntity());
                change.setSourceField(mapping.getSourceField());
                rollbackVersion.getChanges().add(change);

                // Apply the value
                switch (field) {
                    case "targetEntity" -> mapping.setTargetEntity(snapVal);
                    case "targetField" -> mapping.setTargetField(snapVal);
                    case "coercion" -> mapping.setCoercion(snapVal);
                    case "mappingStatus" -> mapping.setMappingStatus(
                            snapVal != null ? MappingStatus.valueOf(snapVal) : MappingStatus.UNMAPPED);
                    case "customerComment" -> mapping.setCustomerComment(snapVal);
                }
            }
        }
    }

    private UserPrincipal getCurrentPrincipal() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof UserPrincipal principal) {
            return principal;
        }
        return null;
    }
}
