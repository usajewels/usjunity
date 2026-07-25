package com.mxsuite.service;

import com.mxsuite.model.FieldMappingEntry;
import com.mxsuite.model.MappingVersion;
import com.mxsuite.model.Project;
import com.mxsuite.model.enums.MappingStatus;
import com.mxsuite.repository.FieldMappingEntryRepository;
import com.mxsuite.repository.MappingVersionRepository;
import com.mxsuite.security.UserPrincipal;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.*;

@Service
public class MappingImportExportService {

    private static final Logger log = LoggerFactory.getLogger(MappingImportExportService.class);
    private static final int FORMAT_VERSION = 1;

    private final FieldMappingEntryRepository mappingRepository;
    private final MappingVersionService versionService;
    private final MappingVersionRepository versionRepository;

    public MappingImportExportService(FieldMappingEntryRepository mappingRepository,
                                       MappingVersionService versionService,
                                       MappingVersionRepository versionRepository) {
        this.mappingRepository = mappingRepository;
        this.versionService = versionService;
        this.versionRepository = versionRepository;
    }

    // ---- DTOs ----

    public record ImportResult(
            int matched, int updated, int skippedNotFound,
            int skippedUnchanged, int existingLeftUnmapped,
            List<String> warnings
    ) {}

    // ---- Export ----

    public Map<String, Object> exportMappings(Project project) {
        List<FieldMappingEntry> all = mappingRepository.findAllByProjectId(project.getId());

        // Compute stats
        long mapped = 0, needsReview = 0, unmapped = 0, rejected = 0;
        for (FieldMappingEntry m : all) {
            switch (m.getMappingStatus()) {
                case MAPPED -> mapped++;
                case NEEDS_REVIEW, CFV_PROPOSAL -> needsReview++;
                case UNMAPPED -> unmapped++;
                case REJECTED -> rejected++;
            }
        }

        // Build portable mapping entries (no project-specific IDs)
        List<Map<String, Object>> mappingList = new ArrayList<>();
        for (FieldMappingEntry m : all) {
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("sourceEntity", m.getSourceEntity());
            entry.put("sourceField", m.getSourceField());
            entry.put("targetEntity", m.getTargetEntity());
            entry.put("targetField", m.getTargetField());
            entry.put("coercion", m.getCoercion());
            entry.put("mappingStatus", m.getMappingStatus().name());
            entry.put("customerComment", m.getCustomerComment());
            mappingList.add(entry);
        }

        Map<String, Object> doc = new LinkedHashMap<>();
        doc.put("mxsuite", Map.of("format", "field-mappings", "version", FORMAT_VERSION));

        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("exportedAt", Instant.now().toString());
        metadata.put("projectName", project.getName());
        metadata.put("sourceSystem", project.getSourceSystem());
        metadata.put("targetSystem", project.getTargetSystem());
        metadata.put("totalMappings", all.size());
        metadata.put("stats", Map.of(
                "mapped", mapped, "needsReview", needsReview,
                "unmapped", unmapped, "rejected", rejected));
        doc.put("metadata", metadata);
        doc.put("mappings", mappingList);

        log.info("Exported {} mappings for project {}", all.size(), project.getId());
        return doc;
    }

    // ---- Import ----

    @Transactional
    public ImportResult importMappings(Project project, Map<String, Object> importDoc,
                                        UserPrincipal principal) {
        // 1. Validate format
        validateFormat(importDoc);

        UUID projectId = project.getId();

        // 2. Close any open version, then create IMPORT version with pre-change snapshot
        closeOpenVersion(projectId, principal);
        MappingVersion importVersion = createImportVersion(project, principal);
        versionService.captureSnapshot(importVersion);

        // 3. Index existing mappings by sourceEntity|sourceField (case-insensitive)
        List<FieldMappingEntry> existingMappings = mappingRepository.findAllByProjectId(projectId);
        Map<String, FieldMappingEntry> existingByKey = new LinkedHashMap<>();
        for (FieldMappingEntry m : existingMappings) {
            String key = (m.getSourceEntity() + "|" + m.getSourceField()).toLowerCase();
            existingByKey.putIfAbsent(key, m);  // first match wins (for cloned entries)
        }

        // 4. Process each imported mapping
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> importedMappings = (List<Map<String, Object>>) importDoc.get("mappings");

        int matched = 0, updated = 0, skippedNotFound = 0, skippedUnchanged = 0;
        List<String> warnings = new ArrayList<>();
        Set<String> touchedKeys = new HashSet<>();

        for (Map<String, Object> imported : importedMappings) {
            String srcEntity = (String) imported.get("sourceEntity");
            String srcField = (String) imported.get("sourceField");
            if (srcEntity == null || srcField == null) continue;

            String key = (srcEntity + "|" + srcField).toLowerCase();
            FieldMappingEntry mapping = existingByKey.get(key);

            if (mapping == null) {
                skippedNotFound++;
                warnings.add("Source field not found: " + srcEntity + "." + srcField);
                continue;
            }

            matched++;
            touchedKeys.add(key);

            String newTargetEntity = (String) imported.get("targetEntity");
            String newTargetField = (String) imported.get("targetField");
            String newCoercion = (String) imported.get("coercion");
            String newStatusStr = (String) imported.get("mappingStatus");
            String newComment = (String) imported.get("customerComment");
            MappingStatus newStatus = newStatusStr != null
                    ? MappingStatus.valueOf(newStatusStr) : MappingStatus.UNMAPPED;

            // Check if anything actually changed
            boolean changed = !Objects.equals(mapping.getTargetEntity(), newTargetEntity)
                    || !Objects.equals(mapping.getTargetField(), newTargetField)
                    || !Objects.equals(mapping.getCoercion(), newCoercion)
                    || mapping.getMappingStatus() != newStatus
                    || !Objects.equals(mapping.getCustomerComment(), newComment);

            if (!changed) {
                skippedUnchanged++;
                continue;
            }

            // Record version changes BEFORE applying
            Map<String, String> changes = new LinkedHashMap<>();
            changes.put("targetEntity", newTargetEntity);
            changes.put("targetField", newTargetField);
            changes.put("coercion", newCoercion);
            changes.put("mappingStatus", newStatus.name());
            changes.put("customerComment", newComment);
            versionService.recordChange(mapping, changes, "IMPORT");

            // Apply changes
            mapping.setTargetEntity(newTargetEntity);
            mapping.setTargetField(newTargetField);
            mapping.setCoercion(newCoercion);
            mapping.setMappingStatus(newStatus);
            mapping.setCustomerComment(newComment);
            updated++;
        }

        // 5. Count existing fields not in import (left unchanged)
        int existingLeftUnmapped = 0;
        for (String key : existingByKey.keySet()) {
            if (!touchedKeys.contains(key)) existingLeftUnmapped++;
        }

        // 6. Save all
        mappingRepository.saveAll(existingMappings);

        // 7. Close the import version
        importVersion.setDescription("Imported " + updated + " mapping(s)"
                + (skippedNotFound > 0 ? ", " + skippedNotFound + " skipped (not found)" : ""));
        importVersion.setChangeCount(importVersion.getChanges() != null ? importVersion.getChanges().size() : updated);
        importVersion.setClosedAt(Instant.now());
        versionRepository.save(importVersion);

        log.info("Import complete for project {}: matched={}, updated={}, skippedNotFound={}, unchanged={}",
                projectId, matched, updated, skippedNotFound, skippedUnchanged);

        return new ImportResult(matched, updated, skippedNotFound,
                skippedUnchanged, existingLeftUnmapped, warnings);
    }

    // ---- Internal ----

    private void validateFormat(Map<String, Object> doc) {
        @SuppressWarnings("unchecked")
        Map<String, Object> header = (Map<String, Object>) doc.get("mxsuite");
        if (header == null || !"field-mappings".equals(header.get("format"))) {
            throw new IllegalArgumentException(
                    "Invalid file format. Expected an MXSuite field-mappings export file.");
        }
        Object versionObj = header.get("version");
        int version = versionObj instanceof Number n ? n.intValue() : 0;
        if (version < 1 || version > FORMAT_VERSION) {
            throw new IllegalArgumentException(
                    "Unsupported format version: " + version + ". This system supports version " + FORMAT_VERSION + ".");
        }
        if (doc.get("mappings") == null) {
            throw new IllegalArgumentException("File contains no mappings array.");
        }
    }

    private MappingVersion createImportVersion(Project project, UserPrincipal principal) {
        int nextNum = versionRepository.findMaxVersionNumber(project.getId()) + 1;
        MappingVersion version = new MappingVersion();
        version.setProject(project);
        version.setVersionNumber(nextNum);
        version.setSource("IMPORT");
        version.setCreatedBy(principal.id());
        version.setCreatedByName(principal.getFullName());
        version.setLabel("Import");
        return versionRepository.save(version);
    }

    private void closeOpenVersion(UUID projectId, UserPrincipal principal) {
        versionRepository.findOpenVersionForUser(projectId, principal.id()).ifPresent(v -> {
            v.setClosedAt(Instant.now());
            versionService.captureSnapshot(v);
            versionRepository.save(v);
        });
    }
}
