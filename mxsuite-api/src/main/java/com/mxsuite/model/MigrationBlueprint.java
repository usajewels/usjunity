package com.mxsuite.model;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.util.Map;

@Entity
@Table(name = "migration_blueprints")
@Getter
@Setter
@NoArgsConstructor
public class MigrationBlueprint extends BaseEntity {

    @Column(nullable = false)
    private String name;

    @Column(columnDefinition = "TEXT")
    private String description;

    @Column(name = "source_system", nullable = false, length = 100)
    private String sourceSystem;

    @Column(name = "target_system", nullable = false, length = 100)
    private String targetSystem;

    @Column(name = "is_proven", nullable = false)
    private boolean proven = false;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private Map<String, Object> definition;

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "tenant_id")
    private Tenant tenant;
}
