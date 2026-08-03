package com.mxsuite.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mxsuite.audit.AuditService;
import com.mxsuite.model.PhaseGate;
import com.mxsuite.model.Project;
import com.mxsuite.model.Tenant;
import com.mxsuite.model.enums.GateApprovalMode;
import com.mxsuite.model.enums.GateStatus;
import com.mxsuite.model.enums.MigrationPhase;
import com.mxsuite.repository.ApprovalRequestRepository;
import com.mxsuite.repository.MigrationBlueprintRepository;
import com.mxsuite.repository.PhaseGateRepository;
import com.mxsuite.repository.PhaseTimeEntryRepository;
import com.mxsuite.repository.PlatformAssignmentRepository;
import com.mxsuite.repository.ProjectDataUploadRepository;
import com.mxsuite.repository.ProjectRepository;
import com.mxsuite.repository.ReconciliationReportRepository;
import com.mxsuite.repository.TenantRepository;
import com.mxsuite.service.DataValidationService;
import com.mxsuite.config.SecurityConfig;
import com.mxsuite.security.JwtAuthenticationFilter;
import com.mxsuite.security.RateLimitFilter;
import com.mxsuite.security.WithMockUserPrincipal;
import com.mxsuite.service.PhaseGateService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.data.jpa.mapping.JpaMetamodelMappingContext;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * MockMvc tests for {@link MigrationDashboardController} focusing on the
 * gate-approval-mode endpoint added in the phase gate approval modes feature.
 */
@WebMvcTest(MigrationDashboardController.class)
@AutoConfigureMockMvc(addFilters = false)
@Import(SecurityConfig.class)
@MockBean(JpaMetamodelMappingContext.class)
@DisplayName("MigrationDashboardController — gate approval mode")
class MigrationDashboardControllerTest {

    // ── Infrastructure mocks ─────────────────────────────────────────────────
    @MockBean JwtAuthenticationFilter jwtAuthenticationFilter;
    @MockBean RateLimitFilter         rateLimitFilter;

    // ── Domain mocks — mock everything the controller touches ────────────────
    @MockBean ProjectRepository              projectRepository;
    @MockBean PhaseGateRepository            phaseGateRepository;
    @MockBean PhaseTimeEntryRepository       phaseTimeEntryRepository;
    @MockBean MigrationBlueprintRepository   blueprintRepository;
    @MockBean PlatformAssignmentRepository   assignmentRepository;
    @MockBean ProjectDataUploadRepository    uploadRepository;
    @MockBean TenantRepository               tenantRepository;
    @MockBean ApprovalRequestRepository      approvalRepository;
    @MockBean ReconciliationReportRepository reconRepository;
    @MockBean PhaseGateService               phaseGateService;
    @MockBean DataValidationService          dataValidationService;
    @MockBean AuditService                   auditService;

    @Autowired MockMvc     mockMvc;
    @Autowired ObjectMapper objectMapper;

    static final UUID PROJECT_ID = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001");
    static final UUID GATE_ID    = UUID.fromString("bbbbbbbb-0000-0000-0000-000000000001");
    static final UUID TENANT_ID  = UUID.fromString("cccccccc-0000-0000-0000-000000000001");

    PhaseGate mapGate;
    Project   project;

    @BeforeEach
    void setUp() {
        Tenant tenant = new Tenant();
        tenant.setId(TENANT_ID);

        project = new Project();
        project.setId(PROJECT_ID);
        project.setTenant(tenant);

        mapGate = new PhaseGate();
        mapGate.setId(GATE_ID);
        mapGate.setPhase(MigrationPhase.MAP);
        mapGate.setGateStatus(GateStatus.PENDING);
        mapGate.setApprovalMode(GateApprovalMode.BOTH);
        mapGate.setProject(project);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PUT /api/migration/projects/{projectId}/gates/{phase}/approval-mode
    // ─────────────────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("PUT /projects/{projectId}/gates/{phase}/approval-mode")
    class UpdateGateApprovalMode {

        @Test
        @DisplayName("200 — COACH_ADMIN can change MAP gate from BOTH to AUTO")
        @WithMockUserPrincipal(role = "COACH_ADMIN")
        void returns200_whenCoachUpdatesMode() throws Exception {
            when(phaseGateRepository.findByProjectIdAndPhase(PROJECT_ID, MigrationPhase.MAP))
                    .thenReturn(Optional.of(mapGate));

            mockMvc.perform(put("/api/migration/projects/{projectId}/gates/{phase}/approval-mode",
                            PROJECT_ID, "MAP")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"approvalMode\":\"AUTO\"}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.phase").value("MAP"))
                    .andExpect(jsonPath("$.approvalMode").value("AUTO"));

            assertThat(mapGate.getApprovalMode()).isEqualTo(GateApprovalMode.AUTO);
            verify(phaseGateRepository).save(mapGate);
            verify(auditService).log(eq("UPDATE_GATE_APPROVAL_MODE"), any(), any(), any());
        }

        @Test
        @DisplayName("200 — PLATFORM_ADMIN can also change approval mode")
        @WithMockUserPrincipal(role = "PLATFORM_ADMIN")
        void returns200_whenPlatformAdminUpdatesMode() throws Exception {
            when(phaseGateRepository.findByProjectIdAndPhase(PROJECT_ID, MigrationPhase.MAP))
                    .thenReturn(Optional.of(mapGate));

            mockMvc.perform(put("/api/migration/projects/{projectId}/gates/{phase}/approval-mode",
                            PROJECT_ID, "MAP")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"approvalMode\":\"COACH_ONLY\"}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.approvalMode").value("COACH_ONLY"));
        }

        @Test
        @DisplayName("403 — TENANT_ADMIN cannot change gate approval mode")
        @WithMockUserPrincipal(role = "TENANT_ADMIN")
        void returns403_whenMemberAttemptsUpdate() throws Exception {
            mockMvc.perform(put("/api/migration/projects/{projectId}/gates/{phase}/approval-mode",
                            PROJECT_ID, "MAP")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"approvalMode\":\"AUTO\"}"))
                    .andExpect(status().isForbidden());

            verify(phaseGateRepository, never()).save(any());
        }

        @Test
        @DisplayName("403 — PLATFORM_SUPPORT cannot change gate approval mode")
        @WithMockUserPrincipal(role = "PLATFORM_SUPPORT")
        void returns403_whenSupportAttemptsUpdate() throws Exception {
            mockMvc.perform(put("/api/migration/projects/{projectId}/gates/{phase}/approval-mode",
                            PROJECT_ID, "MAP")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"approvalMode\":\"AUTO\"}"))
                    .andExpect(status().isForbidden());
        }

        @Test
        @DisplayName("404 — gate not found for project/phase combination")
        @WithMockUserPrincipal(role = "COACH_ADMIN")
        void returns404_whenGateNotFound() throws Exception {
            when(phaseGateRepository.findByProjectIdAndPhase(PROJECT_ID, MigrationPhase.MAP))
                    .thenReturn(Optional.empty());

            mockMvc.perform(put("/api/migration/projects/{projectId}/gates/{phase}/approval-mode",
                            PROJECT_ID, "MAP")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"approvalMode\":\"AUTO\"}"))
                    .andExpect(status().isNotFound());
        }

        @Test
        @DisplayName("can set every valid approval mode")
        @WithMockUserPrincipal(role = "COACH_ADMIN")
        void canSetEveryMode() throws Exception {
            for (GateApprovalMode mode : GateApprovalMode.values()) {
                when(phaseGateRepository.findByProjectIdAndPhase(PROJECT_ID, MigrationPhase.MAP))
                        .thenReturn(Optional.of(mapGate));

                mockMvc.perform(put("/api/migration/projects/{projectId}/gates/{phase}/approval-mode",
                                PROJECT_ID, "MAP")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"approvalMode\":\"" + mode.name() + "\"}"))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.approvalMode").value(mode.name()));
            }
        }
    }
}
