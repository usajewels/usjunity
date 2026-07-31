package com.mxsuite.repository;

import com.mxsuite.model.Conversation;
import com.mxsuite.model.enums.ConversationStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface ConversationRepository extends JpaRepository<Conversation, UUID> {

    List<Conversation> findByMemberIdAndStatusOrderByLastMessageAtDesc(UUID memberId, ConversationStatus status);

    List<Conversation> findByTenantIdInAndStatusOrderByLastMessageAtDesc(List<UUID> tenantIds, ConversationStatus status);

    List<Conversation> findByAssignedCoachIdAndStatusOrderByLastMessageAtDesc(UUID coachId, ConversationStatus status);

    List<Conversation> findByMemberIdOrderByLastMessageAtDesc(UUID memberId);

    List<Conversation> findByTenantIdInOrderByLastMessageAtDesc(List<UUID> tenantIds);

    long countByTenantIdInAndHelpRequestedTrue(List<UUID> tenantIds);

    long countByTenantIdInAndSentimentScoreLessThan(List<UUID> tenantIds, Double threshold);

    long countByTenantIdInAndStatus(List<UUID> tenantIds, ConversationStatus status);

    @Modifying
    @Query("UPDATE Conversation c SET c.unreadCoachCount = c.unreadCoachCount + 1 WHERE c.id = :id")
    void incrementUnreadCoachCount(@Param("id") UUID id);

    @Modifying
    @Query("UPDATE Conversation c SET c.unreadMemberCount = c.unreadMemberCount + 1 WHERE c.id = :id")
    void incrementUnreadMemberCount(@Param("id") UUID id);
}
