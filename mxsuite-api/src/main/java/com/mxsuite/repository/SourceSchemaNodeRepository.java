package com.mxsuite.repository;

import com.mxsuite.model.SourceSchemaNode;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface SourceSchemaNodeRepository extends JpaRepository<SourceSchemaNode, UUID> {

    List<SourceSchemaNode> findByProjectIdAndParentIsNullOrderBySortOrder(UUID projectId);

    void deleteByProjectId(UUID projectId);
}
