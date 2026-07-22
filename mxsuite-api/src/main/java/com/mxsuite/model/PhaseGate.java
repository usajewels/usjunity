package com.mxsuite.model;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.mxsuite.model.enums.GateStatus;
import com.mxsuite.model.enums.MigrationPhase;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "phase_gates", uniqueConstraints = {
        @UniqueConstraint(columnNames = {"project_id", "phase"})
})
@Getter
@Setter
@NoArgsConstructor
public class PhaseGate extends BaseEntity {

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "project_id", nullable = false)
    private Project project;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private MigrationPhase phase;

    @Enumerated(EnumType.STRING)
    @Column(name = "gate_status", nullable = false, length = 20)
    private GateStatus gateStatus = GateStatus.PENDING;

    @Column(name = "required_role", length = 30)
    private String requiredRole;

    @Column(name = "cleared_by")
    private UUID clearedBy;

    @Column(name = "cleared_at")
    private Instant clearedAt;

    @Column(name = "blocked_reason", columnDefinition = "TEXT")
    private String blockedReason;
}
