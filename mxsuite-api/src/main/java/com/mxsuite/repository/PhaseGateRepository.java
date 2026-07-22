package com.mxsuite.repository;

import com.mxsuite.model.PhaseGate;
import com.mxsuite.model.enums.GateStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface PhaseGateRepository extends JpaRepository<PhaseGate, UUID> {
    List<PhaseGate> findByProjectIdOrderByPhase(UUID projectId);

    long countByProjectIdAndGateStatus(UUID projectId, GateStatus gateStatus);

    long countByProject_Tenant_IdAndGateStatus(UUID tenantId, GateStatus gateStatus);

    long countByGateStatus(GateStatus gateStatus);
}
