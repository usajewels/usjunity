package com.mxsuite.model;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.mxsuite.model.enums.TenantType;
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
@Table(name = "tenants")
@Getter
@Setter
@NoArgsConstructor
public class Tenant extends BaseEntity {

    @Column(nullable = false)
    private String name;

    @Column(unique = true, nullable = false)
    private String slug;

    @Enumerated(EnumType.STRING)
    @Column(name = "tenant_type", nullable = false)
    private TenantType tenantType;

    @Column(name = "is_active", nullable = false)
    private boolean active = true;

    @Column(name = "brand_name", length = 100)
    private String brandName = "GrowthZone";

    @Column(name = "logo_url", length = 500)
    private String logoUrl;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "theme_config", columnDefinition = "jsonb")
    private Map<String, Object> themeConfig;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "feature_config", columnDefinition = "jsonb")
    private Map<String, Object> featureConfig;

    @Column(name = "open_to_all_coaches", nullable = false)
    private boolean openToAllCoaches = false;

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "onboarding_project_id")
    private Project onboardingProject;

    @JsonIgnore
    @OneToMany(mappedBy = "tenant", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<User> users = new ArrayList<>();

    @JsonIgnore
    @OneToMany(mappedBy = "tenant", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<Project> projects = new ArrayList<>();
}
