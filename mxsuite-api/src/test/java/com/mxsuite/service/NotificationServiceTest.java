package com.mxsuite.service;

import com.mxsuite.model.Notification;
import com.mxsuite.model.User;
import com.mxsuite.repository.NotificationRepository;
import com.mxsuite.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@DisplayName("NotificationService")
class NotificationServiceTest {

    @Mock NotificationRepository notificationRepository;
    @Mock UserRepository userRepository;

    @InjectMocks NotificationService service;

    static final UUID TENANT_ID = UUID.fromString("aaaa0000-0000-0000-0000-000000000001");
    static final UUID CONV_ID   = UUID.fromString("eeee0000-0000-0000-0000-000000000001");
    static final UUID COACH_ID  = UUID.fromString("cccc0000-0000-0000-0000-000000000001");
    static final UUID COACH_ID2 = UUID.fromString("cccc0000-0000-0000-0000-000000000002");

    User coach1;
    User coach2;

    @BeforeEach
    void setUp() {
        coach1 = new User();
        coach1.setId(COACH_ID);
        coach1.setFirstName("Coach");
        coach1.setLastName("One");

        coach2 = new User();
        coach2.setId(COACH_ID2);
        coach2.setFirstName("Coach");
        coach2.setLastName("Two");
    }

    @Nested
    @DisplayName("notifyHelpRequested()")
    class NotifyHelpRequested {

        @Test
        @DisplayName("notifies assigned coach when assignedCoachId is provided")
        void notifiesAssignedCoach() {
            when(userRepository.findById(COACH_ID)).thenReturn(Optional.of(coach1));

            service.notifyHelpRequested(COACH_ID, TENANT_ID, CONV_ID, "Jane Doe");

            ArgumentCaptor<Notification> captor = ArgumentCaptor.forClass(Notification.class);
            verify(notificationRepository).save(captor.capture());

            Notification n = captor.getValue();
            assertThat(n.getRecipientId()).isEqualTo(COACH_ID);
            assertThat(n.getTenantId()).isEqualTo(TENANT_ID);
            assertThat(n.getType()).isEqualTo("HELP_REQUESTED");
            assertThat(n.getTitle()).isEqualTo("Jane Doe requested live support");
            assertThat(n.getEntityType()).isEqualTo("Conversation");
            assertThat(n.getEntityId()).isEqualTo(CONV_ID);
        }

        @Test
        @DisplayName("notifies all active coaches when assignedCoachId is null")
        void notifiesAllCoaches_whenNoAssignedCoach() {
            when(userRepository.findActiveCoaches()).thenReturn(List.of(coach1, coach2));

            service.notifyHelpRequested(null, TENANT_ID, CONV_ID, "Jane Doe");

            ArgumentCaptor<Notification> captor = ArgumentCaptor.forClass(Notification.class);
            verify(notificationRepository, times(2)).save(captor.capture());

            List<Notification> saved = captor.getAllValues();
            assertThat(saved).extracting(Notification::getRecipientId)
                    .containsExactlyInAnyOrder(COACH_ID, COACH_ID2);
            assertThat(saved).allSatisfy(n -> {
                assertThat(n.getType()).isEqualTo("HELP_REQUESTED");
                assertThat(n.getTenantId()).isEqualTo(TENANT_ID);
                assertThat(n.getEntityId()).isEqualTo(CONV_ID);
            });
        }

        @Test
        @DisplayName("creates zero notifications when assigned coach not found in DB")
        void zeroNotifications_whenCoachNotFound() {
            when(userRepository.findById(COACH_ID)).thenReturn(Optional.empty());

            service.notifyHelpRequested(COACH_ID, TENANT_ID, CONV_ID, "Jane Doe");

            verify(notificationRepository, never()).save(any());
        }

        @Test
        @DisplayName("creates zero notifications when no active coaches exist")
        void zeroNotifications_whenNoActiveCoaches() {
            when(userRepository.findActiveCoaches()).thenReturn(List.of());

            service.notifyHelpRequested(null, TENANT_ID, CONV_ID, "Jane Doe");

            verify(notificationRepository, never()).save(any());
        }

        @Test
        @DisplayName("does not throw when repository save fails")
        void doesNotThrow_whenSaveFails() {
            when(userRepository.findById(COACH_ID)).thenReturn(Optional.of(coach1));
            when(notificationRepository.save(any())).thenThrow(new RuntimeException("DB error"));

            // Should not throw — error is caught and logged
            service.notifyHelpRequested(COACH_ID, TENANT_ID, CONV_ID, "Jane Doe");
        }
    }

    @Nested
    @DisplayName("notifyFileShared()")
    class NotifyFileShared {

        @Test
        @DisplayName("creates notification with correct type and title")
        void createsCorrectNotification() {
            service.notifyFileShared(COACH_ID, TENANT_ID, CONV_ID, "Alice Member", "report.pdf");

            ArgumentCaptor<Notification> captor = ArgumentCaptor.forClass(Notification.class);
            verify(notificationRepository).save(captor.capture());

            Notification n = captor.getValue();
            assertThat(n.getRecipientId()).isEqualTo(COACH_ID);
            assertThat(n.getType()).isEqualTo("CHAT_FILE_SHARED");
            assertThat(n.getTitle()).isEqualTo("Alice Member shared a file");
            assertThat(n.getMessage()).isEqualTo("report.pdf");
        }
    }

    @Nested
    @DisplayName("notifyMention()")
    class NotifyMention {

        @Test
        @DisplayName("truncates long excerpts with ellipsis")
        void truncatesLongExcerpt() {
            String longMsg = "A".repeat(200);
            service.notifyMention(COACH_ID, TENANT_ID, CONV_ID, "Alice", longMsg);

            ArgumentCaptor<Notification> captor = ArgumentCaptor.forClass(Notification.class);
            verify(notificationRepository).save(captor.capture());

            // substring(0, 117) + "…" = 118 chars
            assertThat(captor.getValue().getMessage()).hasSizeLessThanOrEqualTo(120);
            assertThat(captor.getValue().getMessage()).endsWith("\u2026");
        }
    }
}
