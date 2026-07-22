package com.mxsuite.repository;

import com.mxsuite.model.Workspace;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface WorkspaceRepository extends JpaRepository<Workspace, UUID> {
    Page<Workspace> findByOwnerId(UUID ownerId, Pageable pageable);
    Page<Workspace> findByTenantId(UUID tenantId, Pageable pageable);

    @Query("SELECT DISTINCT w FROM Workspace w LEFT JOIN w.accessList a WHERE w.owner.id = :userId OR a.user.id = :userId")
    Page<Workspace> findAccessibleByUser(@Param("userId") UUID userId, Pageable pageable);

    long countByTenantId(UUID tenantId);
    long countByOwnerId(UUID ownerId);

    @Query("SELECT w FROM Workspace w JOIN FETCH w.owner WHERE w.id = :id")
    java.util.Optional<Workspace> findByIdWithOwner(@Param("id") UUID id);
}
