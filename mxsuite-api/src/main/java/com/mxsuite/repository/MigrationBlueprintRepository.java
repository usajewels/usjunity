package com.mxsuite.repository;

import com.mxsuite.model.MigrationBlueprint;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface MigrationBlueprintRepository extends JpaRepository<MigrationBlueprint, UUID> {

    @Query("SELECT b FROM MigrationBlueprint b WHERE b.tenant.id = :tenantId OR b.tenant IS NULL ORDER BY b.proven DESC, b.name")
    List<MigrationBlueprint> findByTenantIdOrGlobal(@Param("tenantId") UUID tenantId);
}
