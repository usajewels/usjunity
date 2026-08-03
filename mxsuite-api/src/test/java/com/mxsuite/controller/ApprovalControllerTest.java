package com.mxsuite.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mxsuite.model.ApprovalRequest;
import com.mxsuite.model.PhaseGate;
import com.mxsuite.model.Project;
import com.mxsuite.model.Tenant;
import com.mxsuite.model.enums.ApprovalStatus;
import com.mxsuite.model.enums.GateApprovalMode;
import com.mxsuite.model.enums.GateStatus;
import com.mxsuite.model.enums.MigrationPhase;
import com.mxsuite.repository.ApprovalRequestRepository;
import com.mxsuite.repository.PhaseGateRepository;
import com.mxsuite.repository.PlatformAssignmentRepository;
import com.mxsuite.repository.TenantRepository;
import com.mxsuite.audit.AuditService;
import com.mxsuite.security.JwtAuthenticationFilter;
import com.mxsuite.security.RateLimitFilter;
import com.mxsuite.security.TenantContext;
import com.mxsuite.security.WithMockUserPrincipal;
import com.mxsuite.service.PhaseGateService;
import org.junit.jupiter.api.AfterEach;
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

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * MockMvc tests for {@link ApprovalController}.
 *
 * Security filters (JWT, rate-limit) are replaced with mocks.
 * Authentication principal is injected via {@link WithMockUserPrincipal}.
 * TenantContext is set/cleared in @BeforeEach / @AfterEach.
 */
@WebMvcTest(ApprovalController.class)
@AutoConfigureMockMvc(addFilters = false)
@MockBean(JpaMetamodelMappingContext.class)
@DisplayName("ApprovalController")
class ApprovalControllerTest {

    // ── Infrastructure mocks (needed to satisfy SecurityConfig constructor) ──
    @MockBean JwtAuthenticationFilter jwtAuthenticationFilter;
    @MockBean RateLimitFilter         rateLimitFilter;

    // ── Repository / service mocks ────────────────────────────────────────────
    @MockBean ApprovalRequestRepository    approvalRepository;
    @MockBean PhaseGateRepository          phaseGateRepository;
    @MockBean PlatformAssignmentRepository assignmentRepository;
    @MockBean TenantRepository             tenantRepository;
    @MockBean PhaseGateService             phaseGateService;
    @MockBean AuditService                 auditService;

    @Autowired MockMvc    mockMvc;
    @Autowired ObjectMapper objectMapper;

    // ── Shared UUIDs ──────────────────────────────────────────────────────────
    static final UUID TENANT_ID   = UUID.fromString("00000000-0000-0000-0000-000000000002");
    static final UUID PROJECT_ID  = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001");
    static final UUID GATE_ID     = UUID.fromString("bbbbbbbb-0000-0000-0000-000000000001");
    static final UUID APPROVAL_ID = UUID.fromString("cccccccc-0000-0000-0000-000000000001");

    // ── Fixtures ──────────────────────────────────────────────────────────────
    Tenant       tenant;
    Project      project;
    PhaseGate    gate;
    ApprovalRequest pendingCoachApproval;
    ApprovalRequest pendingMemberApproval;

    @BeforeEach
    void setUp() {
        tenant = new Tenant();
        tenant.setId(TENANT_ID);

        project = new Project();
        project.setId(PROJECT_ID);
        project.setName("Test Project");
        project.setTenant(tenant);

        gate = new PhaseGate();
        gate.setId(GATE_ID);
        gate.setPhase(MigrationPhase.MAP);
        gate.setGateStatus(GateStatus.PENDING);
        gate.setApprovalMode(GateApprovalMode.BOTH);
        gate.setProject(project);

        pendingCoachApproval = buildApproval(APPROVAL_ID, "COACH_ADMIN", ApprovalStatus.PENDING);
        pendingMemberApproval = buildApproval(APPROVAL_ID, "TENANT_ADMIN", ApprovalStatus.PENDING);

        // Set tenant context for member-approve tests
        TenantContext.setCurrentTenantId(TENANT_ID);
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // POST /{id}/authorize
    // ─────────────────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("POST /{id}/authorize")
    class Authorize {

        @Test
        @DisplayName("200 — coach marks approval APPROVED and gate status is returned")
        @WithMockUserPrincipal(role = "COACH_ADMIN")
        void returns200_whenCoachAuthorizes() throws Exception {
            when(approvalRepository.findById(APPROVAL_ID)).thenReturn(Optional.of(pendingCoachApproval));
            when(phaseGateService.checkAndClearGate(gate)).thenReturn(GateStatus.PENDING);

            mockMvc.perform(post("/api/migration/approvals/{id}/authorize", APPROVAL_ID))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.approvalStatus").value("APPROVED"))
                    .andExpect(jsonPath("$.requiredRole").value("COACH_ADMIN"));

            verify(approvalRepository).save(pendingCoachApproval);
            assertThat(pendingCoachApproval.getApprovalStatus()).isEqualTo(ApprovalStatus.APPROVED);
            verify(phaseGateService).checkAndClearGate(gate);
        }

        @Test
        @DisplayName("200 — platform admin can also authorize")
        @WithMockUserPrincipal(role = "PLATFORM_ADMIN")
        void returns200_whenPlatformAdminAuthorizes() throws Exception {
            when(approvalRepository.findById(APPROVAL_ID)).thenReturn(Optional.of(pendingCoachApproval));
            when(phaseGateService.checkAndClearGate(gate)).thenReturn(GateStatus.CLEARED);

            mockMvc.perform(post("/api/migration/approvals/{id}/authorize", APPROVAL_ID))
                    .andExpect(status().isOk());
        }

        @Test
        @DisplayName("400 — already approved approval returns bad request")
        @WithMockUserPrincipal(role = "COACH_ADMIN")
        void returns400_whenAlreadyApproved() throws Exception {
            pendingCoachApproval.setApprovalStatus(ApprovalStatus.APPROVED);
            when(approvalRepository.findById(APPROVAL_ID)).thenReturn(Optional.of(pendingCoachApproval));

            mockMvc.perform(post("/api/migration/approvals/{id}/authorize", APPROVAL_ID))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.message").value("Approval is already APPROVED"));
        }

        @Test
        @DisplayName("404 — non-existent approval ID returns not found")
        @WithMockUserPrincipal(role = "COACH_ADMIN")
        void returns404_whenApprovalNotFound() throws Exception {
            when(approvalRepository.findById(APPROVAL_ID)).thenReturn(Optional.empty());

            mockMvc.perform(post("/api/migration/approvals/{id}/authorize", APPROVAL_ID))
                    .andExpect(status().isNotFound());
        }

    }

    // ─────────────────────────────────────────────────────────────────────────
    // POST /{id}/member-approve
    // ─────────────────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("POST /{id}/member-approve")
    class MemberApprove {

        @Test
        @DisplayName("200 — tenant admin approves their gate")
        @WithMockUserPrincipal(role = "TENANT_ADMIN", tenantId = "00000000-0000-0000-0000-000000000002")
        void returns200_whenMemberApproves() throws Exception {
            when(approvalRepository.findById(APPROVAL_ID)).thenReturn(Optional.of(pendingMemberApproval));
            when(phaseGateService.checkAndClearGate(gate)).thenReturn(GateStatus.PENDING);

            mockMvc.perform(post("/api/migration/approvals/{id}/member-approve", APPROVAL_ID))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.approvalStatus").value("APPROVED"));

            assertThat(pendingMemberApproval.getApprovalStatus()).isEqualTo(ApprovalStatus.APPROVED);
            verify(phaseGateService).checkAndClearGate(gate);
        }

        @Test
        @DisplayName("403 — member from different tenant cannot approve")
        @WithMockUserPrincipal(role = "TENANT_ADMIN", tenantId = "dddddddd-0000-0000-0000-000000000001")
        void returns403_whenDifferentTenant() throws Exception {
            // Simulate JWT filter setting TenantContext to the USER's own tenant (different from approval's tenant)
            TenantContext.setCurrentTenantId(UUID.fromString("dddddddd-0000-0000-0000-000000000001"));
            when(approvalRepository.findById(APPROVAL_ID)).thenReturn(Optional.of(pendingMemberApproval));

            mockMvc.perform(post("/api/migration/approvals/{id}/member-approve", APPROVAL_ID))
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.message").exists());
        }

        @Test
        @DisplayName("400 — coach role approval cannot be member-approved")
        @WithMockUserPrincipal(role = "TENANT_ADMIN", tenantId = "00000000-0000-0000-0000-000000000002")
        void returns400_whenApprovalRequiresCoach() throws Exception {
            // The approval is for COACH_ADMIN, but member is trying to member-approve it
            when(approvalRepository.findById(APPROVAL_ID)).thenReturn(Optional.of(pendingCoachApproval));

            mockMvc.perform(post("/api/migration/approvals/{id}/member-approve", APPROVAL_ID))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.message").value("This approval requires a coach, not a member"));
        }

        @Test
        @DisplayName("400 — already approved approval returns bad request")
        @WithMockUserPrincipal(role = "TENANT_ADMIN", tenantId = "00000000-0000-0000-0000-000000000002")
        void returns400_whenAlreadyApproved() throws Exception {
            pendingMemberApproval.setApprovalStatus(ApprovalStatus.APPROVED);
            when(approvalRepository.findById(APPROVAL_ID)).thenReturn(Optional.of(pendingMemberApproval));

            mockMvc.perform(post("/api/migration/approvals/{id}/member-approve", APPROVAL_ID))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.message").value("Already APPROVED"));
        }

        @Test
        @DisplayName("404 — approval not found")
        @WithMockUserPrincipal(role = "TENANT_ADMIN", tenantId = "00000000-0000-0000-0000-000000000002")
        void returns404_whenNotFound() throws Exception {
            when(approvalRepository.findById(APPROVAL_ID)).thenReturn(Optional.empty());

            mockMvc.perform(post("/api/migration/approvals/{id}/member-approve", APPROVAL_ID))
                    .andExpect(status().isNotFound());
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GET /project/{projectId}
    // ─────────────────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("GET /project/{projectId}")
    class ListByProject {

        @Test
        @DisplayName("200 — returns list of approval records including gateApprovalMode")
        @WithMockUserPrincipal(role = "COACH_ADMIN")
        void returns200_withApprovalList() throws Exception {
            ApprovalRequest approved = buildApproval(UUID.randomUUID(), "COACH_ADMIN", ApprovalStatus.APPROVED);
            when(approvalRepository.findByProjectIdOrderByCreatedAtDesc(PROJECT_ID))
                    .thenReturn(List.of(approved));

            mockMvc.perform(get("/api/migration/approvals/project/{id}", PROJECT_ID))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$").isArray())
                    .andExpect(jsonPath("$[0].requiredRole").value("COACH_ADMIN"))
                    .andExpect(jsonPath("$[0].approvalStatus").value("APPROVED"))
                    .andExpect(jsonPath("$[0].gateApprovalMode").value("BOTH"));
        }

        @Test
        @DisplayName("200 — returns empty list when no approvals for project")
        @WithMockUserPrincipal(role = "COACH_ADMIN")
        void returns200_emptyList() throws Exception {
            when(approvalRepository.findByProjectIdOrderByCreatedAtDesc(PROJECT_ID))
                    .thenReturn(List.of());

            mockMvc.perform(get("/api/migration/approvals/project/{id}", PROJECT_ID))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$").isArray())
                    .andExpect(jsonPath("$").isEmpty());
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // POST /{id}/reject
    // ─────────────────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("POST /{id}/reject")
    class Reject {

        @Test
        @DisplayName("200 — coach can reject a pending approval with a reason")
        @WithMockUserPrincipal(role = "COACH_ADMIN")
        void returns200_whenRejected() throws Exception {
            when(approvalRepository.findById(APPROVAL_ID)).thenReturn(Optional.of(pendingCoachApproval));

            mockMvc.perform(post("/api/migration/approvals/{id}/reject", APPROVAL_ID)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"reason\":\"Data quality issues found\"}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.approvalStatus").value("REJECTED"));

            verify(phaseGateRepository).save(argThat(g -> g.getGateStatus() == GateStatus.BLOCKED));
        }

        @Test
        @DisplayName("200 — reject without reason body also works")
        @WithMockUserPrincipal(role = "COACH_ADMIN")
        void returns200_rejectWithNoReason() throws Exception {
            when(approvalRepository.findById(APPROVAL_ID)).thenReturn(Optional.of(pendingCoachApproval));

            mockMvc.perform(post("/api/migration/approvals/{id}/reject", APPROVAL_ID))
                    .andExpect(status().isOk());
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    private ApprovalRequest buildApproval(UUID id, String role, ApprovalStatus status) {
        ApprovalRequest req = new ApprovalRequest();
        req.setId(id);
        req.setRequiredRole(role);
        req.setApprovalStatus(status);
        req.setGateType("MAP");
        req.setTitle("Test Approval");
        req.setPhaseGate(gate);
        req.setProject(project);
        req.setTenant(tenant);
        req.setCreatedAt(Instant.now());
        return req;
    }
}
