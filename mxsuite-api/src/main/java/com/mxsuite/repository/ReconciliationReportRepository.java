package com.mxsuite.repository;

import com.mxsuite.model.ReconciliationReport;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface ReconciliationReportRepository extends JpaRepository<ReconciliationReport, UUID> {

    List<ReconciliationReport> findByProjectIdOrderByCreatedAtDesc(UUID projectId);

    Optional<ReconciliationReport> findFirstByProjectIdOrderByCreatedAtDesc(UUID projectId);
}
