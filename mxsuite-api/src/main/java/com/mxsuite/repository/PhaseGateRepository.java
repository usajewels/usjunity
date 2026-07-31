package com.mxsuite.repository;

import com.mxsuite.model.PhaseGate;
import com.mxsuite.model.enums.GateStatus;
import com.mxsuite.model.enums.MigrationPhase;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface PhaseGateRepository extends JpaRepository<PhaseGate, UUID> {
    List<PhaseGate> findByProjectIdOrderByPhase(UUID projectId);

    Optional<PhaseGate> findByProjectIdAndPhase(UUID projectId, MigrationPhase phase);

    long countByProjectIdAndGateStatus(UUID projectId, GateStatus gateStatus);

    long countByProject_Tenant_IdAndGateStatus(UUID tenantId, GateStatus gateStatus);

    long countByGateStatus(GateStatus gateStatus);
}
