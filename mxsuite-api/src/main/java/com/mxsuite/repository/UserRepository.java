package com.mxsuite.repository;

import com.mxsuite.model.User;
import com.mxsuite.model.enums.UserRole;
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
public interface UserRepository extends JpaRepository<User, UUID> {
    @Query("SELECT u FROM User u JOIN FETCH u.tenant WHERE u.email = :email")
    Optional<User> findByEmail(@Param("email") String email);
    Page<User> findByTenantId(UUID tenantId, Pageable pageable);

    @Query("SELECT u FROM User u WHERE u.tenant.id = :tenantId AND (LOWER(u.email) LIKE LOWER(CONCAT('%', :search, '%')) OR LOWER(u.firstName) LIKE LOWER(CONCAT('%', :search, '%')) OR LOWER(u.lastName) LIKE LOWER(CONCAT('%', :search, '%')))")
    Page<User> findByTenantIdAndSearch(@Param("tenantId") UUID tenantId, @Param("search") String search, Pageable pageable);

    @Query("SELECT u FROM User u WHERE LOWER(u.email) LIKE LOWER(CONCAT('%', :search, '%')) OR LOWER(u.firstName) LIKE LOWER(CONCAT('%', :search, '%')) OR LOWER(u.lastName) LIKE LOWER(CONCAT('%', :search, '%'))")
    Page<User> findBySearch(@Param("search") String search, Pageable pageable);

    Page<User> findByLastNameStartingWithIgnoreCase(String letter, Pageable pageable);
    Page<User> findByTenantIdAndLastNameStartingWithIgnoreCase(UUID tenantId, String letter, Pageable pageable);

    Page<User> findByRole(UserRole role, Pageable pageable);
    Page<User> findByTenantIdAndRole(UUID tenantId, UserRole role, Pageable pageable);
    List<User> findByTenantIdAndRole(UUID tenantId, UserRole role);

    @Query("SELECT u FROM User u WHERE u.role = :role AND (LOWER(u.email) LIKE LOWER(CONCAT('%', :search, '%')) OR LOWER(u.firstName) LIKE LOWER(CONCAT('%', :search, '%')) OR LOWER(u.lastName) LIKE LOWER(CONCAT('%', :search, '%')))")
    Page<User> findByRoleAndSearch(@Param("role") UserRole role, @Param("search") String search, Pageable pageable);

    Page<User> findByRoleAndLastNameStartingWithIgnoreCase(UserRole role, String letter, Pageable pageable);
    boolean existsByEmail(String email);

    @Query("SELECT u FROM User u JOIN FETCH u.tenant WHERE u.id = :id")
    Optional<User> findByIdWithTenant(@Param("id") UUID id);

    long countByActive(boolean active);

    List<User> findByRoleIn(List<UserRole> roles);

    @Query("SELECT u FROM User u WHERE u.role IN (com.mxsuite.model.enums.UserRole.PLATFORM_SUPPORT, com.mxsuite.model.enums.UserRole.COACH_ADMIN) AND u.active = true")
    List<User> findActiveCoaches();

    /* ---- Coach-scoped queries (tenantId IN + exclude PLATFORM_ADMIN) ---- */

    @Query("SELECT u FROM User u WHERE u.tenant.id IN :tenantIds AND u.role <> com.mxsuite.model.enums.UserRole.PLATFORM_ADMIN")
    Page<User> findByTenantIdInAndNotPlatformAdmin(@Param("tenantIds") List<UUID> tenantIds, Pageable pageable);

    @Query("SELECT u FROM User u WHERE u.tenant.id IN :tenantIds AND u.role <> com.mxsuite.model.enums.UserRole.PLATFORM_ADMIN AND " +
           "(LOWER(u.email) LIKE LOWER(CONCAT('%', :search, '%')) OR LOWER(u.firstName) LIKE LOWER(CONCAT('%', :search, '%')) OR LOWER(u.lastName) LIKE LOWER(CONCAT('%', :search, '%')))")
    Page<User> findByTenantIdInAndNotPlatformAdminAndSearch(@Param("tenantIds") List<UUID> tenantIds, @Param("search") String search, Pageable pageable);

    @Query("SELECT u FROM User u WHERE u.tenant.id IN :tenantIds AND u.role <> com.mxsuite.model.enums.UserRole.PLATFORM_ADMIN AND LOWER(u.lastName) LIKE LOWER(CONCAT(:letter, '%'))")
    Page<User> findByTenantIdInAndNotPlatformAdminAndLetter(@Param("tenantIds") List<UUID> tenantIds, @Param("letter") String letter, Pageable pageable);

    @Query("SELECT u FROM User u WHERE u.tenant.id IN :tenantIds AND u.role = :role AND u.role <> com.mxsuite.model.enums.UserRole.PLATFORM_ADMIN")
    Page<User> findByTenantIdInAndRoleAndNotPlatformAdmin(@Param("tenantIds") List<UUID> tenantIds, @Param("role") UserRole role, Pageable pageable);

    @Query("SELECT u FROM User u WHERE u.tenant.id IN :tenantIds AND u.role = :role AND u.role <> com.mxsuite.model.enums.UserRole.PLATFORM_ADMIN AND " +
           "(LOWER(u.email) LIKE LOWER(CONCAT('%', :search, '%')) OR LOWER(u.firstName) LIKE LOWER(CONCAT('%', :search, '%')) OR LOWER(u.lastName) LIKE LOWER(CONCAT('%', :search, '%')))")
    Page<User> findByTenantIdInAndRoleAndNotPlatformAdminAndSearch(@Param("tenantIds") List<UUID> tenantIds, @Param("role") UserRole role, @Param("search") String search, Pageable pageable);

    @Query("SELECT u FROM User u WHERE u.tenant.id IN :tenantIds AND u.role = :role AND u.role <> com.mxsuite.model.enums.UserRole.PLATFORM_ADMIN AND LOWER(u.lastName) LIKE LOWER(CONCAT(:letter, '%'))")
    Page<User> findByTenantIdInAndRoleAndNotPlatformAdminAndLetter(@Param("tenantIds") List<UUID> tenantIds, @Param("role") UserRole role, @Param("letter") String letter, Pageable pageable);
}
