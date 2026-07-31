package com.mxsuite.model;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.mxsuite.model.enums.ValidationRuleCode;
import com.mxsuite.model.enums.ValidationSeverity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;

@Entity
@Table(name = "validation_issues")
@Getter
@Setter
@NoArgsConstructor
public class ValidationIssue extends BaseEntity {

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "validation_run_id", nullable = false)
    private ValidationRun validationRun;

    @Column(name = "row_number", nullable = false)
    private int rowNumber;

    @Column(name = "source_entity", length = 200)
    private String sourceEntity;

    @Column(name = "target_entity", length = 200)
    private String targetEntity;

    @Column(name = "target_field", length = 200)
    private String targetField;

    @Column(name = "source_column", length = 200)
    private String sourceColumn;

    @Column(name = "current_value", columnDefinition = "TEXT")
    private String currentValue;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private ValidationSeverity severity;

    @Enumerated(EnumType.STRING)
    @Column(name = "rule_code", nullable = false, length = 30)
    private ValidationRuleCode ruleCode;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String message;

    @Column(nullable = false)
    private boolean resolved = false;

    @Column(name = "resolved_value", columnDefinition = "TEXT")
    private String resolvedValue;

    @Column(name = "resolved_by")
    private String resolvedBy;

    @Column(name = "resolved_by_name")
    private String resolvedByName;

    @Column(name = "resolved_at")
    private Instant resolvedAt;
}
