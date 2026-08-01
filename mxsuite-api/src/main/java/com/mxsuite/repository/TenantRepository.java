package com.mxsuite.repository;

import com.mxsuite.model.Tenant;
import com.mxsuite.model.enums.TenantType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface TenantRepository extends JpaRepository<Tenant, UUID> {
    Optional<Tenant> findBySlug(String slug);
    Page<Tenant> findByTenantType(TenantType type, Pageable pageable);
    Page<Tenant> findByNameContainingIgnoreCase(String name, Pageable pageable);
    Page<Tenant> findByNameStartingWithIgnoreCase(String letter, Pageable pageable);
    Page<Tenant> findByTenantTypeAndNameContainingIgnoreCase(TenantType type, String name, Pageable pageable);
    Page<Tenant> findByTenantTypeAndNameStartingWithIgnoreCase(TenantType type, String letter, Pageable pageable);
    boolean existsBySlug(String slug);
    long countByTenantTypeAndActive(TenantType tenantType, boolean active);
    List<Tenant> findByOpenToAllCoachesTrue();
    List<Tenant> findByTenantType(TenantType type);

    // Coach-scoped queries: tenants assigned to a coach (active assignments) OR open to all coaches
    @Query("SELECT t FROM Tenant t WHERE t.tenantType = :type AND (t.openToAllCoaches = true OR EXISTS (SELECT pa FROM PlatformAssignment pa WHERE pa.tenant = t AND pa.platformUser.id = :coachId AND pa.active = true))")
    Page<Tenant> findByTenantTypeAndCoach(@Param("type") TenantType type, @Param("coachId") UUID coachId, Pageable pageable);

    @Query("SELECT t FROM Tenant t WHERE t.tenantType = :type AND (t.openToAllCoaches = true OR EXISTS (SELECT pa FROM PlatformAssignment pa WHERE pa.tenant = t AND pa.platformUser.id = :coachId AND pa.active = true)) AND LOWER(t.name) LIKE LOWER(CONCAT('%', :search, '%'))")
    Page<Tenant> findByTenantTypeAndCoachAndSearch(@Param("type") TenantType type, @Param("coachId") UUID coachId, @Param("search") String search, Pageable pageable);

    @Query("SELECT t FROM Tenant t WHERE t.tenantType = :type AND (t.openToAllCoaches = true OR EXISTS (SELECT pa FROM PlatformAssignment pa WHERE pa.tenant = t AND pa.platformUser.id = :coachId AND pa.active = true)) AND LOWER(t.name) LIKE LOWER(CONCAT(:letter, '%'))")
    Page<Tenant> findByTenantTypeAndCoachAndLetter(@Param("type") TenantType type, @Param("coachId") UUID coachId, @Param("letter") String letter, Pageable pageable);
}
