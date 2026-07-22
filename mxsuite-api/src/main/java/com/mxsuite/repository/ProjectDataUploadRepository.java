package com.mxsuite.repository;

import com.mxsuite.model.ProjectDataUpload;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ProjectDataUploadRepository extends JpaRepository<ProjectDataUpload, UUID> {

    Optional<ProjectDataUpload> findFirstByProjectIdOrderByCreatedAtDesc(UUID projectId);

    List<ProjectDataUpload> findByProjectIdOrderByCreatedAtDesc(UUID projectId);
}
