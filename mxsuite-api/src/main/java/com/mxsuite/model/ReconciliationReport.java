package com.mxsuite.model;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.List;
import java.util.Map;

@Entity
@Table(name = "reconciliation_reports")
@Getter
@Setter
@NoArgsConstructor
public class ReconciliationReport extends BaseEntity {

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "project_id", nullable = false)
    private Project project;

    @Column(name = "overall_status", nullable = false, length = 20)
    private String overallStatus;

    @Column(name = "warning_count")
    private Integer warningCount = 0;

    @Column(name = "signed_off")
    private boolean signedOff = false;

    @Column(name = "signer_name")
    private String signerName;

    @Column(name = "signer_role", length = 100)
    private String signerRole;

    @Column(name = "signed_at")
    private Instant signedAt;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false, columnDefinition = "jsonb")
    private List<Map<String, Object>> tiers;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "table_breakdown", columnDefinition = "jsonb")
    private List<Map<String, Object>> tableBreakdown;

    @Column(name = "warning_detail", columnDefinition = "TEXT")
    private String warningDetail;

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "tenant_id", nullable = false)
    private Tenant tenant;
}
