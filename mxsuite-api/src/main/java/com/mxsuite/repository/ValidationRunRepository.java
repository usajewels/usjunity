package com.mxsuite.repository;

import com.mxsuite.model.ValidationRun;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface ValidationRunRepository extends JpaRepository<ValidationRun, UUID> {

    List<ValidationRun> findByProjectIdOrderByCreatedAtDesc(UUID projectId);

    Optional<ValidationRun> findFirstByProjectIdOrderByCreatedAtDesc(UUID projectId);
}
