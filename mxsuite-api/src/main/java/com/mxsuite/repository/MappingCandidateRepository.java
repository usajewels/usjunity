package com.mxsuite.repository;

import com.mxsuite.model.MappingCandidate;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface MappingCandidateRepository extends JpaRepository<MappingCandidate, UUID> {
    List<MappingCandidate> findByFieldMappingIdOrderBySortOrder(UUID fieldMappingId);
}
