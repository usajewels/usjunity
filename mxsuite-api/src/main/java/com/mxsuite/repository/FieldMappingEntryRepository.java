package com.mxsuite.repository;

import com.mxsuite.model.FieldMappingEntry;
import com.mxsuite.model.enums.MappingStatus;
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
public interface FieldMappingEntryRepository extends JpaRepository<FieldMappingEntry, UUID> {

    Page<FieldMappingEntry> findByProjectId(UUID projectId, Pageable pageable);

    Page<FieldMappingEntry> findByProjectIdAndMappingStatus(UUID projectId, MappingStatus status, Pageable pageable);

    Page<FieldMappingEntry> findByProjectIdAndSourceEntity(UUID projectId, String sourceEntity, Pageable pageable);

    @Query("SELECT f FROM FieldMappingEntry f LEFT JOIN FETCH f.candidates WHERE f.id = :id")
    Optional<FieldMappingEntry> findByIdWithCandidates(@Param("id") UUID id);

    long countByProjectIdAndMappingStatus(UUID projectId, MappingStatus status);

    List<FieldMappingEntry> findAllByProjectId(UUID projectId);

    void deleteByProjectId(UUID projectId);
}
