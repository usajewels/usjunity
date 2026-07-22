package com.mxsuite.repository;

import com.mxsuite.model.Invitation;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface InvitationRepository extends JpaRepository<Invitation, UUID> {
    Optional<Invitation> findByToken(String token);

    // VULN-06: Pessimistic lock to prevent race conditions on acceptance
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT i FROM Invitation i WHERE i.token = :token")
    Optional<Invitation> findByTokenForUpdate(@Param("token") String token);

    Page<Invitation> findByTenantId(UUID tenantId, Pageable pageable);
    Page<Invitation> findByTenantIdAndStatus(UUID tenantId, Invitation.InvitationStatus status, Pageable pageable);
    boolean existsByEmailAndTenantIdAndStatus(String email, UUID tenantId, Invitation.InvitationStatus status);

    long countByStatus(Invitation.InvitationStatus status);
    long countByTenantId(UUID tenantId);
    long countByTenantIdAndStatus(UUID tenantId, Invitation.InvitationStatus status);
}
