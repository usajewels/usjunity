package com.mxsuite.repository;

import com.mxsuite.model.ReconciliationReport;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface ReconciliationReportRepository extends JpaRepository<ReconciliationReport, UUID> {

    List<ReconciliationReport> findByProjectIdOrderByCreatedAtDesc(UUID projectId);

    Optional<ReconciliationReport> findFirstByProjectIdOrderByCreatedAtDesc(UUID projectId);

    /** Pass rate (0–100.0) across ALL projects — uses latest report per project. */
    @Query(nativeQuery = true, value = """
            SELECT COALESCE(
              CAST(SUM(CASE WHEN s.overall_status = 'PASS' THEN 1 ELSE 0 END) AS FLOAT)
                / NULLIF(COUNT(*), 0) * 100, 0.0)
            FROM (SELECT DISTINCT ON (project_id) overall_status
                  FROM reconciliation_reports
                  ORDER BY project_id, created_at DESC) s
            """)
    double computeGlobalPassRate();

    /** Pass rate scoped to a single tenant. */
    @Query(nativeQuery = true, value = """
            SELECT COALESCE(
              CAST(SUM(CASE WHEN s.overall_status = 'PASS' THEN 1 ELSE 0 END) AS FLOAT)
                / NULLIF(COUNT(*), 0) * 100, 0.0)
            FROM (SELECT DISTINCT ON (r.project_id) r.overall_status
                  FROM reconciliation_reports r
                  JOIN projects p ON r.project_id = p.id
                  WHERE p.tenant_id = :tenantId
                  ORDER BY r.project_id, r.created_at DESC) s
            """)
    double computePassRateByTenant(@Param("tenantId") UUID tenantId);

    /** Pass rate scoped to a set of tenant IDs (platform-support visibility). */
    @Query(nativeQuery = true, value = """
            SELECT COALESCE(
              CAST(SUM(CASE WHEN s.overall_status = 'PASS' THEN 1 ELSE 0 END) AS FLOAT)
                / NULLIF(COUNT(*), 0) * 100, 0.0)
            FROM (SELECT DISTINCT ON (r.project_id) r.overall_status
                  FROM reconciliation_reports r
                  JOIN projects p ON r.project_id = p.id
                  WHERE p.tenant_id IN :tenantIds
                  ORDER BY r.project_id, r.created_at DESC) s
            """)
    double computePassRateByTenants(@Param("tenantIds") Collection<UUID> tenantIds);
}
