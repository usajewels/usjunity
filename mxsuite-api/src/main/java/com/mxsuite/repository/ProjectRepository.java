package com.mxsuite.repository;

import com.mxsuite.model.Project;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface ProjectRepository extends JpaRepository<Project, UUID> {
    Page<Project> findByTenantId(UUID tenantId, Pageable pageable);
    Page<Project> findByOwnerId(UUID ownerId, Pageable pageable);

    @Query("SELECT p FROM Project p JOIN p.workspaces w WHERE w.id = :workspaceId")
    Page<Project> findByWorkspaceId(@Param("workspaceId") UUID workspaceId, Pageable pageable);

    @Query("SELECT COUNT(p) FROM Project p JOIN p.workspaces w WHERE w.id = :workspaceId")
    long countByWorkspaceId(@Param("workspaceId") UUID workspaceId);

    @Query("SELECT p FROM Project p JOIN FETCH p.tenant WHERE p.id = :id")
    java.util.Optional<Project> findByIdWithTenant(@Param("id") UUID id);

    @Query("SELECT p FROM Project p WHERE p.tenant.id = :tenantId AND p.migrationPhase IS NOT NULL ORDER BY p.createdAt DESC")
    Page<Project> findMigrationProjectsByTenantId(@Param("tenantId") UUID tenantId, Pageable pageable);

    @Query("SELECT p FROM Project p JOIN FETCH p.tenant WHERE p.migrationPhase IS NOT NULL ORDER BY p.createdAt DESC")
    Page<Project> findAllMigrationProjects(Pageable pageable);

    @Query("SELECT COUNT(p) FROM Project p WHERE p.tenant.id = :tenantId AND p.migrationStatus = com.mxsuite.model.enums.MigrationStatus.ACTIVE AND p.migrationPhase IS NOT NULL")
    long countActiveMigrations(@Param("tenantId") UUID tenantId);

    @Query("SELECT COUNT(p) FROM Project p WHERE p.migrationStatus = com.mxsuite.model.enums.MigrationStatus.ACTIVE AND p.migrationPhase IS NOT NULL")
    long countAllActiveMigrations();

    @Query("SELECT p FROM Project p JOIN FETCH p.tenant WHERE p.tenant.id IN :tenantIds AND p.migrationPhase IS NOT NULL ORDER BY p.createdAt DESC")
    Page<Project> findMigrationProjectsByTenantIds(@Param("tenantIds") List<UUID> tenantIds, Pageable pageable);

    @Query("SELECT COUNT(p) FROM Project p WHERE p.tenant.id IN :tenantIds AND p.migrationStatus = com.mxsuite.model.enums.MigrationStatus.ACTIVE AND p.migrationPhase IS NOT NULL")
    long countActiveMigrationsByTenantIds(@Param("tenantIds") List<UUID> tenantIds);
}
