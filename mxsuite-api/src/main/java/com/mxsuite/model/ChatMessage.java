package com.mxsuite.model;

import com.mxsuite.model.enums.MessageSender;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.util.Map;
import java.util.UUID;

@Entity
@Table(name = "chat_messages")
@Getter
@Setter
@NoArgsConstructor
public class ChatMessage extends BaseEntity {

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "conversation_id", nullable = false)
    private Conversation conversation;

    @Column(name = "conversation_id", insertable = false, updatable = false)
    private UUID conversationId;

    @Enumerated(EnumType.STRING)
    @Column(name = "sender_type", nullable = false, length = 10)
    private MessageSender senderType;

    @Column(name = "sender_id")
    private UUID senderId;

    @Column(name = "sender_name", length = 200)
    private String senderName;

    @Column(name = "sender_avatar_url", length = 500)
    private String senderAvatarUrl;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String content;

    @Column(name = "sentiment_score")
    private Double sentimentScore;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "metadata", columnDefinition = "jsonb")
    private Map<String, Object> metadata;
}
