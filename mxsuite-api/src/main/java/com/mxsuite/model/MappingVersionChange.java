package com.mxsuite.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "mapping_version_changes")
@Getter
@Setter
@NoArgsConstructor
public class MappingVersionChange {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "mapping_version_id", nullable = false)
    private MappingVersion mappingVersion;

    @Column(name = "field_mapping_id", nullable = false)
    private UUID fieldMappingId;

    @Column(name = "change_type", length = 30, nullable = false)
    private String changeType;

    @Column(name = "field_name", length = 50, nullable = false)
    private String fieldName;

    @Column(name = "old_value", columnDefinition = "TEXT")
    private String oldValue;

    @Column(name = "new_value", columnDefinition = "TEXT")
    private String newValue;

    @Column(name = "source_entity", length = 200, nullable = false)
    private String sourceEntity;

    @Column(name = "source_field", length = 200, nullable = false)
    private String sourceField;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();
}
