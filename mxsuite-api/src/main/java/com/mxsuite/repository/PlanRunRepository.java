package com.mxsuite.repository;

import com.mxsuite.model.PlanRun;
import com.mxsuite.model.enums.RunStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface PlanRunRepository extends JpaRepository<PlanRun, UUID> {
    Page<PlanRun> findByPlanId(UUID planId, Pageable pageable);
    Page<PlanRun> findByPlanIdAndStatus(UUID planId, RunStatus status, Pageable pageable);
}
