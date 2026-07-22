package com.mxsuite.model;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.mxsuite.model.enums.MappingStatus;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "field_mapping_entries")
@Getter
@Setter
@NoArgsConstructor
public class FieldMappingEntry extends BaseEntity {

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "project_id", nullable = false)
    private Project project;

    @Column(name = "source_entity", nullable = false, length = 200)
    private String sourceEntity;

    @Column(name = "source_field", nullable = false, length = 200)
    private String sourceField;

    @Column(name = "sample_value", columnDefinition = "TEXT")
    private String sampleValue;

    @Column(name = "target_entity", length = 200)
    private String targetEntity;

    @Column(name = "target_field", length = 200)
    private String targetField;

    @Column(length = 100)
    private String coercion;

    @Column(name = "confidence_pct", precision = 5, scale = 2)
    private BigDecimal confidencePct;

    @Enumerated(EnumType.STRING)
    @Column(name = "mapping_status", nullable = false, length = 30)
    private MappingStatus mappingStatus = MappingStatus.NEEDS_REVIEW;

    @Column(name = "owner_id")
    private UUID ownerId;

    @Column(name = "customer_comment", columnDefinition = "TEXT")
    private String customerComment;

    @OneToMany(mappedBy = "fieldMapping", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("sortOrder ASC")
    private List<MappingCandidate> candidates = new ArrayList<>();
}
