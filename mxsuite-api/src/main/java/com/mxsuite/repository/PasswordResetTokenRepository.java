package com.mxsuite.repository;

import com.mxsuite.model.PasswordResetToken;
import com.mxsuite.model.User;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface PasswordResetTokenRepository extends JpaRepository<PasswordResetToken, UUID> {
    Optional<PasswordResetToken> findByTokenAndUsedFalse(String token);

    // VULN-06: Pessimistic lock to prevent race conditions on token consumption
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT t FROM PasswordResetToken t WHERE t.token = :token AND t.used = false")
    Optional<PasswordResetToken> findByTokenAndUsedFalseForUpdate(@Param("token") String token);

    // VULN-14: Find all unused tokens for a user so they can be invalidated
    List<PasswordResetToken> findByUserAndUsedFalse(User user);

    // VULN-14: Bulk invalidate existing tokens when a new one is generated
    @Modifying
    @Query("UPDATE PasswordResetToken t SET t.used = true WHERE t.user.id = :userId AND t.used = false")
    int invalidateAllByUserId(@Param("userId") UUID userId);
}
