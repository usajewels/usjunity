package com.mxsuite.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "notifications")
@Getter
@Setter
@NoArgsConstructor
public class Notification {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "recipient_id", nullable = false)
    private UUID recipientId;

    @Column(name = "tenant_id")
    private UUID tenantId;

    @Column(nullable = false, length = 60)
    private String type;

    @Column(nullable = false, length = 300)
    private String title;

    @Column(length = 1000)
    private String message;

    @Column(name = "entity_type", length = 100)
    private String entityType;

    @Column(name = "entity_id")
    private UUID entityId;

    @Column(name = "project_id")
    private UUID projectId;

    @Column(name = "is_read", nullable = false)
    private boolean read = false;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();
}
