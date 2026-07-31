package com.mxsuite.repository;

import com.mxsuite.model.ProjectDataUpload;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ProjectDataUploadRepository extends JpaRepository<ProjectDataUpload, UUID> {

    Optional<ProjectDataUpload> findFirstByProjectIdOrderByCreatedAtDesc(UUID projectId);

    List<ProjectDataUpload> findByProjectIdOrderByCreatedAtDesc(UUID projectId);

    /** Find uploads where S3 export completed but staging data may still exist. */
    @Query("SELECT u FROM ProjectDataUpload u WHERE u.s3ExportStatus = 'EXPORTED' " +
            "AND u.stagingStatus = 'STAGED' AND u.s3ExportedAt < :cutoff")
    List<ProjectDataUpload> findStaleStagingAfterExport(Instant cutoff);
}
