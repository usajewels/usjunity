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
    List<User> findByTenantIdAndRole(UUID tenantId, UserRole role);
    boolean existsByEmail(String email);

    @Query("SELECT u FROM User u JOIN FETCH u.tenant WHERE u.id = :id")
    Optional<User> findByIdWithTenant(@Param("id") UUID id);

    long countByActive(boolean active);

    List<User> findByRoleIn(List<UserRole> roles);
}
