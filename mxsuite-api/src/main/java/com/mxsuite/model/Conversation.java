package com.mxsuite.model;

import com.mxsuite.model.enums.ChatMode;
import com.mxsuite.model.enums.ConversationStatus;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "conversations")
@Getter
@Setter
@NoArgsConstructor
public class Conversation extends BaseEntity {

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "tenant_id", nullable = false)
    private Tenant tenant;

    @Column(name = "tenant_id", insertable = false, updatable = false)
    private UUID tenantId;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "member_id", nullable = false)
    private User member;

    @Column(name = "member_id", insertable = false, updatable = false)
    private UUID memberId;

    @Column(name = "member_name", length = 200)
    private String memberName;

    @Column(name = "member_avatar_url", length = 500)
    private String memberAvatarUrl;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "assigned_coach_id")
    private User assignedCoach;

    @Column(name = "assigned_coach_id", insertable = false, updatable = false)
    private UUID assignedCoachId;

    @Column(name = "assigned_coach_name", length = 200)
    private String assignedCoachName;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private ChatMode mode = ChatMode.AI;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "controlling_coach_id")
    private User controllingCoach;

    @Column(name = "controlling_coach_id", insertable = false, updatable = false)
    private UUID controllingCoachId;

    @Column(name = "controlling_coach_name", length = 200)
    private String controllingCoachName;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private ConversationStatus status = ConversationStatus.ACTIVE;

    @Column(length = 500)
    private String subject;

    @Column(name = "sentiment_score")
    private Double sentimentScore;

    @Column(name = "sentiment_label", length = 30)
    private String sentimentLabel;

    @Column(name = "help_requested", nullable = false)
    private boolean helpRequested = false;

    @Column(name = "last_message_at")
    private Instant lastMessageAt;

    @Column(name = "last_message_preview", length = 300)
    private String lastMessagePreview;

    @Column(name = "unread_coach_count", nullable = false)
    private int unreadCoachCount = 0;

    @Column(name = "unread_member_count", nullable = false)
    private int unreadMemberCount = 0;

    @Column(name = "onboarding_id")
    private UUID onboardingId;

    @Version
    @Column(nullable = false)
    private int version = 0;
}
