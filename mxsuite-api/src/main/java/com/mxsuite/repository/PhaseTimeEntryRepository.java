package com.mxsuite.repository;

import com.mxsuite.model.PhaseTimeEntry;
import com.mxsuite.model.enums.MigrationPhase;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface PhaseTimeEntryRepository extends JpaRepository<PhaseTimeEntry, UUID> {

    List<PhaseTimeEntry> findByProjectIdOrderByStartedAt(UUID projectId);

    Optional<PhaseTimeEntry> findByProjectIdAndPhase(UUID projectId, MigrationPhase phase);

    Optional<PhaseTimeEntry> findByProjectIdAndCompletedAtIsNull(UUID projectId);

    @Query(value = """
            SELECT AVG(EXTRACT(EPOCH FROM (sub.max_completed - sub.min_started)) / 86400.0)
            FROM (
                SELECT pte.project_id,
                       MIN(pte.started_at) AS min_started,
                       MAX(pte.completed_at) AS max_completed
                FROM phase_time_entries pte
                JOIN projects p ON p.id = pte.project_id
                WHERE p.migration_status = 'COMPLETED'
                  AND pte.completed_at IS NOT NULL
                GROUP BY pte.project_id
                HAVING MAX(pte.completed_at) IS NOT NULL
            ) sub
            """, nativeQuery = true)
    Double computeAvgCycleTimeDays();

    // Analytics: avg duration per phase across all completed phases
    @Query(value = """
            SELECT pte.phase,
                   AVG(EXTRACT(EPOCH FROM (pte.completed_at - pte.started_at)) / 60.0) AS avg_minutes,
                   PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (pte.completed_at - pte.started_at)) / 60.0) AS median_minutes,
                   COUNT(*) AS project_count
            FROM phase_time_entries pte
            WHERE pte.completed_at IS NOT NULL
            GROUP BY pte.phase
            ORDER BY CASE pte.phase
                WHEN 'DISCOVER' THEN 1 WHEN 'MAP' THEN 2 WHEN 'GENERATE' THEN 3
                WHEN 'DRY_RUN' THEN 4 WHEN 'MIGRATE' THEN 5 WHEN 'CUT_OVER' THEN 6
            END
            """, nativeQuery = true)
    List<Object[]> computeAvgDurationPerPhase();

    // Analytics: cycle time trend by completion month
    @Query(value = """
            SELECT TO_CHAR(sub.max_completed, 'YYYY-MM') AS month,
                   AVG(EXTRACT(EPOCH FROM (sub.max_completed - sub.min_started)) / 86400.0) AS avg_days,
                   COUNT(*) AS completed_count
            FROM (
                SELECT pte.project_id,
                       MIN(pte.started_at) AS min_started,
                       MAX(pte.completed_at) AS max_completed
                FROM phase_time_entries pte
                JOIN projects p ON p.id = pte.project_id
                WHERE p.migration_status = 'COMPLETED'
                  AND pte.completed_at IS NOT NULL
                GROUP BY pte.project_id
                HAVING MAX(pte.completed_at) IS NOT NULL
            ) sub
            GROUP BY TO_CHAR(sub.max_completed, 'YYYY-MM')
            ORDER BY month
            """, nativeQuery = true)
    List<Object[]> computeCycleTimeTrendByMonth();

    // Analytics: all currently active (in-progress) phase entries
    @Query("SELECT pte FROM PhaseTimeEntry pte JOIN FETCH pte.project p JOIN FETCH p.tenant JOIN FETCH p.owner WHERE pte.completedAt IS NULL")
    List<PhaseTimeEntry> findAllActivePhaseEntries();

    // Analytics: avg duration per phase for a specific coach/owner
    @Query(value = """
            SELECT pte.phase,
                   AVG(EXTRACT(EPOCH FROM (pte.completed_at - pte.started_at)) / 60.0) AS avg_minutes,
                   COUNT(*) AS cnt
            FROM phase_time_entries pte
            JOIN projects p ON p.id = pte.project_id
            WHERE p.owner_id = :ownerId AND pte.completed_at IS NOT NULL
            GROUP BY pte.phase
            """, nativeQuery = true)
    List<Object[]> computeAvgDurationPerPhaseByOwner(@Param("ownerId") UUID ownerId);
}
