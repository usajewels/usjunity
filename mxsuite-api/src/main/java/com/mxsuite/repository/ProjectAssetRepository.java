package com.mxsuite.repository;

import com.mxsuite.model.ProjectAsset;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface ProjectAssetRepository extends JpaRepository<ProjectAsset, UUID> {
    Page<ProjectAsset> findByProjectId(UUID projectId, Pageable pageable);

    @Query("SELECT COALESCE(SUM(pa.fileSize), 0) FROM ProjectAsset pa")
    long sumAllFileSize();
}
