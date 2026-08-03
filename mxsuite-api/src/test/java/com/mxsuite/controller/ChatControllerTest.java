package com.mxsuite.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mxsuite.model.Conversation;
import com.mxsuite.model.enums.AvailabilityStatus;
import com.mxsuite.model.enums.ChatMode;
import com.mxsuite.security.JwtAuthenticationFilter;
import com.mxsuite.security.RateLimitFilter;
import com.mxsuite.security.WithMockUserPrincipal;
import com.mxsuite.repository.CannedResponseRepository;
import com.mxsuite.service.ChatFileService;
import com.mxsuite.service.ChatPdfExportService;
import com.mxsuite.service.ChatService;
import com.mxsuite.service.PresenceService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.data.jpa.mapping.JpaMetamodelMappingContext;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Map;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * MockMvc tests for {@link ChatController}.
 *
 * Security filters are disabled; authentication is injected via {@link WithMockUserPrincipal}.
 * Note: @PreAuthorize role enforcement is not verified here — @WebMvcTest with addFilters=false
 * disables the security filter chain; method security requires importing SecurityConfig.
 * Role enforcement is covered by integration tests.
 *
 * These tests cover: the three presence endpoints (my-status, availability PUT, detail GET),
 * takeover/release response shape, and bean validation.
 */
@WebMvcTest(ChatController.class)
@AutoConfigureMockMvc(addFilters = false)
@MockBean(JpaMetamodelMappingContext.class)
@DisplayName("ChatController")
class ChatControllerTest {

    // ── Infrastructure mocks ──────────────────────────────────────────────────
    @MockBean JwtAuthenticationFilter jwtAuthenticationFilter;
    @MockBean RateLimitFilter         rateLimitFilter;

    // ── Service mocks ─────────────────────────────────────────────────────────
    @MockBean ChatService              chatService;
    @MockBean PresenceService          presenceService;
    @MockBean ChatFileService          chatFileService;
    @MockBean ChatPdfExportService     chatPdfExportService;
    @MockBean CannedResponseRepository cannedResponseRepository;

    @Autowired MockMvc      mockMvc;
    @Autowired ObjectMapper objectMapper;

    // ── Shared UUIDs ──────────────────────────────────────────────────────────
    static final UUID COACH_ID  = UUID.fromString("cccc0000-0000-0000-0000-000000000001");
    static final UUID MEMBER_ID = UUID.fromString("bbbb0000-0000-0000-0000-000000000001");
    static final UUID TENANT_ID = UUID.fromString("aaaa0000-0000-0000-0000-000000000001");
    static final UUID CONV_ID   = UUID.fromString("eeee0000-0000-0000-0000-000000000001");

    // ─────────────────────────────────────────────────────────────────────────
    // GET /api/chat/presence/my-status
    // ─────────────────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("GET /presence/my-status")
    class MyStatus {

        @Test
        @DisplayName("200 — returns online=false and AWAY status with message")
        @WithMockUserPrincipal(role = "COACH_ADMIN", userId = "cccc0000-0000-0000-0000-000000000001")
        void returns200_withPresenceDetail() throws Exception {
            when(presenceService.getMyDetail(COACH_ID))
                    .thenReturn(new PresenceService.PresenceDetail(
                            false, AvailabilityStatus.AWAY, "Back at 3pm"));

            mockMvc.perform(get("/api/chat/presence/my-status"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.online").value(false))
                    .andExpect(jsonPath("$.availabilityStatus").value("AWAY"))
                    .andExpect(jsonPath("$.statusMessage").value("Back at 3pm"));
        }

        @Test
        @DisplayName("200 — member can also call my-status (available to all roles)")
        @WithMockUserPrincipal(role = "TENANT_USER", userId = "bbbb0000-0000-0000-0000-000000000001")
        void returns200_forMember() throws Exception {
            when(presenceService.getMyDetail(MEMBER_ID))
                    .thenReturn(new PresenceService.PresenceDetail(
                            true, AvailabilityStatus.ONLINE, null));

            mockMvc.perform(get("/api/chat/presence/my-status"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.online").value(true))
                    .andExpect(jsonPath("$.availabilityStatus").value("ONLINE"));
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PUT /api/chat/presence/availability
    // ─────────────────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("PUT /presence/availability")
    class SetAvailability {

        @Test
        @DisplayName("200 — coach sets status to AWAY with a custom message")
        @WithMockUserPrincipal(role = "COACH_ADMIN",
                userId = "cccc0000-0000-0000-0000-000000000001",
                tenantId = "aaaa0000-0000-0000-0000-000000000001")
        void returns200_forCoach() throws Exception {
            mockMvc.perform(put("/api/chat/presence/availability")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"status\":\"AWAY\",\"statusMessage\":\"Back at 3pm\"}"))
                    .andExpect(status().isOk());

            verify(presenceService).setAvailability(
                    eq(COACH_ID), eq(TENANT_ID),
                    eq(AvailabilityStatus.AWAY), eq("Back at 3pm"));
        }

        @Test
        @DisplayName("200 — member sets status to DO_NOT_DISTURB (available to all roles)")
        @WithMockUserPrincipal(role = "TENANT_USER",
                userId = "bbbb0000-0000-0000-0000-000000000001",
                tenantId = "aaaa0000-0000-0000-0000-000000000001")
        void returns200_forMember() throws Exception {
            mockMvc.perform(put("/api/chat/presence/availability")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"status\":\"DO_NOT_DISTURB\"}"))
                    .andExpect(status().isOk());

            verify(presenceService).setAvailability(
                    eq(MEMBER_ID), eq(TENANT_ID),
                    eq(AvailabilityStatus.DO_NOT_DISTURB), isNull());
        }

        @Test
        @DisplayName("400 — null status field fails @NotNull bean validation")
        @WithMockUserPrincipal(role = "COACH_ADMIN")
        void returns400_whenStatusMissing() throws Exception {
            mockMvc.perform(put("/api/chat/presence/availability")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"statusMessage\":\"no status here\"}"))
                    .andExpect(status().isBadRequest());

            verifyNoInteractions(presenceService);
        }

        @Test
        @DisplayName("400 — statusMessage exceeding 100 chars fails @Size validation")
        @WithMockUserPrincipal(role = "COACH_ADMIN")
        void returns400_whenStatusMessageTooLong() throws Exception {
            String longMsg = "x".repeat(101);
            mockMvc.perform(put("/api/chat/presence/availability")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"status\":\"ONLINE\",\"statusMessage\":\"" + longMsg + "\"}"))
                    .andExpect(status().isBadRequest());
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GET /api/chat/presence/detail
    // ─────────────────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("GET /presence/detail")
    class PresenceDetail {

        @Test
        @DisplayName("200 — returns availability detail map for requested user IDs")
        @WithMockUserPrincipal(role = "COACH_ADMIN")
        void returns200_withDetailMap() throws Exception {
            when(presenceService.getPresenceDetail(any()))
                    .thenReturn(Map.of(
                            COACH_ID,  new PresenceService.PresenceDetail(true,  AvailabilityStatus.ONLINE, null),
                            MEMBER_ID, new PresenceService.PresenceDetail(false, AvailabilityStatus.AWAY,   "BRB")));

            mockMvc.perform(get("/api/chat/presence/detail")
                            .param("userIds", COACH_ID.toString(), MEMBER_ID.toString()))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$." + COACH_ID + ".online").value(true))
                    .andExpect(jsonPath("$." + COACH_ID + ".availabilityStatus").value("ONLINE"))
                    .andExpect(jsonPath("$." + MEMBER_ID + ".online").value(false))
                    .andExpect(jsonPath("$." + MEMBER_ID + ".availabilityStatus").value("AWAY"))
                    .andExpect(jsonPath("$." + MEMBER_ID + ".statusMessage").value("BRB"));
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // POST /api/chat/coach/conversations/{id}/takeover
    // ─────────────────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("POST /coach/conversations/{id}/takeover")
    class Takeover {

        @BeforeEach
        void setUp() {
            Conversation humanConv = new Conversation();
            humanConv.setId(CONV_ID);
            humanConv.setMode(ChatMode.HUMAN);
            humanConv.setMemberId(MEMBER_ID);
            humanConv.setTenantId(TENANT_ID);
            when(chatService.takeover(eq(CONV_ID), any())).thenReturn(humanConv);
        }

        @Test
        @DisplayName("200 — COACH_ADMIN takes over and response includes mode=HUMAN")
        @WithMockUserPrincipal(role = "COACH_ADMIN")
        void returns200_forCoachAdmin() throws Exception {
            mockMvc.perform(post("/api/chat/coach/conversations/{id}/takeover", CONV_ID))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.mode").value("HUMAN"));
        }

        @Test
        @DisplayName("200 — PLATFORM_SUPPORT can also take over")
        @WithMockUserPrincipal(role = "PLATFORM_SUPPORT")
        void returns200_forPlatformSupport() throws Exception {
            mockMvc.perform(post("/api/chat/coach/conversations/{id}/takeover", CONV_ID))
                    .andExpect(status().isOk());
        }

        @Test
        @DisplayName("200 — PLATFORM_ADMIN can also take over")
        @WithMockUserPrincipal(role = "PLATFORM_ADMIN")
        void returns200_forPlatformAdmin() throws Exception {
            mockMvc.perform(post("/api/chat/coach/conversations/{id}/takeover", CONV_ID))
                    .andExpect(status().isOk());
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // POST /api/chat/coach/conversations/{id}/release
    // ─────────────────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("POST /coach/conversations/{id}/release")
    class Release {

        @BeforeEach
        void setUp() {
            Conversation aiConv = new Conversation();
            aiConv.setId(CONV_ID);
            aiConv.setMode(ChatMode.AI);
            aiConv.setMemberId(MEMBER_ID);
            aiConv.setTenantId(TENANT_ID);
            when(chatService.release(eq(CONV_ID), any())).thenReturn(aiConv);
        }

        @Test
        @DisplayName("200 — controlling coach releases back to AI and response includes mode=AI")
        @WithMockUserPrincipal(role = "COACH_ADMIN")
        void returns200_forControllingCoach() throws Exception {
            mockMvc.perform(post("/api/chat/coach/conversations/{id}/release", CONV_ID))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.mode").value("AI"));
        }
    }
}
