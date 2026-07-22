package com.mxsuite.repository;

import com.mxsuite.model.SemanticDecision;
import com.mxsuite.model.enums.DecisionStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface SemanticDecisionRepository extends JpaRepository<SemanticDecision, UUID> {

    Page<SemanticDecision> findByTenantId(UUID tenantId, Pageable pageable);

    Page<SemanticDecision> findByTenantIdAndDecisionStatus(UUID tenantId, DecisionStatus status, Pageable pageable);

    long countByTenantIdAndDecisionStatus(UUID tenantId, DecisionStatus status);

    Page<SemanticDecision> findByProjectId(UUID projectId, Pageable pageable);

    long countByProjectIdAndDecisionStatus(UUID projectId, DecisionStatus status);
}
