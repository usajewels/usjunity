package com.mxsuite.repository;

import com.mxsuite.model.AuditEvent;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Repository
public interface AuditEventRepository extends JpaRepository<AuditEvent, UUID> {
    Page<AuditEvent> findByTenantIdOrderByTimestampDesc(UUID tenantId, Pageable pageable);
    Page<AuditEvent> findByEntityTypeAndEntityIdOrderByTimestampDesc(String entityType, UUID entityId, Pageable pageable);
    // VULN-05: Tenant-scoped entity audit query
    Page<AuditEvent> findByTenantIdAndEntityTypeAndEntityIdOrderByTimestampDesc(UUID tenantId, String entityType, UUID entityId, Pageable pageable);
    Page<AuditEvent> findByTenantIdAndTimestampBetween(UUID tenantId, Instant from, Instant to, Pageable pageable);
    Page<AuditEvent> findByTenantIdAndPlatformActionOrderByTimestampDesc(UUID tenantId, boolean platformAction, Pageable pageable);

    Page<AuditEvent> findByTenantIdInOrderByTimestampDesc(List<UUID> tenantIds, Pageable pageable);

    long countByTimestampAfter(Instant since);
    long countByTimestampBetween(Instant from, Instant to);
}
