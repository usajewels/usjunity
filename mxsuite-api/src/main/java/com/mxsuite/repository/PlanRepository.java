package com.mxsuite.repository;

import com.mxsuite.model.Plan;
import com.mxsuite.model.enums.PlanStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface PlanRepository extends JpaRepository<Plan, UUID> {
    Page<Plan> findByProjectId(UUID projectId, Pageable pageable);
    Page<Plan> findByProjectIdAndStatus(UUID projectId, PlanStatus status, Pageable pageable);

    @Query("SELECT p FROM Plan p JOIN FETCH p.project proj JOIN FETCH proj.tenant WHERE p.id = :id")
    Optional<Plan> findByIdWithProjectAndTenant(@Param("id") UUID id);
}
