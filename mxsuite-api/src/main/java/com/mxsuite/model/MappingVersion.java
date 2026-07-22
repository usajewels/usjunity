package com.mxsuite.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Entity
@Table(name = "mapping_versions")
@Getter
@Setter
@NoArgsConstructor
public class MappingVersion {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "project_id", nullable = false)
    private Project project;

    @Column(name = "version_number", nullable = false)
    private int versionNumber;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private List<Map<String, Object>> snapshot;

    @Column(name = "change_count", nullable = false)
    private int changeCount;

    @Column(length = 200)
    private String label;

    @Column(columnDefinition = "TEXT")
    private String description;

    @Column(length = 30, nullable = false)
    private String source = "EDIT";

    @Column(name = "created_by")
    private UUID createdBy;

    @Column(name = "created_by_name", length = 200)
    private String createdByName;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "closed_at")
    private Instant closedAt;

    @OneToMany(mappedBy = "mappingVersion", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("createdAt ASC")
    private List<MappingVersionChange> changes = new ArrayList<>();
}
