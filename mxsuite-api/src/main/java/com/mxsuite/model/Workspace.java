package com.mxsuite.model;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "workspaces")
@Getter
@Setter
@NoArgsConstructor
public class Workspace extends BaseEntity {

    @Column(nullable = false)
    private String name;

    private String description;

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "owner_id", nullable = false)
    private User owner;

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "tenant_id")
    private Tenant tenant;

    @Column(name = "is_cross_tenant", nullable = false)
    private boolean crossTenant = false;

    @JsonIgnore
    @OneToMany(mappedBy = "workspace", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<WorkspaceAccess> accessList = new ArrayList<>();

    @JsonIgnore
    @ManyToMany
    @JoinTable(
        name = "workspace_projects",
        joinColumns = @JoinColumn(name = "workspace_id"),
        inverseJoinColumns = @JoinColumn(name = "project_id")
    )
    private List<Project> projects = new ArrayList<>();
}
