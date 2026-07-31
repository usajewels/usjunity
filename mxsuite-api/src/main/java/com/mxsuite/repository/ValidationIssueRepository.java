package com.mxsuite.repository;

import com.mxsuite.model.ValidationIssue;
import com.mxsuite.model.enums.ValidationSeverity;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface ValidationIssueRepository extends JpaRepository<ValidationIssue, UUID> {

    Page<ValidationIssue> findByValidationRunId(UUID validationRunId, Pageable pageable);

    Page<ValidationIssue> findByValidationRunIdAndSeverity(UUID validationRunId,
                                                            ValidationSeverity severity,
                                                            Pageable pageable);

    Page<ValidationIssue> findByValidationRunIdAndResolved(UUID validationRunId,
                                                            boolean resolved,
                                                            Pageable pageable);

    Page<ValidationIssue> findByValidationRunIdAndSeverityAndResolved(UUID validationRunId,
                                                                       ValidationSeverity severity,
                                                                       boolean resolved,
                                                                       Pageable pageable);

    Page<ValidationIssue> findByValidationRunIdAndTargetEntity(UUID validationRunId,
                                                                String targetEntity,
                                                                Pageable pageable);

    /**
     * Aggregate issue counts grouped by target entity.
     * Returns rows like: [targetEntity, severity, count]
     */
    @Query("""
        SELECT vi.targetEntity, vi.severity, COUNT(vi)
        FROM ValidationIssue vi
        WHERE vi.validationRun.id = :runId
        GROUP BY vi.targetEntity, vi.severity
        ORDER BY vi.targetEntity
        """)
    List<Object[]> countByEntityAndSeverity(@Param("runId") UUID runId);

    /**
     * Aggregate issue counts grouped by rule code.
     * Returns rows like: [ruleCode, targetField, count]
     */
    @Query("""
        SELECT vi.ruleCode, vi.targetField, COUNT(vi)
        FROM ValidationIssue vi
        WHERE vi.validationRun.id = :runId
        GROUP BY vi.ruleCode, vi.targetField
        ORDER BY COUNT(vi) DESC
        """)
    List<Object[]> countByRuleAndField(@Param("runId") UUID runId);

    long countByValidationRunIdAndResolvedFalse(UUID validationRunId);

    /**
     * Richer aggregation for AI decision generation prompt context.
     * Returns rows like: [ruleCode, targetEntity, targetField, sourceColumn, count, sampleMessage]
     */
    @Query("""
        SELECT vi.ruleCode, vi.targetEntity, vi.targetField, vi.sourceColumn, COUNT(vi), MIN(vi.message)
        FROM ValidationIssue vi
        WHERE vi.validationRun.id = :runId
        GROUP BY vi.ruleCode, vi.targetEntity, vi.targetField, vi.sourceColumn
        ORDER BY COUNT(vi) DESC
        """)
    List<Object[]> summarizeByRuleEntityField(@Param("runId") UUID runId);
}
