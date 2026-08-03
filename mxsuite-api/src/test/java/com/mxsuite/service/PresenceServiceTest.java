package com.mxsuite.service;

import com.mxsuite.model.User;
import com.mxsuite.model.enums.AvailabilityStatus;
import com.mxsuite.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * Unit tests for {@link PresenceService}.
 *
 * Covers multi-tab session tracking (connect/disconnect),
 * availability status, APPEAR_OFFLINE masking, and batch queries.
 */
@ExtendWith(MockitoExtension.class)
@DisplayName("PresenceService")
class PresenceServiceTest {

    @Mock SimpMessagingTemplate messagingTemplate;
    @Mock UserRepository userRepository;

    PresenceService service;

    static final UUID USER_A   = UUID.fromString("aaaa0000-0000-0000-0000-000000000001");
    static final UUID USER_B   = UUID.fromString("bbbb0000-0000-0000-0000-000000000001");
    static final UUID TENANT_A = UUID.fromString("cccc0000-0000-0000-0000-000000000001");
    static final UUID TENANT_B = UUID.fromString("cccc0000-0000-0000-0000-000000000002");

    @BeforeEach
    void setUp() {
        service = new PresenceService(messagingTemplate, userRepository);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Connect / Disconnect — multi-tab session tracking
    // ─────────────────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("connect() / disconnect()")
    class ConnectDisconnect {

        @Test
        @DisplayName("first session broadcasts ONLINE")
        void firstSession_broadcastsOnline() {
            service.connect("sess-1", USER_A, TENANT_A);

            assertThat(service.isOnline(USER_A)).isTrue();
            verify(messagingTemplate).convertAndSend(
                    eq("/topic/presence." + TENANT_A), any(Map.class));
        }

        @Test
        @DisplayName("second session does NOT broadcast ONLINE again")
        void secondSession_noBroadcast() {
            service.connect("sess-1", USER_A, TENANT_A);
            clearInvocations(messagingTemplate);

            service.connect("sess-2", USER_A, TENANT_A);

            assertThat(service.isOnline(USER_A)).isTrue();
            verify(messagingTemplate, never()).convertAndSend(
                    eq("/topic/presence." + TENANT_A), any(Map.class));
        }

        @Test
        @DisplayName("disconnecting one of two sessions does NOT broadcast OFFLINE")
        void disconnectOneOfTwo_staysOnline() {
            service.connect("sess-1", USER_A, TENANT_A);
            service.connect("sess-2", USER_A, TENANT_A);
            clearInvocations(messagingTemplate);

            service.disconnect("sess-1");

            assertThat(service.isOnline(USER_A)).isTrue();
            verify(messagingTemplate, never()).convertAndSend(
                    eq("/topic/presence." + TENANT_A), any(Map.class));
        }

        @Test
        @DisplayName("disconnecting last session broadcasts OFFLINE and updates lastSeenAt")
        void disconnectLast_broadcastsOffline() {
            User user = new User();
            user.setId(USER_A);
            when(userRepository.findById(USER_A)).thenReturn(Optional.of(user));
            when(userRepository.save(any(User.class))).thenAnswer(i -> i.getArgument(0));

            service.connect("sess-1", USER_A, TENANT_A);
            clearInvocations(messagingTemplate);

            service.disconnect("sess-1");

            assertThat(service.isOnline(USER_A)).isFalse();

            @SuppressWarnings("unchecked")
            ArgumentCaptor<Map<String, Object>> captor = ArgumentCaptor.forClass(Map.class);
            verify(messagingTemplate).convertAndSend(
                    eq("/topic/presence." + TENANT_A), captor.capture());
            assertThat(captor.getValue()).containsEntry("status", "OFFLINE");

            // lastSeenAt should be updated
            verify(userRepository).save(user);
            assertThat(user.getLastSeenAt()).isNotNull();
        }

        @Test
        @DisplayName("disconnecting unknown session is a no-op")
        void disconnectUnknown_noOp() {
            service.disconnect("unknown-session");
            // No NPE, no broadcasts
            verifyNoInteractions(messagingTemplate);
        }

        @Test
        @DisplayName("getOnlineUserIds returns all connected users")
        void getOnlineUserIds_returnsAll() {
            service.connect("s1", USER_A, TENANT_A);
            service.connect("s2", USER_B, TENANT_B);

            Set<UUID> online = service.getOnlineUserIds();

            assertThat(online).containsExactlyInAnyOrder(USER_A, USER_B);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Availability status
    // ─────────────────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("setAvailability()")
    class Availability {

        @Test
        @DisplayName("sets availability and broadcasts change")
        void setsAndBroadcasts() {
            service.connect("s1", USER_A, TENANT_A);
            clearInvocations(messagingTemplate);

            service.setAvailability(USER_A, TENANT_A, AvailabilityStatus.BUSY, "In a meeting");

            @SuppressWarnings("unchecked")
            ArgumentCaptor<Map<String, Object>> captor = ArgumentCaptor.forClass(Map.class);
            verify(messagingTemplate).convertAndSend(
                    eq("/topic/presence." + TENANT_A), captor.capture());

            Map<String, Object> payload = captor.getValue();
            assertThat(payload).containsEntry("availabilityStatus", "BUSY");
            assertThat(payload).containsEntry("statusMessage", "In a meeting");
            assertThat(payload).containsEntry("status", "ONLINE");
        }

        @Test
        @DisplayName("getMyDetail reflects availability status and message")
        void getMyDetail_reflectsAvailability() {
            service.connect("s1", USER_A, TENANT_A);
            service.setAvailability(USER_A, TENANT_A, AvailabilityStatus.AWAY, "Lunch break");

            PresenceService.PresenceDetail detail = service.getMyDetail(USER_A);

            assertThat(detail.online()).isTrue();
            assertThat(detail.availabilityStatus()).isEqualTo(AvailabilityStatus.AWAY);
            assertThat(detail.statusMessage()).isEqualTo("Lunch break");
        }

        @Test
        @DisplayName("default availability is ONLINE with no status message")
        void defaultAvailability() {
            service.connect("s1", USER_A, TENANT_A);

            PresenceService.PresenceDetail detail = service.getMyDetail(USER_A);

            assertThat(detail.online()).isTrue();
            assertThat(detail.availabilityStatus()).isEqualTo(AvailabilityStatus.ONLINE);
            assertThat(detail.statusMessage()).isNull();
        }

        @Test
        @DisplayName("getMyDetail for disconnected user shows offline with default status")
        void getMyDetail_disconnectedUser() {
            PresenceService.PresenceDetail detail = service.getMyDetail(USER_A);

            assertThat(detail.online()).isFalse();
            assertThat(detail.availabilityStatus()).isEqualTo(AvailabilityStatus.ONLINE);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // APPEAR_OFFLINE masking
    // ─────────────────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("APPEAR_OFFLINE")
    class AppearOffline {

        @Test
        @DisplayName("getOnlineStatus returns false for APPEAR_OFFLINE user")
        void getOnlineStatus_masksBusy() {
            service.connect("s1", USER_A, TENANT_A);
            service.setAvailability(USER_A, TENANT_A, AvailabilityStatus.APPEAR_OFFLINE, null);

            Map<UUID, Boolean> status = service.getOnlineStatus(List.of(USER_A));

            assertThat(status.get(USER_A)).isFalse();
        }

        @Test
        @DisplayName("getPresenceDetail shows online=false for APPEAR_OFFLINE user")
        void getPresenceDetail_masksAppearOffline() {
            service.connect("s1", USER_A, TENANT_A);
            service.setAvailability(USER_A, TENANT_A, AvailabilityStatus.APPEAR_OFFLINE, null);

            Map<UUID, PresenceService.PresenceDetail> details =
                    service.getPresenceDetail(List.of(USER_A));

            assertThat(details.get(USER_A).online()).isFalse();
            assertThat(details.get(USER_A).availabilityStatus())
                    .isEqualTo(AvailabilityStatus.APPEAR_OFFLINE);
        }

        @Test
        @DisplayName("broadcast sends OFFLINE status when APPEAR_OFFLINE is set")
        void broadcast_sendsOffline() {
            service.connect("s1", USER_A, TENANT_A);
            clearInvocations(messagingTemplate);

            service.setAvailability(USER_A, TENANT_A, AvailabilityStatus.APPEAR_OFFLINE, null);

            @SuppressWarnings("unchecked")
            ArgumentCaptor<Map<String, Object>> captor = ArgumentCaptor.forClass(Map.class);
            verify(messagingTemplate).convertAndSend(
                    eq("/topic/presence." + TENANT_A), captor.capture());

            assertThat(captor.getValue()).containsEntry("status", "OFFLINE");
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Batch queries
    // ─────────────────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("batch queries")
    class BatchQueries {

        @Test
        @DisplayName("getOnlineStatus returns map for multiple users")
        void getOnlineStatus_multipleUsers() {
            service.connect("s1", USER_A, TENANT_A);
            // USER_B not connected

            Map<UUID, Boolean> status = service.getOnlineStatus(List.of(USER_A, USER_B));

            assertThat(status).containsEntry(USER_A, true);
            assertThat(status).containsEntry(USER_B, false);
        }

        @Test
        @DisplayName("getPresenceDetail includes availability for all queried users")
        void getPresenceDetail_multipleUsers() {
            service.connect("s1", USER_A, TENANT_A);
            service.setAvailability(USER_A, TENANT_A, AvailabilityStatus.DO_NOT_DISTURB, "Focus time");

            Map<UUID, PresenceService.PresenceDetail> details =
                    service.getPresenceDetail(List.of(USER_A, USER_B));

            // USER_A: online + DND
            assertThat(details.get(USER_A).online()).isTrue();
            assertThat(details.get(USER_A).availabilityStatus())
                    .isEqualTo(AvailabilityStatus.DO_NOT_DISTURB);
            assertThat(details.get(USER_A).statusMessage()).isEqualTo("Focus time");

            // USER_B: offline + default ONLINE status
            assertThat(details.get(USER_B).online()).isFalse();
            assertThat(details.get(USER_B).availabilityStatus())
                    .isEqualTo(AvailabilityStatus.ONLINE);
        }

        @Test
        @DisplayName("getOnlineStatus returns true for non-APPEAR_OFFLINE statuses")
        void getOnlineStatus_nonAppearOffline_returnsTrue() {
            service.connect("s1", USER_A, TENANT_A);
            service.setAvailability(USER_A, TENANT_A, AvailabilityStatus.BUSY, null);

            Map<UUID, Boolean> status = service.getOnlineStatus(List.of(USER_A));

            assertThat(status.get(USER_A)).isTrue();
        }
    }
}
