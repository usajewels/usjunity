package com.mxsuite.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

@Entity
@Table(name = "audit_events", indexes = {
    @Index(name = "idx_audit_tenant", columnList = "tenant_id"),
    @Index(name = "idx_audit_entity", columnList = "entity_type, entity_id"),
    @Index(name = "idx_audit_timestamp", columnList = "timestamp")
})
@Getter
@Setter
@NoArgsConstructor
public class AuditEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "tenant_id")
    private UUID tenantId;

    @Column(name = "actor_id", nullable = false)
    private UUID actorId;

    @Column(name = "actor_name", nullable = false)
    private String actorName;

    @Column(name = "actor_role", nullable = false)
    private String actorRole;

    @Column(name = "is_platform_action", nullable = false)
    private boolean platformAction;

    @Column(nullable = false)
    private String action;

    @Column(name = "entity_type", nullable = false)
    private String entityType;

    @Column(name = "entity_id", nullable = false)
    private UUID entityId;

    @Column(name = "entity_name")
    private String entityName;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "before_state", columnDefinition = "jsonb")
    private Map<String, Object> beforeState;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "after_state", columnDefinition = "jsonb")
    private Map<String, Object> afterState;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "metadata", columnDefinition = "jsonb")
    private Map<String, Object> metadata;

    @Column(nullable = false)
    private Instant timestamp = Instant.now();

    @Column(name = "ip_address")
    private String ipAddress;

    @Column(name = "trace_id")
    private String traceId;
}
