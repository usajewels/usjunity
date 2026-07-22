package com.mxsuite.repository;

import com.mxsuite.model.ApprovalRequest;
import com.mxsuite.model.enums.ApprovalStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface ApprovalRequestRepository extends JpaRepository<ApprovalRequest, UUID> {

    Page<ApprovalRequest> findByTenantId(UUID tenantId, Pageable pageable);

    Page<ApprovalRequest> findByTenantIdAndApprovalStatus(UUID tenantId, ApprovalStatus status, Pageable pageable);

    List<ApprovalRequest> findByProjectIdOrderByCreatedAtDesc(UUID projectId);

    long countByTenantIdAndApprovalStatus(UUID tenantId, ApprovalStatus status);
}
