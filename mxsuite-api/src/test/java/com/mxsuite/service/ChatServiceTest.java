package com.mxsuite.service;

import com.mxsuite.model.ChatMessage;
import com.mxsuite.model.Conversation;
import com.mxsuite.model.Tenant;
import com.mxsuite.model.User;
import com.mxsuite.model.enums.ChatMode;
import com.mxsuite.model.enums.MessageSender;
import com.mxsuite.model.enums.TenantType;
import com.mxsuite.model.enums.UserRole;
import com.mxsuite.repository.ChatMessageRepository;
import com.mxsuite.repository.ConversationRepository;
import com.mxsuite.repository.OnboardingRepository;
import com.mxsuite.repository.PlatformAssignmentRepository;
import com.mxsuite.repository.TenantRepository;
import com.mxsuite.repository.UserRepository;
import com.mxsuite.security.UserPrincipal;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.*;

/**
 * Unit tests for {@link ChatService}.
 *
 * All dependencies are mocked — no Spring context or database needed.
 * Tests cover: takeover (MODE_CHANGE event payload, coachId field, concurrent-coach guard),
 * release (MODE_CHANGE AI event, controllingCoachId cleared), coach messaging guards,
 * and file-share notification calls.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
@DisplayName("ChatService")
class ChatServiceTest {

    @Mock ConversationRepository       conversationRepository;
    @Mock ChatMessageRepository        chatMessageRepository;
    @Mock UserRepository               userRepository;
    @Mock TenantRepository             tenantRepository;
    @Mock PlatformAssignmentRepository assignmentRepository;
    @Mock OnboardingRepository         onboardingRepository;
    @Mock SimpMessagingTemplate        messagingTemplate;
    @Mock NotificationService          notificationService;

    @InjectMocks ChatService service;

    // ── Shared UUIDs ─────────────────────────────────────────────────────────

    static final UUID TENANT_ID   = UUID.fromString("aaaa0000-0000-0000-0000-000000000001");
    static final UUID MEMBER_ID   = UUID.fromString("bbbb0000-0000-0000-0000-000000000001");
    static final UUID COACH_ID    = UUID.fromString("cccc0000-0000-0000-0000-000000000001");
    static final UUID OTHER_COACH = UUID.fromString("dddd0000-0000-0000-0000-000000000001");
    static final UUID CONV_ID     = UUID.fromString("eeee0000-0000-0000-0000-000000000001");

    static final String COACH_FULL_NAME = "Test User";
    static final String MEMBER_EMAIL = "member@test.com";
    static final String COACH_EMAIL  = "coach@test.com";

    // ── Fixtures ─────────────────────────────────────────────────────────────

    Tenant       tenant;
    Conversation aiConversation;
    Conversation humanConversation;
    User         coachUser;
    User         memberUser;

    UserPrincipal coachPrincipal;
    UserPrincipal memberPrincipal;

    @BeforeEach
    void setUp() {
        tenant = new Tenant();
        tenant.setId(TENANT_ID);
        tenant.setTenantType(TenantType.CUSTOMER);

        aiConversation = new Conversation();
        aiConversation.setId(CONV_ID);
        aiConversation.setMode(ChatMode.AI);
        aiConversation.setMemberId(MEMBER_ID);
        aiConversation.setMemberName("Alice Member");
        aiConversation.setTenantId(TENANT_ID);
        aiConversation.setTenant(tenant);
        aiConversation.setAssignedCoachId(COACH_ID);

        humanConversation = new Conversation();
        humanConversation.setId(CONV_ID);
        humanConversation.setMode(ChatMode.HUMAN);
        humanConversation.setMemberId(MEMBER_ID);
        humanConversation.setMemberName("Alice Member");
        humanConversation.setTenantId(TENANT_ID);
        humanConversation.setTenant(tenant);
        humanConversation.setControllingCoachId(COACH_ID);
        humanConversation.setControllingCoachName(COACH_FULL_NAME);

        coachUser = new User();
        coachUser.setId(COACH_ID);
        coachUser.setEmail(COACH_EMAIL);
        coachUser.setFirstName("Test");
        coachUser.setLastName("User");

        memberUser = new User();
        memberUser.setId(MEMBER_ID);
        memberUser.setEmail(MEMBER_EMAIL);
        memberUser.setFirstName("Alice");
        memberUser.setLastName("Member");

        coachPrincipal = new UserPrincipal(COACH_ID, COACH_EMAIL, "Test", "User",
                null, UserRole.COACH_ADMIN, TENANT_ID, true);
        memberPrincipal = new UserPrincipal(MEMBER_ID, MEMBER_EMAIL, "Alice", "Member",
                null, UserRole.TENANT_USER, TENANT_ID, true);

        // Global stubs for sendToUser's email resolution
        when(userRepository.findById(MEMBER_ID)).thenReturn(Optional.of(memberUser));
        when(userRepository.findById(COACH_ID)).thenReturn(Optional.of(coachUser));

        // Inject the optional NotificationService (normally done by Spring)
        service.setNotificationService(notificationService);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private void stubConversation(Conversation conv) {
        when(conversationRepository.findById(CONV_ID)).thenReturn(Optional.of(conv));
    }

    /** Makes COACH_ADMIN visible to all CUSTOMER tenants. */
    private void stubCoachVisibility() {
        when(tenantRepository.findByTenantType(TenantType.CUSTOMER)).thenReturn(List.of(tenant));
    }

    private void stubSave() {
        when(conversationRepository.save(any())).thenAnswer(i -> i.getArgument(0));
    }

    /**
     * Returns the argument so the saved ChatMessage keeps its conversation reference.
     * Assigns a random ID to satisfy toMsgMap()'s getId() call.
     */
    private void stubMessageSave() {
        when(chatMessageRepository.save(any(ChatMessage.class))).thenAnswer(inv -> {
            ChatMessage m = inv.getArgument(0);
            if (m.getId() == null) m.setId(UUID.randomUUID());
            return m;
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Takeover
    // ─────────────────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("takeover()")
    class Takeover {

        @Test
        @DisplayName("MODE_CHANGE event sent to member includes coachId and coachName")
        void notifiesMember_withCoachIdAndCoachName() {
            stubConversation(aiConversation);
            stubCoachVisibility();
            stubSave();
            stubMessageSave();
            when(userRepository.findById(COACH_ID)).thenReturn(Optional.of(coachUser));

            service.takeover(CONV_ID, coachPrincipal);

            @SuppressWarnings("unchecked")
            ArgumentCaptor<Map<String, Object>> captor = ArgumentCaptor.forClass(Map.class);
            verify(messagingTemplate).convertAndSendToUser(
                    eq(MEMBER_EMAIL), eq("/queue/chat.events"), captor.capture());

            Map<String, Object> payload = captor.getValue();
            assertThat(payload)
                    .containsEntry("type", "MODE_CHANGE")
                    .containsEntry("mode", "HUMAN")
                    .containsEntry("coachId", COACH_ID.toString())
                    .containsEntry("coachName", COACH_FULL_NAME)
                    .containsKey("conversationId");
        }

        @Test
        @DisplayName("conversation mode is set to HUMAN and helpRequested is cleared")
        void setsHumanMode_andClearsHelpRequested() {
            aiConversation.setHelpRequested(true);
            stubConversation(aiConversation);
            stubCoachVisibility();
            stubSave();
            stubMessageSave();
            when(userRepository.findById(COACH_ID)).thenReturn(Optional.of(coachUser));

            service.takeover(CONV_ID, coachPrincipal);

            ArgumentCaptor<Conversation> savedConv = ArgumentCaptor.forClass(Conversation.class);
            verify(conversationRepository, atLeastOnce()).save(savedConv.capture());
            Conversation saved = savedConv.getAllValues().stream()
                    .filter(c -> c.getMode() == ChatMode.HUMAN)
                    .findFirst()
                    .orElseThrow(() -> new AssertionError("No HUMAN-mode save found"));
            assertThat(saved.isHelpRequested()).isFalse();
            assertThat(saved.getControllingCoachName()).isEqualTo(COACH_FULL_NAME);
        }

        @Test
        @DisplayName("system message and coach welcome message are both persisted")
        void persistsSystemAndWelcomeMessages() {
            stubConversation(aiConversation);
            stubCoachVisibility();
            stubSave();
            stubMessageSave();
            when(userRepository.findById(COACH_ID)).thenReturn(Optional.of(coachUser));

            service.takeover(CONV_ID, coachPrincipal);

            ArgumentCaptor<ChatMessage> msgCaptor = ArgumentCaptor.forClass(ChatMessage.class);
            verify(chatMessageRepository, times(2)).save(msgCaptor.capture());
            List<ChatMessage> saved = msgCaptor.getAllValues();
            assertThat(saved.get(0).getContent()).contains("has joined the conversation");
            assertThat(saved.get(1).getContent()).contains("How can I help you today?");
            assertThat(saved.get(1).getSenderType()).isEqualTo(com.mxsuite.model.enums.MessageSender.COACH);
        }

        @Test
        @DisplayName("throws IllegalStateException when another coach is already controlling")
        void throwsException_whenAnotherCoachIsControlling() {
            Conversation controlledByOther = new Conversation();
            controlledByOther.setId(CONV_ID);
            controlledByOther.setMode(ChatMode.HUMAN);
            controlledByOther.setMemberId(MEMBER_ID);
            controlledByOther.setTenantId(TENANT_ID);
            controlledByOther.setTenant(tenant);
            controlledByOther.setControllingCoachId(OTHER_COACH);

            stubConversation(controlledByOther);
            stubCoachVisibility();

            assertThatThrownBy(() -> service.takeover(CONV_ID, coachPrincipal))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("already controlled by another coach");
        }

        @Test
        @DisplayName("same coach can retake their own conversation without error")
        void allowsRetakeover_bySameCoach() {
            stubConversation(humanConversation);
            stubCoachVisibility();
            stubSave();
            stubMessageSave();
            when(userRepository.findById(COACH_ID)).thenReturn(Optional.of(coachUser));

            service.takeover(CONV_ID, coachPrincipal); // should not throw
        }

        @Test
        @DisplayName("system and welcome messages are pushed to member via WebSocket")
        void systemAndWelcomeMessages_arePushedToMember() {
            stubConversation(aiConversation);
            stubCoachVisibility();
            stubSave();
            stubMessageSave();
            when(userRepository.findById(COACH_ID)).thenReturn(Optional.of(coachUser));

            service.takeover(CONV_ID, coachPrincipal);

            // System message + welcome message = 2 calls to /queue/chat.messages
            // Plus 1 call to /queue/chat.events for MODE_CHANGE
            verify(messagingTemplate, times(2)).convertAndSendToUser(
                    eq(MEMBER_EMAIL), eq("/queue/chat.messages"), any(Map.class));
        }

        @Test
        @DisplayName("welcome message is skipped when coach already messaged today")
        void skipsWelcome_whenCoachAlreadyMessagedToday() {
            stubConversation(aiConversation);
            stubCoachVisibility();
            stubSave();
            stubMessageSave();
            when(userRepository.findById(COACH_ID)).thenReturn(Optional.of(coachUser));
            when(chatMessageRepository.existsByConversationIdAndSenderIdAndSenderTypeAndCreatedAtAfter(
                    eq(CONV_ID), eq(COACH_ID), eq(MessageSender.COACH), any())).thenReturn(true);

            service.takeover(CONV_ID, coachPrincipal);

            // Only system message persisted — no welcome
            ArgumentCaptor<ChatMessage> msgCaptor = ArgumentCaptor.forClass(ChatMessage.class);
            verify(chatMessageRepository, times(1)).save(msgCaptor.capture());
            assertThat(msgCaptor.getValue().getContent()).contains("has joined the conversation");

            // Only 1 call to /queue/chat.messages (system msg), not 2
            verify(messagingTemplate, times(1)).convertAndSendToUser(
                    eq(MEMBER_EMAIL), eq("/queue/chat.messages"), any(Map.class));
        }

        @Test
        @DisplayName("MODE_CHANGE event includes coachAvatarUrl when coach has one")
        void modeChangeEvent_includesCoachAvatarUrl() {
            coachUser.setAvatarUrl("/avatars/test-coach.svg");
            stubConversation(aiConversation);
            stubCoachVisibility();
            stubSave();
            stubMessageSave();
            when(userRepository.findById(COACH_ID)).thenReturn(Optional.of(coachUser));

            service.takeover(CONV_ID, coachPrincipal);

            @SuppressWarnings("unchecked")
            ArgumentCaptor<Map<String, Object>> captor = ArgumentCaptor.forClass(Map.class);
            verify(messagingTemplate).convertAndSendToUser(
                    eq(MEMBER_EMAIL), eq("/queue/chat.events"), captor.capture());

            assertThat(captor.getValue()).containsEntry("coachAvatarUrl", "/avatars/test-coach.svg");
        }

        @Test
        @DisplayName("MODE_CHANGE event omits coachAvatarUrl when coach has none")
        void modeChangeEvent_omitsAvatarUrl_whenNull() {
            coachUser.setAvatarUrl(null);
            stubConversation(aiConversation);
            stubCoachVisibility();
            stubSave();
            stubMessageSave();
            when(userRepository.findById(COACH_ID)).thenReturn(Optional.of(coachUser));

            service.takeover(CONV_ID, coachPrincipal);

            @SuppressWarnings("unchecked")
            ArgumentCaptor<Map<String, Object>> captor = ArgumentCaptor.forClass(Map.class);
            verify(messagingTemplate).convertAndSendToUser(
                    eq(MEMBER_EMAIL), eq("/queue/chat.events"), captor.capture());

            assertThat(captor.getValue()).doesNotContainKey("coachAvatarUrl");
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Release
    // ─────────────────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("release()")
    class Release {

        @Test
        @DisplayName("MODE_CHANGE event sent to member with mode=AI")
        void notifiesMember_withAIMode() {
            stubConversation(humanConversation);
            stubSave();
            stubMessageSave();

            service.release(CONV_ID, coachPrincipal);

            @SuppressWarnings("unchecked")
            ArgumentCaptor<Map<String, Object>> captor = ArgumentCaptor.forClass(Map.class);
            verify(messagingTemplate).convertAndSendToUser(
                    eq(MEMBER_EMAIL), eq("/queue/chat.events"), captor.capture());

            Map<String, Object> payload = captor.getValue();
            assertThat(payload)
                    .containsEntry("type", "MODE_CHANGE")
                    .containsEntry("mode", "AI");
        }

        @Test
        @DisplayName("conversation mode reset to AI and controllingCoachId cleared")
        void resetsToAIMode_andClearsControllingCoachId() {
            stubConversation(humanConversation);
            stubSave();
            stubMessageSave();

            service.release(CONV_ID, coachPrincipal);

            ArgumentCaptor<Conversation> savedConv = ArgumentCaptor.forClass(Conversation.class);
            verify(conversationRepository, atLeastOnce()).save(savedConv.capture());
            Conversation saved = savedConv.getAllValues().stream()
                    .filter(c -> c.getMode() == ChatMode.AI)
                    .findFirst()
                    .orElseThrow(() -> new AssertionError("No AI-mode save found"));
            assertThat(saved.getControllingCoachId()).isNull();
            assertThat(saved.getControllingCoachName()).isNull();
        }

        @Test
        @DisplayName("throws IllegalStateException when caller is not the controlling coach")
        void throwsException_whenNotControllingCoach() {
            stubConversation(humanConversation);

            UserPrincipal otherCoach = new UserPrincipal(OTHER_COACH, "other@test.com",
                    "Other", "Coach", null, UserRole.COACH_ADMIN, TENANT_ID, true);

            assertThatThrownBy(() -> service.release(CONV_ID, otherCoach))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("Only the controlling coach can release");
        }

        @Test
        @DisplayName("system message is pushed to member via WebSocket (not just persisted)")
        void systemMessage_isPushedToMember() {
            stubConversation(humanConversation);
            stubSave();
            stubMessageSave();

            service.release(CONV_ID, coachPrincipal);

            verify(messagingTemplate).convertAndSendToUser(
                    eq(MEMBER_EMAIL), eq("/queue/chat.messages"), any(Map.class));
        }

        @Test
        @DisplayName("throws when controllingCoachId is null (no one is controlling)")
        void throwsException_whenControllingCoachIdIsNull() {
            Conversation noCoachConv = new Conversation();
            noCoachConv.setId(CONV_ID);
            noCoachConv.setMode(ChatMode.HUMAN);
            noCoachConv.setMemberId(MEMBER_ID);
            noCoachConv.setTenantId(TENANT_ID);
            noCoachConv.setControllingCoachId(null);
            stubConversation(noCoachConv);

            assertThatThrownBy(() -> service.release(CONV_ID, coachPrincipal))
                    .isInstanceOf(IllegalStateException.class);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Help Request
    // ─────────────────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("requestHelp()")
    class RequestHelp {

        @Test
        @DisplayName("sets helpRequested flag and persists system message")
        void setsHelpRequested_andPersistsSystemMessage() {
            stubConversation(aiConversation);
            stubSave();
            stubMessageSave();

            service.requestHelp(CONV_ID);

            ArgumentCaptor<Conversation> savedConv = ArgumentCaptor.forClass(Conversation.class);
            verify(conversationRepository, atLeastOnce()).save(savedConv.capture());
            assertThat(savedConv.getValue().isHelpRequested()).isTrue();

            ArgumentCaptor<ChatMessage> msgCaptor = ArgumentCaptor.forClass(ChatMessage.class);
            verify(chatMessageRepository).save(msgCaptor.capture());
            assertThat(msgCaptor.getValue().getContent()).contains("A coach will join shortly");
        }

        @Test
        @DisplayName("system message is pushed to member via WebSocket")
        void systemMessage_isPushedToMember() {
            stubConversation(aiConversation);
            stubSave();
            stubMessageSave();

            service.requestHelp(CONV_ID);

            verify(messagingTemplate).convertAndSendToUser(
                    eq(MEMBER_EMAIL), eq("/queue/chat.messages"), any(Map.class));
        }

        @Test
        @DisplayName("dashboard update is broadcast")
        void broadcastsDashboardUpdate() {
            stubConversation(aiConversation);
            stubSave();
            stubMessageSave();

            service.requestHelp(CONV_ID);

            verify(messagingTemplate).convertAndSend(
                    eq("/topic/chat.dashboard." + TENANT_ID), any(Map.class));
        }

        @Test
        @DisplayName("bell notification is sent to assigned coach via NotificationService")
        void notifiesAssignedCoach() {
            stubConversation(aiConversation);
            stubSave();
            stubMessageSave();

            service.requestHelp(CONV_ID);

            verify(notificationService).notifyHelpRequested(
                    eq(COACH_ID), eq(TENANT_ID), eq(CONV_ID), eq("Alice Member"));
        }

        @Test
        @DisplayName("uses member name 'A member' when memberName is null")
        void usesDefaultMemberName_whenNull() {
            aiConversation.setMemberName(null);
            stubConversation(aiConversation);
            stubSave();
            stubMessageSave();

            service.requestHelp(CONV_ID);

            verify(notificationService).notifyHelpRequested(
                    eq(COACH_ID), eq(TENANT_ID), eq(CONV_ID), eq("A member"));
        }

        @Test
        @DisplayName("passes null assignedCoachId when no coach is assigned")
        void passesNullCoachId_whenNoAssignedCoach() {
            aiConversation.setAssignedCoachId(null);
            stubConversation(aiConversation);
            stubSave();
            stubMessageSave();

            service.requestHelp(CONV_ID);

            verify(notificationService).notifyHelpRequested(
                    isNull(), eq(TENANT_ID), eq(CONV_ID), eq("Alice Member"));
        }

        @Test
        @DisplayName("falls back to tenant entity when tenantId column is null")
        void fallsBackToTenantEntity_whenTenantIdNull() {
            aiConversation.setTenantId(null);
            stubConversation(aiConversation);
            stubSave();
            stubMessageSave();

            service.requestHelp(CONV_ID);

            // Should use tenant.getId() fallback
            verify(notificationService).notifyHelpRequested(
                    eq(COACH_ID), eq(TENANT_ID), eq(CONV_ID), eq("Alice Member"));
        }

        @Test
        @DisplayName("no NPE when NotificationService is null")
        void noNPE_whenNotificationServiceIsNull() {
            service.setNotificationService(null);
            stubConversation(aiConversation);
            stubSave();
            stubMessageSave();

            // Should not throw
            service.requestHelp(CONV_ID);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Coach messaging guard
    // ─────────────────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("sendCoachMessage()")
    class SendCoachMessage {

        @Test
        @DisplayName("throws when coach has not taken over (conversation still in AI mode)")
        void throwsException_whenNotControlling() {
            stubConversation(aiConversation);
            stubCoachVisibility();

            assertThatThrownBy(() -> service.sendCoachMessage(CONV_ID, coachPrincipal, "Hello"))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("Coach must take over before sending messages");
        }

        @Test
        @DisplayName("sends message to member queue and increments unreadMemberCount")
        void sendsToMemberAndIncrementsUnread() {
            stubConversation(humanConversation);
            stubCoachVisibility();
            stubSave();
            stubMessageSave();
            when(userRepository.findById(COACH_ID)).thenReturn(Optional.of(coachUser));

            service.sendCoachMessage(CONV_ID, coachPrincipal, "Hi Alice!");

            verify(messagingTemplate).convertAndSendToUser(
                    eq(MEMBER_EMAIL), eq("/queue/chat.messages"), any());

            ArgumentCaptor<Conversation> savedConv = ArgumentCaptor.forClass(Conversation.class);
            verify(conversationRepository, atLeastOnce()).save(savedConv.capture());
            savedConv.getAllValues().stream()
                    .filter(c -> c.getUnreadMemberCount() > 0)
                    .findFirst()
                    .orElseThrow(() -> new AssertionError("unreadMemberCount not incremented"));
        }

        @Test
        @DisplayName("broadcasts dashboard update after sending message")
        void broadcastsDashboardUpdate() {
            stubConversation(humanConversation);
            stubCoachVisibility();
            stubSave();
            stubMessageSave();
            when(userRepository.findById(COACH_ID)).thenReturn(Optional.of(coachUser));

            service.sendCoachMessage(CONV_ID, coachPrincipal, "Hi Alice!");

            @SuppressWarnings("unchecked")
            ArgumentCaptor<Map<String, Object>> captor = ArgumentCaptor.forClass(Map.class);
            verify(messagingTemplate).convertAndSend(
                    eq("/topic/chat.dashboard." + TENANT_ID), captor.capture());
            assertThat(captor.getValue()).containsEntry("type", "MESSAGE");
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Member messaging
    // ─────────────────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("sendMemberMessage()")
    class SendMemberMessage {

        @Test
        @DisplayName("sends to controlling coach queue when in HUMAN mode")
        void sendsToCoachQueue_whenHumanMode() {
            stubConversation(humanConversation);
            stubSave();
            stubMessageSave();
            when(userRepository.findById(MEMBER_ID)).thenReturn(Optional.empty());

            service.sendMemberMessage(CONV_ID, memberPrincipal, "Hello coach!");

            verify(messagingTemplate).convertAndSendToUser(
                    eq(COACH_EMAIL), eq("/queue/chat.messages"), any());
        }

        @Test
        @DisplayName("increments unreadCoachCount")
        void incrementsUnreadCoachCount() {
            stubConversation(aiConversation);
            stubSave();
            stubMessageSave();
            when(userRepository.findById(MEMBER_ID)).thenReturn(Optional.empty());

            service.sendMemberMessage(CONV_ID, memberPrincipal, "Hi");

            ArgumentCaptor<Conversation> savedConv = ArgumentCaptor.forClass(Conversation.class);
            verify(conversationRepository, atLeastOnce()).save(savedConv.capture());
            savedConv.getAllValues().stream()
                    .filter(c -> c.getUnreadCoachCount() > 0)
                    .findFirst()
                    .orElseThrow(() -> new AssertionError("unreadCoachCount not incremented"));
        }

        @Test
        @DisplayName("broadcasts dashboard update")
        void broadcastsDashboardUpdate() {
            stubConversation(aiConversation);
            stubSave();
            stubMessageSave();
            when(userRepository.findById(MEMBER_ID)).thenReturn(Optional.empty());

            service.sendMemberMessage(CONV_ID, memberPrincipal, "Hi");

            @SuppressWarnings("unchecked")
            ArgumentCaptor<Map<String, Object>> captor = ArgumentCaptor.forClass(Map.class);
            verify(messagingTemplate).convertAndSend(
                    eq("/topic/chat.dashboard." + TENANT_ID), captor.capture());
            assertThat(captor.getValue()).containsEntry("type", "MESSAGE");
        }

        @Test
        @DisplayName("@mention of coach triggers notification")
        void mentionCoach_triggersNotification() {
            // Set up conversation with a known coach name
            aiConversation.setControllingCoachId(null);
            aiConversation.setAssignedCoachName("Test User");
            stubConversation(aiConversation);
            stubSave();
            stubMessageSave();
            when(userRepository.findById(MEMBER_ID)).thenReturn(Optional.empty());

            service.sendMemberMessage(CONV_ID, memberPrincipal, "Hey @Test can you help?");

            verify(notificationService).notifyMention(
                    eq(COACH_ID), eq(TENANT_ID), eq(CONV_ID),
                    eq("Alice Member"), eq("Hey @Test can you help?"));
        }

        @Test
        @DisplayName("throws AccessDeniedException when member does not own conversation")
        void throwsException_whenNotOwner() {
            stubConversation(aiConversation);

            UserPrincipal otherMember = new UserPrincipal(OTHER_COACH, "other@test.com",
                    "Other", "Person", null, UserRole.TENANT_USER, TENANT_ID, true);

            assertThatThrownBy(() -> service.sendMemberMessage(CONV_ID, otherMember, "Hi"))
                    .isInstanceOf(org.springframework.security.access.AccessDeniedException.class);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // @mention notifications
    // ─────────────────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("@mention notifications")
    class MentionNotifications {

        @BeforeEach
        void setUp() {
            // Give the shared aiConversation a coach name so notifyIfMentioned has a recipient name
            aiConversation.setAssignedCoachName(COACH_FULL_NAME);
        }

        @Test
        @DisplayName("coach mentions member by first name → member receives notifyMention")
        void coachMentionsMember_triggersNotification() {
            stubConversation(humanConversation);
            stubCoachVisibility();
            stubSave();
            stubMessageSave();
            when(userRepository.findById(COACH_ID)).thenReturn(Optional.of(coachUser));

            service.sendCoachMessage(CONV_ID, coachPrincipal, "Hey @Alice here is the update.");

            verify(notificationService).notifyMention(
                    eq(MEMBER_ID), eq(TENANT_ID), eq(CONV_ID),
                    eq(COACH_FULL_NAME), eq("Hey @Alice here is the update."));
        }

        @Test
        @DisplayName("mention matching is case-insensitive (@alice matches Alice Member)")
        void mentionIsCaseInsensitive() {
            stubConversation(humanConversation);
            stubCoachVisibility();
            stubSave();
            stubMessageSave();
            when(userRepository.findById(COACH_ID)).thenReturn(Optional.of(coachUser));

            service.sendCoachMessage(CONV_ID, coachPrincipal, "Please see this @alice");

            verify(notificationService).notifyMention(
                    eq(MEMBER_ID), eq(TENANT_ID), eq(CONV_ID), any(), any());
        }

        @Test
        @DisplayName("unrelated @mention does not trigger notification")
        void unrelatdMention_doesNotNotify() {
            stubConversation(humanConversation);
            stubCoachVisibility();
            stubSave();
            stubMessageSave();
            when(userRepository.findById(COACH_ID)).thenReturn(Optional.of(coachUser));

            service.sendCoachMessage(CONV_ID, coachPrincipal, "Ask @Bob about this.");

            verify(notificationService, never()).notifyMention(any(), any(), any(), any(), any());
        }

        @Test
        @DisplayName("no @mention in message → notifyMention is never called")
        void noMentionToken_doesNotNotify() {
            stubConversation(humanConversation);
            stubCoachVisibility();
            stubSave();
            stubMessageSave();
            when(userRepository.findById(COACH_ID)).thenReturn(Optional.of(coachUser));

            service.sendCoachMessage(CONV_ID, coachPrincipal, "Just a plain message.");

            verify(notificationService, never()).notifyMention(any(), any(), any(), any(), any());
        }

        @Test
        @DisplayName("no NPE when NotificationService is null and message contains @mention")
        void noNPE_whenNotificationServiceIsNull() {
            service.setNotificationService(null);
            stubConversation(humanConversation);
            stubCoachVisibility();
            stubSave();
            stubMessageSave();
            when(userRepository.findById(COACH_ID)).thenReturn(Optional.of(coachUser));

            // Should not throw even though @Alice is in the message
            service.sendCoachMessage(CONV_ID, coachPrincipal, "Hi @Alice!");
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // File-share notifications
    // ─────────────────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("file-share notifications")
    class FileShareNotifications {

        @Test
        @DisplayName("member sends file → coach receives notifyFileShared")
        void memberFileMessage_notifiesCoach() {
            stubConversation(aiConversation);
            stubSave();
            stubMessageSave();
            when(userRepository.findById(MEMBER_ID)).thenReturn(Optional.empty());

            service.sendMemberFileMessage(CONV_ID, memberPrincipal, "report.pdf",
                    Map.of("fileAttachment", Map.of("filename", "report.pdf")));

            verify(notificationService).notifyFileShared(
                    eq(COACH_ID), eq(TENANT_ID), eq(CONV_ID),
                    eq("Alice Member"), eq("report.pdf"));
        }

        @Test
        @DisplayName("coach sends file → member receives notifyFileShared")
        void coachFileMessage_notifiesMember() {
            stubConversation(humanConversation);
            stubCoachVisibility();
            stubSave();
            stubMessageSave();
            when(userRepository.findById(COACH_ID)).thenReturn(Optional.of(coachUser));

            service.sendCoachFileMessage(CONV_ID, coachPrincipal, "slides.pptx",
                    Map.of("fileAttachment", Map.of("filename", "slides.pptx")));

            verify(notificationService).notifyFileShared(
                    eq(MEMBER_ID), eq(TENANT_ID), eq(CONV_ID),
                    eq(COACH_FULL_NAME), eq("slides.pptx"));
        }

        @Test
        @DisplayName("no NPE when NotificationService is null (optional dep)")
        void noNPE_whenNotificationServiceIsNull() {
            service.setNotificationService(null);
            stubConversation(aiConversation);
            stubSave();
            stubMessageSave();
            when(userRepository.findById(MEMBER_ID)).thenReturn(Optional.empty());

            service.sendMemberFileMessage(CONV_ID, memberPrincipal, "doc.pdf",
                    Map.of("fileAttachment", Map.of("filename", "doc.pdf")));
        }

        @Test
        @DisplayName("member file message broadcasts dashboard update")
        void memberFileMessage_broadcastsDashboardUpdate() {
            stubConversation(aiConversation);
            stubSave();
            stubMessageSave();
            when(userRepository.findById(MEMBER_ID)).thenReturn(Optional.empty());

            service.sendMemberFileMessage(CONV_ID, memberPrincipal, "report.pdf",
                    Map.of("fileAttachment", Map.of("filename", "report.pdf")));

            @SuppressWarnings("unchecked")
            ArgumentCaptor<Map<String, Object>> captor = ArgumentCaptor.forClass(Map.class);
            verify(messagingTemplate).convertAndSend(
                    eq("/topic/chat.dashboard." + TENANT_ID), captor.capture());
            assertThat(captor.getValue()).containsEntry("type", "MESSAGE");
        }

        @Test
        @DisplayName("coach file message broadcasts dashboard update")
        void coachFileMessage_broadcastsDashboardUpdate() {
            stubConversation(humanConversation);
            stubCoachVisibility();
            stubSave();
            stubMessageSave();
            when(userRepository.findById(COACH_ID)).thenReturn(Optional.of(coachUser));

            service.sendCoachFileMessage(CONV_ID, coachPrincipal, "slides.pptx",
                    Map.of("fileAttachment", Map.of("filename", "slides.pptx")));

            @SuppressWarnings("unchecked")
            ArgumentCaptor<Map<String, Object>> captor = ArgumentCaptor.forClass(Map.class);
            verify(messagingTemplate).convertAndSend(
                    eq("/topic/chat.dashboard." + TENANT_ID), captor.capture());
            assertThat(captor.getValue()).containsEntry("type", "MESSAGE");
        }

        @Test
        @DisplayName("member file message with @mention in caption notifies coach")
        void memberFileMessage_withMention_notifiesCoach() {
            aiConversation.setAssignedCoachName("Test User");
            stubConversation(aiConversation);
            stubSave();
            stubMessageSave();
            when(userRepository.findById(MEMBER_ID)).thenReturn(Optional.empty());

            service.sendMemberFileMessage(CONV_ID, memberPrincipal, "Here @Test check this",
                    Map.of("fileAttachment", Map.of("filename", "data.xlsx")));

            verify(notificationService).notifyMention(
                    eq(COACH_ID), eq(TENANT_ID), eq(CONV_ID),
                    eq("Alice Member"), eq("Here @Test check this"));
        }

        @Test
        @DisplayName("coach file message with @mention in caption notifies member")
        void coachFileMessage_withMention_notifiesMember() {
            stubConversation(humanConversation);
            stubCoachVisibility();
            stubSave();
            stubMessageSave();
            when(userRepository.findById(COACH_ID)).thenReturn(Optional.of(coachUser));

            service.sendCoachFileMessage(CONV_ID, coachPrincipal, "For you @Alice",
                    Map.of("fileAttachment", Map.of("filename", "guide.pdf")));

            verify(notificationService).notifyMention(
                    eq(MEMBER_ID), eq(TENANT_ID), eq(CONV_ID),
                    eq(COACH_FULL_NAME), eq("For you @Alice"));
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // sendToUser email resolution
    // ─────────────────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("sendToUser email resolution")
    class SendToUserEmailResolution {

        @Test
        @DisplayName("coach message resolves member UUID to email for delivery")
        void coachMessage_resolvesUuidToEmail() {
            stubConversation(humanConversation);
            stubCoachVisibility();
            stubSave();
            stubMessageSave();
            when(userRepository.findById(COACH_ID)).thenReturn(Optional.of(coachUser));

            service.sendCoachMessage(CONV_ID, coachPrincipal, "Here is an update.");

            // The member's real-time notification must use email, not UUID
            verify(messagingTemplate).convertAndSendToUser(
                    eq(MEMBER_EMAIL), eq("/queue/chat.messages"), any());
            // Must never use UUID string as the user destination
            verify(messagingTemplate, never()).convertAndSendToUser(
                    eq(MEMBER_ID.toString()), any(), any());
        }

        @Test
        @DisplayName("silently skips when user not found (no NPE)")
        void silentlySkips_whenUserNotFound() {
            // Override the global stub so member lookup returns empty
            when(userRepository.findById(MEMBER_ID)).thenReturn(Optional.empty());
            stubConversation(humanConversation);
            stubCoachVisibility();
            stubSave();
            stubMessageSave();
            when(userRepository.findById(COACH_ID)).thenReturn(Optional.of(coachUser));

            // Should not throw — message just won't be delivered in real-time
            service.sendCoachMessage(CONV_ID, coachPrincipal, "Hello member");

            // convertAndSendToUser should NOT be called with the member destination
            verify(messagingTemplate, never()).convertAndSendToUser(
                    eq(MEMBER_EMAIL), eq("/queue/chat.messages"), any());
            verify(messagingTemplate, never()).convertAndSendToUser(
                    eq(MEMBER_ID.toString()), eq("/queue/chat.messages"), any());
        }

        @Test
        @DisplayName("takeover MODE_CHANGE event uses member email, not UUID")
        void takeoverEvent_usesMemberEmail() {
            stubConversation(aiConversation);
            stubCoachVisibility();
            stubSave();
            stubMessageSave();
            when(userRepository.findById(COACH_ID)).thenReturn(Optional.of(coachUser));

            service.takeover(CONV_ID, coachPrincipal);

            // MODE_CHANGE event to member must use email
            verify(messagingTemplate).convertAndSendToUser(
                    eq(MEMBER_EMAIL), eq("/queue/chat.events"), any());
            // Must never use UUID string as the user destination
            verify(messagingTemplate, never()).convertAndSendToUser(
                    eq(MEMBER_ID.toString()), any(), any());
        }
    }
}
