package com.mxsuite.model;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.mxsuite.model.enums.RunStatus;
import com.mxsuite.model.enums.RunType;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.Map;

@Entity
@Table(name = "plan_runs")
@Getter
@Setter
@NoArgsConstructor
public class PlanRun extends BaseEntity {

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "plan_id", nullable = false)
    private Plan plan;

    @Enumerated(EnumType.STRING)
    @Column(name = "run_type", nullable = false)
    private RunType runType;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private RunStatus status = RunStatus.QUEUED;

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "triggered_by")
    private User triggeredBy;

    @Column(name = "started_at")
    private Instant startedAt;

    @Column(name = "completed_at")
    private Instant completedAt;

    @Column(name = "records_processed")
    private Long recordsProcessed;

    @Column(name = "records_succeeded")
    private Long recordsSucceeded;

    @Column(name = "records_failed")
    private Long recordsFailed;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "result_summary", columnDefinition = "jsonb")
    private Map<String, Object> resultSummary;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "errors", columnDefinition = "jsonb")
    private Map<String, Object> errors;

    @Column(name = "plan_version")
    private int planVersion;
}
