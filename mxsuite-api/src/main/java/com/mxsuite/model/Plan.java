package com.mxsuite.model;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.mxsuite.model.enums.PlanStatus;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Entity
@Table(name = "plans")
@Getter
@Setter
@NoArgsConstructor
public class Plan extends BaseEntity {

    @Column(nullable = false)
    private String name;

    private String description;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private PlanStatus status = PlanStatus.DRAFT;

    @Column(name = "version", nullable = false)
    private int version = 1;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "definition", columnDefinition = "jsonb")
    private Map<String, Object> definition;

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "project_id", nullable = false)
    private Project project;

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "source_asset_id")
    private ProjectAsset sourceAsset;

    @JsonIgnore
    @OneToMany(mappedBy = "plan", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<PlanRun> runs = new ArrayList<>();
}
