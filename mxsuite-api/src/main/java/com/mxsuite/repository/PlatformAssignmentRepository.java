package com.mxsuite.repository;

import com.mxsuite.model.PlatformAssignment;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface PlatformAssignmentRepository extends JpaRepository<PlatformAssignment, UUID> {
    List<PlatformAssignment> findByPlatformUserId(UUID userId);
    List<PlatformAssignment> findByTenantId(UUID tenantId);
    boolean existsByPlatformUserIdAndTenantId(UUID userId, UUID tenantId);

    boolean existsByPlatformUserIdAndTenantIdAndActiveTrue(UUID userId, UUID tenantId);

    List<PlatformAssignment> findByPlatformUserIdAndActiveTrue(UUID userId);

    List<PlatformAssignment> findByTenantIdAndActiveTrue(UUID tenantId);
}
