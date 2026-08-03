package com.mxsuite.service;

import com.mxsuite.model.ChatMessage;
import com.mxsuite.model.Conversation;
import com.mxsuite.model.Tenant;
import com.mxsuite.model.User;
import com.mxsuite.model.enums.ChatMode;
import com.mxsuite.model.enums.ConversationStatus;
import com.mxsuite.model.enums.MessageSender;
import com.mxsuite.model.enums.TenantType;
import com.mxsuite.repository.ChatMessageRepository;
import com.mxsuite.repository.ConversationRepository;
import com.mxsuite.repository.OnboardingRepository;
import com.mxsuite.repository.PlatformAssignmentRepository;
import com.mxsuite.repository.TenantRepository;
import com.mxsuite.repository.UserRepository;
import com.mxsuite.security.UserPrincipal;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

@Service
public class ChatService {

    private static final Logger log = LoggerFactory.getLogger(ChatService.class);

    private final ConversationRepository conversationRepository;
    private final ChatMessageRepository chatMessageRepository;
    private final UserRepository userRepository;
    private final TenantRepository tenantRepository;
    private final PlatformAssignmentRepository assignmentRepository;
    private final OnboardingRepository onboardingRepository;
    private final SimpMessagingTemplate messagingTemplate;

    // Optional — avoids circular dependency and keeps ChatService tests clean
    private NotificationService notificationService;

    @Autowired(required = false)
    public void setNotificationService(NotificationService notificationService) {
        this.notificationService = notificationService;
    }

    public ChatService(ConversationRepository conversationRepository,
                       ChatMessageRepository chatMessageRepository,
                       UserRepository userRepository,
                       TenantRepository tenantRepository,
                       PlatformAssignmentRepository assignmentRepository,
                       OnboardingRepository onboardingRepository,
                       SimpMessagingTemplate messagingTemplate) {
        this.conversationRepository = conversationRepository;
        this.chatMessageRepository = chatMessageRepository;
        this.userRepository = userRepository;
        this.tenantRepository = tenantRepository;
        this.assignmentRepository = assignmentRepository;
        this.onboardingRepository = onboardingRepository;
        this.messagingTemplate = messagingTemplate;
    }

    /* ------------------------------------------------------------------ */
    /*  Authorization helpers                                              */
    /* ------------------------------------------------------------------ */

    public void assertMemberOwns(UUID conversationId, UserPrincipal principal) {
        Conversation conv = conversationRepository.findById(conversationId)
                .orElseThrow(() -> new IllegalArgumentException("Conversation not found"));
        if (!conv.getMemberId().equals(principal.id())) {
            throw new AccessDeniedException("Not your conversation");
        }
    }

    public void assertCoachCanAccess(UUID conversationId, UserPrincipal principal) {
        Conversation conv = conversationRepository.findById(conversationId)
                .orElseThrow(() -> new IllegalArgumentException("Conversation not found"));
        List<UUID> visible = visibleTenantIds(principal);
        if (!visible.contains(conv.getTenantId())) {
            throw new AccessDeniedException("Conversation not in your scope");
        }
    }

    /** Check that the user can access the conversation (member or coach). */
    public void assertUserCanAccess(UUID conversationId, UserPrincipal principal) {
        if (principal.isPlatformUser()) {
            assertCoachCanAccess(conversationId, principal);
        } else {
            assertMemberOwns(conversationId, principal);
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Conversation CRUD                                                  */
    /* ------------------------------------------------------------------ */

    @Transactional(readOnly = true)
    public Conversation getConversation(UUID conversationId) {
        return conversationRepository.findById(conversationId)
                .orElseThrow(() -> new IllegalArgumentException("Conversation not found"));
    }

    @Transactional
    public Conversation createConversation(UserPrincipal memberPrincipal, String subject) {
        // Idempotent: return existing active conversation if one exists
        List<Conversation> existing = conversationRepository
                .findByMemberIdAndStatusOrderByLastMessageAtDesc(memberPrincipal.id(), ConversationStatus.ACTIVE);
        if (!existing.isEmpty()) {
            return existing.get(0);
        }

        User member = userRepository.findById(memberPrincipal.id())
                .orElseThrow(() -> new IllegalArgumentException("User not found"));
        Tenant tenant = tenantRepository.findById(memberPrincipal.tenantId())
                .orElseThrow(() -> new IllegalArgumentException("Tenant not found"));

        Conversation conv = new Conversation();
        conv.setTenant(tenant);
        conv.setMember(member);
        conv.setMemberName(member.getFirstName() + " " + member.getLastName());
        conv.setMemberAvatarUrl(member.getAvatarUrl());
        conv.setSubject(subject);
        conv.setMode(ChatMode.AI);
        conv.setStatus(ConversationStatus.ACTIVE);

        // Route to primary coach via Onboarding.assignedTo
        UUID coachId = resolvePrimaryCoach(tenant.getId());
        if (coachId != null) {
            userRepository.findById(coachId).ifPresent(coach -> {
                conv.setAssignedCoach(coach);
                conv.setAssignedCoachName(coach.getFirstName() + " " + coach.getLastName());
            });
        }

        // Link to onboarding — verify the record exists before setting the FK
        if (tenant.getOnboardingProject() != null) {
            UUID onboardingId = tenant.getOnboardingProject().getId();
            if (onboardingRepository.existsById(onboardingId)) {
                conv.setOnboardingId(onboardingId);
            } else {
                log.warn("Onboarding {} referenced by tenant {} does not exist in DB — skipping link",
                        onboardingId, tenant.getId());
            }
        }

        Conversation saved = conversationRepository.save(conv);

        // Notify coach dashboard (scoped to tenant)
        broadcastDashboardUpdate("NEW_CONVERSATION", saved);

        return saved;
    }

    @Transactional
    public Conversation createConversationAsCoach(UUID memberId, UserPrincipal coachPrincipal, String subject) {
        // 1. Load member and verify coach has visibility to member's tenant
        User member = userRepository.findById(memberId)
                .orElseThrow(() -> new IllegalArgumentException("Member not found"));
        UUID tenantId = member.getTenant().getId();
        List<UUID> visibleTenants = visibleTenantIds(coachPrincipal);
        if (!visibleTenants.contains(tenantId)) {
            throw new AccessDeniedException("No access to this member's organization");
        }

        // 2. Idempotent: if active conversation exists with this member, takeover and return it
        List<Conversation> existing = conversationRepository
                .findByMemberIdAndStatusOrderByLastMessageAtDesc(memberId, ConversationStatus.ACTIVE);
        if (!existing.isEmpty()) {
            Conversation conv = existing.get(0);
            if (conv.getMode() != ChatMode.HUMAN || !coachPrincipal.id().equals(conv.getControllingCoachId())) {
                return takeover(conv.getId(), coachPrincipal);
            }
            return conv;
        }

        // 3. Create new conversation — directly in HUMAN mode
        Tenant tenant = tenantRepository.findById(tenantId).orElseThrow();
        User coach = userRepository.findById(coachPrincipal.id()).orElseThrow();

        Conversation conv = new Conversation();
        conv.setTenant(tenant);
        conv.setMember(member);
        conv.setMemberName(member.getFirstName() + " " + member.getLastName());
        conv.setMemberAvatarUrl(member.getAvatarUrl());
        conv.setSubject(subject);
        conv.setMode(ChatMode.HUMAN);
        conv.setStatus(ConversationStatus.ACTIVE);
        conv.setCoachInitiated(true);

        // Set coach as both assigned and controlling
        conv.setAssignedCoach(coach);
        conv.setAssignedCoachName(coach.getFirstName() + " " + coach.getLastName());
        conv.setControllingCoach(coach);
        conv.setControllingCoachId(coach.getId());
        conv.setControllingCoachName(coach.getFirstName() + " " + coach.getLastName());

        // Link to onboarding if exists
        if (tenant.getOnboardingProject() != null) {
            UUID onboardingId = tenant.getOnboardingProject().getId();
            if (onboardingRepository.existsById(onboardingId)) {
                conv.setOnboardingId(onboardingId);
            }
        }

        Conversation saved = conversationRepository.save(conv);

        // 4. Send welcome message
        String memberFirst = member.getFirstName() != null ? member.getFirstName() : "there";
        String welcomeText = "Hi " + memberFirst + "! I'm " + coachPrincipal.getFullName()
                + ". How can I help you today?";
        ChatMessage welcomeMsg = createMessage(saved, MessageSender.COACH,
                coachPrincipal.id(), coachPrincipal.getFullName(),
                coach.getAvatarUrl(), welcomeText);
        saved.setLastMessageAt(welcomeMsg.getCreatedAt());
        saved.setLastMessagePreview(truncate(welcomeText, 300));
        conversationRepository.save(saved);

        // 5. Notify member via WebSocket (personal queue)
        var eventPayload = new java.util.HashMap<String, Object>();
        eventPayload.put("type", "COACH_INITIATED");
        eventPayload.put("conversationId", saved.getId().toString());
        eventPayload.put("coachName", coachPrincipal.getFullName());
        eventPayload.put("coachAvatarUrl", coach.getAvatarUrl() != null ? coach.getAvatarUrl() : "");
        sendToUser(memberId, "chat.events", eventPayload);
        sendToUser(memberId, "chat.messages", toMsgMap(welcomeMsg));

        // 6. Bell notification for member
        if (notificationService != null) {
            notificationService.notifyCoachInitiatedConversation(
                    memberId, tenantId, saved.getId(), coachPrincipal.getFullName());
        }

        // 7. Broadcast to coach dashboard
        broadcastDashboardUpdate("NEW_CONVERSATION", saved);

        return saved;
    }

    @Transactional(readOnly = true)
    public List<Conversation> getMemberConversations(UUID memberId) {
        return conversationRepository.findByMemberIdOrderByLastMessageAtDesc(memberId);
    }

    @Transactional(readOnly = true)
    public List<Conversation> getCoachConversations(UserPrincipal coachPrincipal) {
        List<UUID> visibleTenantIds = visibleTenantIds(coachPrincipal);
        return conversationRepository.findByTenantIdInOrderByLastMessageAtDesc(visibleTenantIds);
    }

    @Transactional(readOnly = true)
    public Page<ChatMessage> getMessages(UUID conversationId, Pageable pageable) {
        return chatMessageRepository.findByConversationIdOrderByCreatedAtAsc(conversationId, pageable);
    }

    /* ------------------------------------------------------------------ */
    /*  Messaging                                                          */
    /* ------------------------------------------------------------------ */

    @Transactional
    public ChatMessage sendMemberMessage(UUID conversationId, UserPrincipal memberPrincipal, String content) {
        Conversation conv = conversationRepository.findById(conversationId)
                .orElseThrow(() -> new IllegalArgumentException("Conversation not found"));

        // Authorization: member must own this conversation
        if (!conv.getMemberId().equals(memberPrincipal.id())) {
            throw new AccessDeniedException("Not your conversation");
        }

        String avatarUrl = userRepository.findById(memberPrincipal.id())
                .map(User::getAvatarUrl).orElse(null);
        ChatMessage msg = createMessage(conv, MessageSender.MEMBER,
                memberPrincipal.id(), memberPrincipal.getFullName(), avatarUrl, content);

        // Update conversation metadata via entity (stays consistent with @Version)
        conv.setLastMessageAt(msg.getCreatedAt());
        conv.setLastMessagePreview(truncate(content, 300));
        conv.setUnreadCoachCount(conv.getUnreadCoachCount() + 1);
        conversationRepository.save(conv);

        // Broadcast to spectators (topic)
        broadcastToConversation(conversationId, toMsgMap(msg));

        // If mode is HUMAN, also send to controlling coach's personal queue
        if (conv.getMode() == ChatMode.HUMAN && conv.getControllingCoachId() != null) {
            sendToUser(conv.getControllingCoachId(), "chat.messages", toMsgMap(msg));
        }

        // Notify coach dashboard of activity (scoped to tenant)
        broadcastDashboardUpdate("MESSAGE", conv);

        // @mention check — notify the coach if mentioned
        UUID coachId = conv.getControllingCoachId() != null
                ? conv.getControllingCoachId() : conv.getAssignedCoachId();
        String coachName = conv.getControllingCoachName() != null
                ? conv.getControllingCoachName() : conv.getAssignedCoachName();
        notifyIfMentioned(content, coachId, coachName,
                conv.getTenantId(), conversationId, memberPrincipal.getFullName());

        return msg;
    }

    @Transactional
    public ChatMessage sendCoachMessage(UUID conversationId, UserPrincipal coachPrincipal, String content) {
        Conversation conv = conversationRepository.findById(conversationId)
                .orElseThrow(() -> new IllegalArgumentException("Conversation not found"));

        // Authorization: coach must have tenant-level access
        assertCoachCanAccess(conversationId, coachPrincipal);

        if (conv.getMode() != ChatMode.HUMAN || !coachPrincipal.id().equals(conv.getControllingCoachId())) {
            throw new IllegalStateException("Coach must take over before sending messages");
        }

        String coachAvatarUrl = userRepository.findById(coachPrincipal.id())
                .map(User::getAvatarUrl).orElse(null);
        ChatMessage msg = createMessage(conv, MessageSender.COACH,
                coachPrincipal.id(), coachPrincipal.getFullName(), coachAvatarUrl, content);

        // Update conversation metadata via entity (stays consistent with @Version)
        conv.setLastMessageAt(msg.getCreatedAt());
        conv.setLastMessagePreview(truncate(content, 300));
        conv.setUnreadMemberCount(conv.getUnreadMemberCount() + 1);
        conversationRepository.save(conv);

        // Send to member's personal queue
        sendToUser(conv.getMemberId(), "chat.messages", toMsgMap(msg));

        // Broadcast to spectators (topic)
        broadcastToConversation(conversationId, toMsgMap(msg));

        broadcastDashboardUpdate("MESSAGE", conv);

        // @mention check — notify the member if mentioned
        notifyIfMentioned(content, conv.getMemberId(), conv.getMemberName(),
                conv.getTenantId(), conversationId, coachPrincipal.getFullName());

        return msg;
    }

    @Transactional
    public ChatMessage sendMemberFileMessage(UUID conversationId, UserPrincipal memberPrincipal,
                                              String content, Map<String, Object> metadata) {
        Conversation conv = conversationRepository.findById(conversationId)
                .orElseThrow(() -> new IllegalArgumentException("Conversation not found"));

        if (!conv.getMemberId().equals(memberPrincipal.id())) {
            throw new AccessDeniedException("Not your conversation");
        }

        String avatarUrl = userRepository.findById(memberPrincipal.id())
                .map(User::getAvatarUrl).orElse(null);
        ChatMessage msg = createMessage(conv, MessageSender.MEMBER,
                memberPrincipal.id(), memberPrincipal.getFullName(), avatarUrl, content);
        msg.setMetadata(metadata);
        msg = chatMessageRepository.save(msg);

        conv.setLastMessageAt(msg.getCreatedAt());
        conv.setLastMessagePreview(truncate(content, 300));
        conv.setUnreadCoachCount(conv.getUnreadCoachCount() + 1);
        conversationRepository.save(conv);

        broadcastToConversation(conversationId, toMsgMap(msg));
        if (conv.getMode() == ChatMode.HUMAN && conv.getControllingCoachId() != null) {
            sendToUser(conv.getControllingCoachId(), "chat.messages", toMsgMap(msg));
        }
        broadcastDashboardUpdate("MESSAGE", conv);

        // @mention check — notify the coach if mentioned in file caption
        UUID coachId = conv.getControllingCoachId() != null
                ? conv.getControllingCoachId() : conv.getAssignedCoachId();
        String coachName = conv.getControllingCoachName() != null
                ? conv.getControllingCoachName() : conv.getAssignedCoachName();
        notifyIfMentioned(content, coachId, coachName,
                conv.getTenantId(), conversationId, memberPrincipal.getFullName());

        if (notificationService != null) {
            if (coachId != null) {
                UUID tid = conv.getTenantId() != null ? conv.getTenantId() : conv.getTenant().getId();
                notificationService.notifyFileShared(coachId, tid,
                        conversationId, memberPrincipal.getFullName(), extractFilename(metadata));
            }
        }

        return msg;
    }

    @Transactional
    public ChatMessage sendCoachFileMessage(UUID conversationId, UserPrincipal coachPrincipal,
                                             String content, Map<String, Object> metadata) {
        Conversation conv = conversationRepository.findById(conversationId)
                .orElseThrow(() -> new IllegalArgumentException("Conversation not found"));

        assertCoachCanAccess(conversationId, coachPrincipal);

        if (conv.getMode() != ChatMode.HUMAN || !coachPrincipal.id().equals(conv.getControllingCoachId())) {
            throw new IllegalStateException("Coach must take over before sending messages");
        }

        String coachAvatarUrl = userRepository.findById(coachPrincipal.id())
                .map(User::getAvatarUrl).orElse(null);
        ChatMessage msg = createMessage(conv, MessageSender.COACH,
                coachPrincipal.id(), coachPrincipal.getFullName(), coachAvatarUrl, content);
        msg.setMetadata(metadata);
        msg = chatMessageRepository.save(msg);

        conv.setLastMessageAt(msg.getCreatedAt());
        conv.setLastMessagePreview(truncate(content, 300));
        conv.setUnreadMemberCount(conv.getUnreadMemberCount() + 1);
        conversationRepository.save(conv);

        sendToUser(conv.getMemberId(), "chat.messages", toMsgMap(msg));
        broadcastToConversation(conversationId, toMsgMap(msg));
        broadcastDashboardUpdate("MESSAGE", conv);

        // @mention check — notify the member if mentioned in file caption
        notifyIfMentioned(content, conv.getMemberId(), conv.getMemberName(),
                conv.getTenantId(), conversationId, coachPrincipal.getFullName());

        if (notificationService != null) {
            UUID tid = conv.getTenantId() != null ? conv.getTenantId() : conv.getTenant().getId();
            notificationService.notifyFileShared(conv.getMemberId(), tid,
                    conversationId, coachPrincipal.getFullName(), extractFilename(metadata));
        }

        return msg;
    }

    /* ------------------------------------------------------------------ */
    /*  Takeover & Release                                                 */
    /* ------------------------------------------------------------------ */

    @Transactional
    public Conversation takeover(UUID conversationId, UserPrincipal coachPrincipal) {
        Conversation conv = conversationRepository.findById(conversationId)
                .orElseThrow(() -> new IllegalArgumentException("Conversation not found"));

        // Authorization: coach must have visibility
        assertCoachCanAccess(conversationId, coachPrincipal);

        if (conv.getMode() == ChatMode.HUMAN && conv.getControllingCoachId() != null
                && !conv.getControllingCoachId().equals(coachPrincipal.id())) {
            throw new IllegalStateException("Conversation is already controlled by another coach");
        }

        User coach = userRepository.findById(coachPrincipal.id())
                .orElseThrow(() -> new IllegalArgumentException("Coach not found"));

        conv.setMode(ChatMode.HUMAN);
        conv.setControllingCoach(coach);
        conv.setControllingCoachId(coach.getId());
        conv.setControllingCoachName(coach.getFirstName() + " " + coach.getLastName());
        conv.setHelpRequested(false);
        // @Version handles optimistic locking — concurrent takeover throws OptimisticLockException
        conv = conversationRepository.save(conv);

        // System message — push to member so it appears immediately
        ChatMessage sysMsg = createMessage(conv, MessageSender.SYSTEM, null,
                coachPrincipal.getFullName(), null,
                coachPrincipal.getFullName() + " has joined the conversation.");
        sendToUser(conv.getMemberId(), "chat.messages", toMsgMap(sysMsg));

        // Coach welcome message — only once per day per conversation to avoid repetition
        String coachAvatarUrl = coach.getAvatarUrl();
        Instant startOfDay = java.time.LocalDate.now().atStartOfDay(java.time.ZoneOffset.UTC).toInstant();
        boolean alreadyMessaged = chatMessageRepository
                .existsByConversationIdAndSenderIdAndSenderTypeAndCreatedAtAfter(
                        conversationId, coachPrincipal.id(), MessageSender.COACH, startOfDay);
        if (!alreadyMessaged) {
            String memberFirst = conv.getMemberName() != null
                    ? conv.getMemberName().split(" ")[0] : "there";
            String welcomeText = "Hi " + memberFirst + "! I'm " + coachPrincipal.getFullName()
                    + ". How can I help you today?";
            ChatMessage welcomeMsg = createMessage(conv, MessageSender.COACH,
                    coachPrincipal.id(), coachPrincipal.getFullName(), coachAvatarUrl, welcomeText);
            conv.setLastMessageAt(welcomeMsg.getCreatedAt());
            conv.setLastMessagePreview(truncate(welcomeText, 300));
            conversationRepository.save(conv);
            sendToUser(conv.getMemberId(), "chat.messages", toMsgMap(welcomeMsg));
            broadcastToConversation(conversationId, toMsgMap(welcomeMsg));
        }

        // Notify member (include avatar URL so chat header can show coach's picture)
        var modePayload = new java.util.HashMap<String, Object>();
        modePayload.put("type", "MODE_CHANGE");
        modePayload.put("conversationId", conversationId.toString());
        modePayload.put("mode", "HUMAN");
        modePayload.put("coachId", coachPrincipal.id().toString());
        modePayload.put("coachName", coachPrincipal.getFullName());
        if (coachAvatarUrl != null) modePayload.put("coachAvatarUrl", coachAvatarUrl);
        sendToUser(conv.getMemberId(), "chat.events", modePayload);

        // Notify spectators
        broadcastToConversation(conversationId, Map.of(
                "type", "MODE_CHANGE",
                "mode", "HUMAN",
                "coachName", coachPrincipal.getFullName()
        ));

        broadcastDashboardUpdate("TAKEOVER", conv);

        return conv;
    }

    @Transactional
    public Conversation release(UUID conversationId, UserPrincipal coachPrincipal) {
        Conversation conv = conversationRepository.findById(conversationId)
                .orElseThrow(() -> new IllegalArgumentException("Conversation not found"));

        if (conv.getControllingCoachId() == null || !coachPrincipal.id().equals(conv.getControllingCoachId())) {
            throw new IllegalStateException("Only the controlling coach can release");
        }

        conv.setMode(ChatMode.AI);
        conv.setControllingCoach(null);
        conv.setControllingCoachId(null);
        conv.setControllingCoachName(null);
        conv = conversationRepository.save(conv);

        // System message — push to member so it appears immediately
        ChatMessage sysMsg = createMessage(conv, MessageSender.SYSTEM, null,
                coachPrincipal.getFullName(), null,
                coachPrincipal.getFullName() + " has left the conversation. You are now chatting with your AI assistant.");
        sendToUser(conv.getMemberId(), "chat.messages", toMsgMap(sysMsg));

        // Notify member
        sendToUser(conv.getMemberId(), "chat.events", Map.of(
                "type", "MODE_CHANGE",
                "conversationId", conversationId.toString(),
                "mode", "AI"
        ));

        // Notify spectators
        broadcastToConversation(conversationId, Map.of(
                "type", "MODE_CHANGE",
                "mode", "AI"
        ));

        broadcastDashboardUpdate("RELEASE", conv);

        return conv;
    }

    /* ------------------------------------------------------------------ */
    /*  Help Request                                                       */
    /* ------------------------------------------------------------------ */

    @Transactional
    public Conversation requestHelp(UUID conversationId) {
        Conversation conv = conversationRepository.findById(conversationId)
                .orElseThrow(() -> new IllegalArgumentException("Conversation not found"));

        conv.setHelpRequested(true);
        conv = conversationRepository.save(conv);

        // System message — also push to member so it appears immediately
        ChatMessage sysMsg = createMessage(conv, MessageSender.SYSTEM, null, "System", null,
                "Help has been requested. A coach will join shortly.");
        sendToUser(conv.getMemberId() != null ? conv.getMemberId() : conv.getMember().getId(),
                "chat.messages", toMsgMap(sysMsg));

        broadcastDashboardUpdate("HELP_REQUEST", conv);

        // Bell notification so coaches see it even when not on the chat dashboard
        if (notificationService != null) {
            String memberName = conv.getMemberName() != null ? conv.getMemberName() : "A member";
            UUID tenantId = conv.getTenantId() != null ? conv.getTenantId() : conv.getTenant().getId();
            notificationService.notifyHelpRequested(
                    conv.getAssignedCoachId(), tenantId,
                    conversationId, memberName);
        }

        return conv;
    }

    /* ------------------------------------------------------------------ */
    /*  System Messages (used by PhaseGateService for gate transitions)     */
    /* ------------------------------------------------------------------ */

    @Transactional
    public void sendSystemMessage(UUID conversationId, String content) {
        Conversation conv = conversationRepository.findById(conversationId)
                .orElse(null);
        if (conv == null) return;

        ChatMessage sysMsg = createMessage(conv, MessageSender.SYSTEM, null, "System", null, content);

        conv.setLastMessageAt(sysMsg.getCreatedAt());
        conv.setLastMessagePreview(truncate(content, 300));
        conversationRepository.save(conv);

        sendToUser(conv.getMemberId(), "chat.messages", toMsgMap(sysMsg));
        broadcastToConversation(conversationId, toMsgMap(sysMsg));
        broadcastDashboardUpdate("MESSAGE", conv);
    }

    @Transactional(readOnly = true)
    public UUID findConversationIdForOnboarding(UUID onboardingId) {
        return conversationRepository
                .findFirstByOnboardingIdAndStatus(onboardingId, ConversationStatus.ACTIVE)
                .map(Conversation::getId)
                .orElse(null);
    }

    /* ------------------------------------------------------------------ */
    /*  Read Receipts                                                       */
    /* ------------------------------------------------------------------ */

    @Transactional
    public void markRead(UUID conversationId, UserPrincipal principal) {
        Conversation conv = conversationRepository.findById(conversationId)
                .orElseThrow(() -> new IllegalArgumentException("Conversation not found"));

        // Authorization: must be the member or a coach with visibility
        if (principal.isPlatformUser()) {
            assertCoachCanAccess(conversationId, principal);
            conv.setUnreadCoachCount(0);
        } else {
            if (!conv.getMemberId().equals(principal.id())) {
                throw new AccessDeniedException("Not your conversation");
            }
            conv.setUnreadMemberCount(0);
        }
        conversationRepository.save(conv);
    }

    /* ------------------------------------------------------------------ */
    /*  Coach Dashboard Stats                                              */
    /* ------------------------------------------------------------------ */

    @Transactional(readOnly = true)
    public Map<String, Object> getCoachDashboardStats(UserPrincipal coachPrincipal) {
        List<UUID> tenantIds = visibleTenantIds(coachPrincipal);

        long activeChats = conversationRepository.countByTenantIdInAndStatus(
                tenantIds, ConversationStatus.ACTIVE);
        long helpRequests = conversationRepository.countByTenantIdInAndHelpRequestedTrue(tenantIds);
        long sentimentAlerts = conversationRepository.countByTenantIdInAndSentimentScoreLessThan(
                tenantIds, 0.4);

        return Map.of(
                "activeChats", activeChats,
                "helpRequests", helpRequests,
                "sentimentAlerts", sentimentAlerts,
                "visibleTenantIds", tenantIds.stream().map(UUID::toString).toList()
        );
    }

    /* ------------------------------------------------------------------ */
    /*  Private helpers                                                     */
    /* ------------------------------------------------------------------ */

    private ChatMessage createMessage(Conversation conv, MessageSender senderType,
                                       UUID senderId, String senderName,
                                       String senderAvatarUrl, String content) {
        ChatMessage msg = new ChatMessage();
        msg.setConversation(conv);
        msg.setSenderType(senderType);
        msg.setSenderId(senderId);
        msg.setSenderName(senderName);
        msg.setSenderAvatarUrl(senderAvatarUrl);
        msg.setContent(content);
        return chatMessageRepository.save(msg);
    }

    private UUID resolvePrimaryCoach(UUID tenantId) {
        // 1. Check Onboarding.assignedTo
        var onboarding = onboardingRepository.findByTenantId(tenantId);
        if (onboarding.isPresent() && onboarding.get().getAssignedToId() != null) {
            return onboarding.get().getAssignedToId();
        }

        // 2. Check PlatformAssignment — pick first active coach
        var assignments = assignmentRepository.findByTenantIdAndActiveTrue(tenantId);
        if (!assignments.isEmpty()) {
            return assignments.get(0).getPlatformUser().getId();
        }

        // 3. No specific assignment — will be open to all coaches
        return null;
    }

    private List<UUID> visibleTenantIds(UserPrincipal principal) {
        if (principal.isPlatformAdmin() || principal.isCoachAdmin()) {
            return tenantRepository.findByTenantType(TenantType.CUSTOMER)
                    .stream().map(Tenant::getId).toList();
        }
        List<UUID> assigned = assignmentRepository.findByPlatformUserIdAndActiveTrue(principal.id())
                .stream().map(a -> a.getTenant().getId()).toList();
        List<UUID> openToAll = tenantRepository.findByOpenToAllCoachesTrue()
                .stream().map(Tenant::getId).toList();
        return Stream.concat(assigned.stream(), openToAll.stream())
                .distinct().toList();
    }

    private void sendToUser(UUID userId, String destination, Object payload) {
        // Principal name is the user's email (UserPrincipal.getUsername()),
        // so we must resolve UUID → email for convertAndSendToUser to match.
        userRepository.findById(userId).ifPresent(user ->
                messagingTemplate.convertAndSendToUser(
                        user.getEmail(), "/queue/" + destination, payload));
    }

    private void broadcastToConversation(UUID conversationId, Object payload) {
        messagingTemplate.convertAndSend(
                "/topic/chat." + conversationId, payload);
    }

    /** Broadcast to per-tenant dashboard topic instead of global topic to prevent data leak. */
    private void broadcastDashboardUpdate(String eventType, Conversation conv) {
        // Use tenant relation ID as fallback — the read-only tenantId column
        // may be null on freshly persisted entities before a flush.
        UUID tid = conv.getTenantId() != null ? conv.getTenantId() : conv.getTenant().getId();
        UUID mid = conv.getMemberId() != null ? conv.getMemberId() : conv.getMember().getId();
        messagingTemplate.convertAndSend("/topic/chat.dashboard." + tid, Map.of(
                "type", eventType,
                "conversationId", conv.getId().toString(),
                "tenantId", tid.toString(),
                "memberId", mid.toString(),
                "mode", conv.getMode().name(),
                "helpRequested", conv.isHelpRequested(),
                "lastMessagePreview", conv.getLastMessagePreview() != null ? conv.getLastMessagePreview() : "",
                "lastMessageAt", conv.getLastMessageAt() != null ? conv.getLastMessageAt().toString() : ""
        ));
    }

    private static final Pattern MENTION_PATTERN = Pattern.compile("@(\\w+)");

    /**
     * Checks if the message content contains a @mention matching the given participant's first name.
     * If so, fires an async mention notification.
     */
    private void notifyIfMentioned(String content, UUID recipientId, String recipientFullName,
                                    UUID tenantId, UUID conversationId, String senderName) {
        if (notificationService == null || content == null || recipientFullName == null) return;
        String firstName = recipientFullName.split("\\s+")[0];
        Matcher m = MENTION_PATTERN.matcher(content);
        while (m.find()) {
            if (m.group(1).equalsIgnoreCase(firstName)) {
                notificationService.notifyMention(recipientId, tenantId, conversationId, senderName, content);
                return; // one notification per message even if mentioned twice
            }
        }
    }

    /** Safely extracts the filename from a file-message metadata map. */
    private String extractFilename(Map<String, Object> metadata) {
        try {
            Object fa = metadata.get("fileAttachment");
            if (fa instanceof Map<?, ?> map) return String.valueOf(map.get("filename"));
        } catch (Exception ignored) {}
        return "a file";
    }

    private Map<String, Object> toMsgMap(ChatMessage m) {
        var map = new java.util.HashMap<String, Object>();
        map.put("id", m.getId().toString());
        UUID cid = m.getConversationId() != null ? m.getConversationId() : m.getConversation().getId();
        map.put("conversationId", cid.toString());
        map.put("senderType", m.getSenderType().name());
        map.put("senderId", m.getSenderId() != null ? m.getSenderId().toString() : "");
        map.put("senderName", m.getSenderName() != null ? m.getSenderName() : "");
        map.put("senderAvatarUrl", m.getSenderAvatarUrl());
        map.put("content", m.getContent());
        map.put("createdAt", m.getCreatedAt() != null ? m.getCreatedAt().toString() : "");
        if (m.getMetadata() != null) {
            map.put("metadata", m.getMetadata());
        }
        return map;
    }

    private String truncate(String s, int max) {
        if (s == null) return "";
        return s.length() <= max ? s : s.substring(0, max - 3) + "...";
    }
}
