package com.mxsuite.model;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "mapping_candidates")
@Getter
@Setter
@NoArgsConstructor
public class MappingCandidate {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "field_mapping_id", nullable = false)
    private FieldMappingEntry fieldMapping;

    @Column(name = "target_field", nullable = false, length = 200)
    private String targetField;

    @Column(name = "match_pct", precision = 5, scale = 2)
    private BigDecimal matchPct;

    @Column(columnDefinition = "TEXT")
    private String description;

    @Column(name = "sort_order")
    private Integer sortOrder = 0;

    @Column(name = "created_at", updatable = false)
    private Instant createdAt = Instant.now();
}
