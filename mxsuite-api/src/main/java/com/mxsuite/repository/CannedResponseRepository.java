package com.mxsuite.repository;

import com.mxsuite.model.CannedResponse;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface CannedResponseRepository extends JpaRepository<CannedResponse, UUID> {

    List<CannedResponse> findByTenantIdOrderBySortOrderAsc(UUID tenantId);
}
