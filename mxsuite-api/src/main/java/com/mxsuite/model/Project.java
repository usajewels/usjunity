package com.mxsuite.model;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.mxsuite.model.enums.MigrationPhase;
import com.mxsuite.model.enums.MigrationStatus;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "projects")
@Getter
@Setter
@NoArgsConstructor
public class Project extends BaseEntity {

    @Column(nullable = false)
    private String name;

    private String description;

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "tenant_id", nullable = false)
    private Tenant tenant;

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "owner_id", nullable = false)
    private User owner;

    @Column(name = "source_system", length = 100)
    private String sourceSystem;

    @Column(name = "target_system", length = 100)
    private String targetSystem;

    @Enumerated(EnumType.STRING)
    @Column(name = "migration_phase", length = 30)
    private MigrationPhase migrationPhase;

    @Enumerated(EnumType.STRING)
    @Column(name = "migration_status", length = 30)
    private MigrationStatus migrationStatus;

    @Column(name = "reconciliation_pct", precision = 5, scale = 2)
    private BigDecimal reconciliationPct;

    @JsonIgnore
    @OneToMany(mappedBy = "project", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<Plan> plans = new ArrayList<>();

    @JsonIgnore
    @OneToMany(mappedBy = "project", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<PhaseGate> phaseGates = new ArrayList<>();

    @JsonIgnore
    @OneToMany(mappedBy = "project", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<ProjectAccess> accessList = new ArrayList<>();

    @JsonIgnore
    @OneToMany(mappedBy = "project", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<ProjectAsset> assets = new ArrayList<>();

    @JsonIgnore
    @ManyToMany(mappedBy = "projects")
    private List<Workspace> workspaces = new ArrayList<>();
}
