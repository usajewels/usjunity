package com.mxsuite.repository;

import com.mxsuite.model.MappingVersion;
import com.mxsuite.model.MappingVersionChange;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface MappingVersionRepository extends JpaRepository<MappingVersion, UUID> {

    Page<MappingVersion> findByProjectIdOrderByVersionNumberDesc(UUID projectId, Pageable pageable);

    @Query("SELECT COALESCE(MAX(v.versionNumber), 0) FROM MappingVersion v WHERE v.project.id = :projectId")
    int findMaxVersionNumber(@Param("projectId") UUID projectId);

    /**
     * Find the latest open version for a given project and user (for session grouping).
     * A version is "open" if closedAt is null.
     */
    @Query("SELECT v FROM MappingVersion v WHERE v.project.id = :projectId " +
           "AND v.createdBy = :userId AND v.closedAt IS NULL " +
           "ORDER BY v.createdAt DESC LIMIT 1")
    Optional<MappingVersion> findOpenVersionForUser(@Param("projectId") UUID projectId,
                                                     @Param("userId") UUID userId);

    Optional<MappingVersion> findByProjectIdAndVersionNumber(UUID projectId, int versionNumber);

    @Query("SELECT v FROM MappingVersion v LEFT JOIN FETCH v.changes WHERE v.id = :id")
    Optional<MappingVersion> findByIdWithChanges(@Param("id") UUID id);

    /**
     * Search versions whose changes match the given term (by source field, source entity, or description).
     */
    @Query("SELECT DISTINCT v FROM MappingVersion v LEFT JOIN v.changes c " +
           "WHERE v.project.id = :projectId " +
           "AND (LOWER(c.sourceField) LIKE LOWER(CONCAT('%', :term, '%')) " +
           "  OR LOWER(c.sourceEntity) LIKE LOWER(CONCAT('%', :term, '%')) " +
           "  OR LOWER(v.description) LIKE LOWER(CONCAT('%', :term, '%')) " +
           "  OR LOWER(v.createdByName) LIKE LOWER(CONCAT('%', :term, '%'))) " +
           "ORDER BY v.versionNumber DESC")
    Page<MappingVersion> searchVersions(@Param("projectId") UUID projectId,
                                         @Param("term") String term,
                                         Pageable pageable);

    /**
     * Find all changes for a specific field mapping across all versions, newest first.
     * Returns change rows joined with their parent version for context.
     */
    @Query("SELECT c FROM MappingVersionChange c " +
           "JOIN FETCH c.mappingVersion v " +
           "WHERE c.fieldMappingId = :fieldMappingId " +
           "ORDER BY c.createdAt DESC")
    Page<MappingVersionChange> findChangesByFieldMappingId(@Param("fieldMappingId") UUID fieldMappingId,
                                                            Pageable pageable);
}
