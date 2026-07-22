package com.mxsuite.model;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.mxsuite.model.enums.DecisionStatus;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@Entity
@Table(name = "semantic_decisions")
@Getter
@Setter
@NoArgsConstructor
public class SemanticDecision extends BaseEntity {

    @Column(nullable = false, length = 500)
    private String title;

    @Column(columnDefinition = "TEXT")
    private String summary;

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "project_id")
    private Project project;

    @Column(name = "field_context", length = 500)
    private String fieldContext;

    @Enumerated(EnumType.STRING)
    @Column(name = "decision_status", nullable = false, length = 20)
    private DecisionStatus decisionStatus = DecisionStatus.OPEN;

    @Column(name = "owner_id")
    private UUID ownerId;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private List<Map<String, Object>> options;

    @Column(name = "selected_option")
    private Integer selectedOption;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private List<Map<String, Object>> requirements;

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "tenant_id", nullable = false)
    private Tenant tenant;
}
