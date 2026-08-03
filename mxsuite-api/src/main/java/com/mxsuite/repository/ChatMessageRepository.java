package com.mxsuite.repository;

import com.mxsuite.model.ChatMessage;
import com.mxsuite.model.enums.MessageSender;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.UUID;

@Repository
public interface ChatMessageRepository extends JpaRepository<ChatMessage, UUID> {

    Page<ChatMessage> findByConversationIdOrderByCreatedAtAsc(UUID conversationId, Pageable pageable);

    boolean existsByConversationIdAndSenderIdAndSenderTypeAndCreatedAtAfter(
            UUID conversationId, UUID senderId, MessageSender senderType, Instant after);
}
