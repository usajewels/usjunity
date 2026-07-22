package com.mxsuite.repository;

import com.mxsuite.model.Tenant;
import com.mxsuite.model.enums.TenantType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface TenantRepository extends JpaRepository<Tenant, UUID> {
    Optional<Tenant> findBySlug(String slug);
    Page<Tenant> findByTenantType(TenantType type, Pageable pageable);
    Page<Tenant> findByNameContainingIgnoreCase(String name, Pageable pageable);
    boolean existsBySlug(String slug);
    long countByTenantTypeAndActive(TenantType tenantType, boolean active);
    List<Tenant> findByOpenToAllCoachesTrue();
}
