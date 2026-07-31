package com.mxsuite.repository;

import com.mxsuite.model.SemanticDecision;
import com.mxsuite.model.enums.DecisionSource;
import com.mxsuite.model.enums.DecisionStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface SemanticDecisionRepository extends JpaRepository<SemanticDecision, UUID> {

    Page<SemanticDecision> findByTenantId(UUID tenantId, Pageable pageable);

    Page<SemanticDecision> findByTenantIdAndDecisionStatus(UUID tenantId, DecisionStatus status, Pageable pageable);

    long countByTenantIdAndDecisionStatus(UUID tenantId, DecisionStatus status);

    long countByDecisionStatus(DecisionStatus status);

    Page<SemanticDecision> findByProjectId(UUID projectId, Pageable pageable);

    long countByProjectIdAndDecisionStatus(UUID projectId, DecisionStatus status);

    long countByProjectIdAndSource(UUID projectId, DecisionSource source);

    @Modifying
    @Query("DELETE FROM SemanticDecision d WHERE d.project.id = :projectId AND d.source = :source AND d.decisionStatus = :status")
    int deleteByProjectIdAndSourceAndDecisionStatus(
            @Param("projectId") UUID projectId,
            @Param("source") DecisionSource source,
            @Param("status") DecisionStatus status);
}
