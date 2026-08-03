package com.mxsuite.repository;

import com.mxsuite.model.ApprovalRequest;
import com.mxsuite.model.enums.ApprovalStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface ApprovalRequestRepository extends JpaRepository<ApprovalRequest, UUID> {

    /* ---- Tenant-scoped (regular users) ---- */

    Page<ApprovalRequest> findByTenantId(UUID tenantId, Pageable pageable);

    Page<ApprovalRequest> findByTenantIdAndApprovalStatus(UUID tenantId, ApprovalStatus status, Pageable pageable);

    /* ---- Coach-scoped: assigned tenant list ---- */

    Page<ApprovalRequest> findByTenantIdIn(List<UUID> tenantIds, Pageable pageable);

    Page<ApprovalRequest> findByTenantIdInAndApprovalStatus(List<UUID> tenantIds, ApprovalStatus status, Pageable pageable);

    @Query(value = "SELECT ar FROM ApprovalRequest ar JOIN ar.project p " +
                   "WHERE ar.tenant.id IN :tenantIds " +
                   "AND ar.approvalStatus = :status " +
                   "AND (ar.gateType = :gateType OR :gateType IS NULL) " +
                   "AND (:search IS NULL OR LOWER(p.name) LIKE LOWER(CONCAT('%', cast(:search as String), '%'))) " +
                   "AND (:letter IS NULL OR LOWER(p.name) LIKE LOWER(CONCAT(cast(:letter as String), '%')))",
           countQuery = "SELECT COUNT(ar) FROM ApprovalRequest ar JOIN ar.project p " +
                        "WHERE ar.tenant.id IN :tenantIds " +
                        "AND ar.approvalStatus = :status " +
                        "AND (ar.gateType = :gateType OR :gateType IS NULL) " +
                        "AND (:search IS NULL OR LOWER(p.name) LIKE LOWER(CONCAT('%', cast(:search as String), '%'))) " +
                        "AND (:letter IS NULL OR LOWER(p.name) LIKE LOWER(CONCAT(cast(:letter as String), '%')))")
    Page<ApprovalRequest> findFilteredInTenantsWithStatus(
            @Param("tenantIds") List<UUID> tenantIds,
            @Param("status") ApprovalStatus status,
            @Param("gateType") String gateType,
            @Param("search") String search,
            @Param("letter") String letter,
            Pageable pageable);

    @Query(value = "SELECT ar FROM ApprovalRequest ar JOIN ar.project p " +
                   "WHERE ar.tenant.id IN :tenantIds " +
                   "AND (ar.gateType = :gateType OR :gateType IS NULL) " +
                   "AND (:search IS NULL OR LOWER(p.name) LIKE LOWER(CONCAT('%', cast(:search as String), '%'))) " +
                   "AND (:letter IS NULL OR LOWER(p.name) LIKE LOWER(CONCAT(cast(:letter as String), '%')))",
           countQuery = "SELECT COUNT(ar) FROM ApprovalRequest ar JOIN ar.project p " +
                        "WHERE ar.tenant.id IN :tenantIds " +
                        "AND (ar.gateType = :gateType OR :gateType IS NULL) " +
                        "AND (:search IS NULL OR LOWER(p.name) LIKE LOWER(CONCAT('%', cast(:search as String), '%'))) " +
                        "AND (:letter IS NULL OR LOWER(p.name) LIKE LOWER(CONCAT(cast(:letter as String), '%')))")
    Page<ApprovalRequest> findFilteredInTenantsNoStatus(
            @Param("tenantIds") List<UUID> tenantIds,
            @Param("gateType") String gateType,
            @Param("search") String search,
            @Param("letter") String letter,
            Pageable pageable);

    /* ---- Platform-admin-scoped: all tenants ---- */

    Page<ApprovalRequest> findByApprovalStatus(ApprovalStatus status, Pageable pageable);

    @Query(value = "SELECT ar FROM ApprovalRequest ar JOIN ar.project p " +
                   "WHERE ar.approvalStatus = :status " +
                   "AND (ar.gateType = :gateType OR :gateType IS NULL) " +
                   "AND (:search IS NULL OR LOWER(p.name) LIKE LOWER(CONCAT('%', cast(:search as String), '%'))) " +
                   "AND (:letter IS NULL OR LOWER(p.name) LIKE LOWER(CONCAT(cast(:letter as String), '%')))",
           countQuery = "SELECT COUNT(ar) FROM ApprovalRequest ar JOIN ar.project p " +
                        "WHERE ar.approvalStatus = :status " +
                        "AND (ar.gateType = :gateType OR :gateType IS NULL) " +
                        "AND (:search IS NULL OR LOWER(p.name) LIKE LOWER(CONCAT('%', cast(:search as String), '%'))) " +
                        "AND (:letter IS NULL OR LOWER(p.name) LIKE LOWER(CONCAT(cast(:letter as String), '%')))")
    Page<ApprovalRequest> findAllFilteredWithStatus(
            @Param("status") ApprovalStatus status,
            @Param("gateType") String gateType,
            @Param("search") String search,
            @Param("letter") String letter,
            Pageable pageable);

    @Query(value = "SELECT ar FROM ApprovalRequest ar JOIN ar.project p " +
                   "WHERE (ar.gateType = :gateType OR :gateType IS NULL) " +
                   "AND (:search IS NULL OR LOWER(p.name) LIKE LOWER(CONCAT('%', cast(:search as String), '%'))) " +
                   "AND (:letter IS NULL OR LOWER(p.name) LIKE LOWER(CONCAT(cast(:letter as String), '%')))",
           countQuery = "SELECT COUNT(ar) FROM ApprovalRequest ar JOIN ar.project p " +
                        "WHERE (ar.gateType = :gateType OR :gateType IS NULL) " +
                        "AND (:search IS NULL OR LOWER(p.name) LIKE LOWER(CONCAT('%', cast(:search as String), '%'))) " +
                        "AND (:letter IS NULL OR LOWER(p.name) LIKE LOWER(CONCAT(cast(:letter as String), '%')))")
    Page<ApprovalRequest> findAllFilteredNoStatus(
            @Param("gateType") String gateType,
            @Param("search") String search,
            @Param("letter") String letter,
            Pageable pageable);

    /* ---- Tenant-scoped with text filters ---- */

    @Query(value = "SELECT ar FROM ApprovalRequest ar JOIN ar.project p " +
                   "WHERE ar.tenant.id = :tenantId " +
                   "AND ar.approvalStatus = :status " +
                   "AND (ar.gateType = :gateType OR :gateType IS NULL) " +
                   "AND (:search IS NULL OR LOWER(p.name) LIKE LOWER(CONCAT('%', cast(:search as String), '%'))) " +
                   "AND (:letter IS NULL OR LOWER(p.name) LIKE LOWER(CONCAT(cast(:letter as String), '%')))",
           countQuery = "SELECT COUNT(ar) FROM ApprovalRequest ar JOIN ar.project p " +
                        "WHERE ar.tenant.id = :tenantId " +
                        "AND ar.approvalStatus = :status " +
                        "AND (ar.gateType = :gateType OR :gateType IS NULL) " +
                        "AND (:search IS NULL OR LOWER(p.name) LIKE LOWER(CONCAT('%', cast(:search as String), '%'))) " +
                        "AND (:letter IS NULL OR LOWER(p.name) LIKE LOWER(CONCAT(cast(:letter as String), '%')))")
    Page<ApprovalRequest> findFilteredWithStatus(
            @Param("tenantId") UUID tenantId,
            @Param("status") ApprovalStatus status,
            @Param("gateType") String gateType,
            @Param("search") String search,
            @Param("letter") String letter,
            Pageable pageable);

    @Query(value = "SELECT ar FROM ApprovalRequest ar JOIN ar.project p " +
                   "WHERE ar.tenant.id = :tenantId " +
                   "AND (ar.gateType = :gateType OR :gateType IS NULL) " +
                   "AND (:search IS NULL OR LOWER(p.name) LIKE LOWER(CONCAT('%', cast(:search as String), '%'))) " +
                   "AND (:letter IS NULL OR LOWER(p.name) LIKE LOWER(CONCAT(cast(:letter as String), '%')))",
           countQuery = "SELECT COUNT(ar) FROM ApprovalRequest ar JOIN ar.project p " +
                        "WHERE ar.tenant.id = :tenantId " +
                        "AND (ar.gateType = :gateType OR :gateType IS NULL) " +
                        "AND (:search IS NULL OR LOWER(p.name) LIKE LOWER(CONCAT('%', cast(:search as String), '%'))) " +
                        "AND (:letter IS NULL OR LOWER(p.name) LIKE LOWER(CONCAT(cast(:letter as String), '%')))")
    Page<ApprovalRequest> findFilteredNoStatus(
            @Param("tenantId") UUID tenantId,
            @Param("gateType") String gateType,
            @Param("search") String search,
            @Param("letter") String letter,
            Pageable pageable);

    /* ---- Misc ---- */

    List<ApprovalRequest> findByProjectIdOrderByCreatedAtDesc(UUID projectId);

    /** Dedup check: does a PENDING request already exist for this gate + role? */
    boolean existsByPhaseGateIdAndRequiredRoleAndApprovalStatus(
            UUID phaseGateId, String requiredRole, ApprovalStatus status);

    /** All approval requests for a gate — used to verify all required approvals received. */
    List<ApprovalRequest> findByPhaseGateId(UUID phaseGateId);

    /** Find a specific pending approval for a gate + role (member self-approve flow). */
    java.util.Optional<ApprovalRequest> findFirstByPhaseGateIdAndRequiredRoleAndApprovalStatus(
            UUID phaseGateId, String requiredRole, ApprovalStatus status);

    long countByTenantIdAndApprovalStatus(UUID tenantId, ApprovalStatus status);

    long countByTenantIdInAndApprovalStatus(List<UUID> tenantIds, ApprovalStatus status);

    long countByApprovalStatus(ApprovalStatus status);
}
