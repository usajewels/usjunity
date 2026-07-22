package com.mxsuite.model;

import com.mxsuite.model.enums.UserRole;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "invitations", indexes = {
    @Index(name = "idx_invitation_token", columnList = "token", unique = true),
    @Index(name = "idx_invitation_email", columnList = "email"),
    @Index(name = "idx_invitation_tenant", columnList = "tenant_id")
})
@Getter
@Setter
@NoArgsConstructor
public class Invitation extends BaseEntity {

    @Column(nullable = false)
    private String email;

    @Column(unique = true, nullable = false)
    private String token;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private UserRole role;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "tenant_id", nullable = false)
    private Tenant tenant;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "invited_by", nullable = false)
    private User invitedBy;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private InvitationStatus status = InvitationStatus.PENDING;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "accepted_at")
    private Instant acceptedAt;

    public boolean isExpired() {
        return Instant.now().isAfter(expiresAt);
    }

    public enum InvitationStatus {
        PENDING, ACCEPTED, CANCELLED, EXPIRED
    }
}
