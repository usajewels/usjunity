package com.mxsuite.repository;

import com.mxsuite.model.Onboarding;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface OnboardingRepository extends JpaRepository<Onboarding, UUID> {
    Optional<Onboarding> findByTenantId(UUID tenantId);
}
