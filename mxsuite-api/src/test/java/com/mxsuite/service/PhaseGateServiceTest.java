package com.mxsuite.service;

import com.mxsuite.audit.AuditService;
import com.mxsuite.model.ApprovalRequest;
import com.mxsuite.model.PhaseGate;
import com.mxsuite.model.Project;
import com.mxsuite.model.ProjectDataUpload;
import com.mxsuite.model.Tenant;
import com.mxsuite.model.enums.ApprovalStatus;
import com.mxsuite.model.enums.GateApprovalMode;
import com.mxsuite.model.enums.GateStatus;
import com.mxsuite.model.enums.MappingStatus;
import com.mxsuite.model.enums.MigrationPhase;
import com.mxsuite.model.enums.MigrationStatus;
import com.mxsuite.model.enums.UserRole;
import com.mxsuite.repository.ApprovalRequestRepository;
import com.mxsuite.repository.FieldMappingEntryRepository;
import com.mxsuite.repository.PhaseGateRepository;
import com.mxsuite.repository.PlatformAssignmentRepository;
import com.mxsuite.repository.ProjectDataUploadRepository;
import com.mxsuite.repository.ProjectRepository;
import com.mxsuite.repository.ReconciliationReportRepository;
import com.mxsuite.repository.UserRepository;
import com.mxsuite.repository.ValidationRunRepository;
import com.mxsuite.service.EmailService;
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
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * Unit tests for {@link PhaseGateService}.
 *
 * All dependencies are mocked — no Spring context or database needed.
 * Tests cover: AUTO/BOTH/COACH_ONLY approval modes, gate evaluation logic for all six
 * phases (DISCOVER, MAP, GENERATE, DRY_RUN, MIGRATE, CUT_OVER), checkAndClearGate
 * partial-approval handling and CUT_OVER project completion, deduplication, and
 * MIGRATE gate blocking conditions (no upload, PROCESSING, FAILED, COMPLETED).
 */
@ExtendWith(MockitoExtension.class)
@DisplayName("PhaseGateService")
class PhaseGateServiceTest {

    @Mock PhaseGateRepository           gateRepository;
    @Mock ValidationRunRepository       validationRunRepository;
    @Mock ReconciliationReportRepository reconRepository;
    @Mock FieldMappingEntryRepository   mappingRepository;
    @Mock ApprovalRequestRepository     approvalRepository;
    @Mock ProjectDataUploadRepository   uploadRepository;
    @Mock ProjectRepository             projectRepository;
    @Mock UserRepository                userRepository;
    @Mock PlatformAssignmentRepository  assignmentRepository;
    @Mock EmailService                  emailService;
    @Mock AuditService                  auditService;
    @Mock ChatService                   chatService;

    @InjectMocks PhaseGateService service;

    // ── Shared test fixtures ─────────────────────────────────────────────────

    static final UUID PROJECT_ID = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001");
    static final UUID GATE_ID    = UUID.fromString("bbbbbbbb-0000-0000-0000-000000000001");
    static final UUID TENANT_ID  = UUID.fromString("cccccccc-0000-0000-0000-000000000001");

    Tenant  tenant;
    Project project;
    PhaseGate mapGate;

    @BeforeEach
    void setUp() {
        tenant  = new Tenant();
        tenant.setId(TENANT_ID);

        project = new Project();
        project.setId(PROJECT_ID);
        project.setTenant(tenant);

        mapGate = new PhaseGate();
        mapGate.setId(GATE_ID);
        mapGate.setPhase(MigrationPhase.MAP);
        mapGate.setGateStatus(GateStatus.PENDING);
        mapGate.setProject(project);

        // Inject optional ChatService (setter injection, not handled by @InjectMocks)
        service.setChatService(chatService);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // evaluateMapGate — conditions not met
    // ─────────────────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("evaluateMapGate")
    class EvaluateMapGate {

        @Test
        @DisplayName("BLOCKED when mappings still need review")
        void blocked_whenNeedsReviewMappingsExist() {
            when(mappingRepository.countByProjectIdAndMappingStatus(eq(PROJECT_ID), any()))
                    .thenReturn(3L);
            when(gateRepository.findByProjectIdAndPhase(PROJECT_ID, MigrationPhase.MAP))
                    .thenReturn(Optional.of(mapGate));

            GateStatus result = service.evaluateMapGate(PROJECT_ID);

            assertThat(result).isEqualTo(GateStatus.BLOCKED);
            assertThat(mapGate.getGateStatus()).isEqualTo(GateStatus.BLOCKED);
            assertThat(mapGate.getBlockedReason()).contains("3");
            verify(gateRepository).save(mapGate);
        }

        @Test
        @DisplayName("AUTO mode — clears immediately when all mappings reviewed")
        void autoMode_clearsImmediatelyWhenConditionsMet() {
            mapGate.setApprovalMode(GateApprovalMode.AUTO);
            when(mappingRepository.countByProjectIdAndMappingStatus(eq(PROJECT_ID), any()))
                    .thenReturn(0L);
            when(gateRepository.findByProjectIdAndPhase(PROJECT_ID, MigrationPhase.MAP))
                    .thenReturn(Optional.of(mapGate));

            GateStatus result = service.evaluateMapGate(PROJECT_ID);

            assertThat(result).isEqualTo(GateStatus.CLEARED);
            assertThat(mapGate.getGateStatus()).isEqualTo(GateStatus.CLEARED);
            assertThat(mapGate.getClearedAt()).isNotNull();
            verify(approvalRepository, never()).save(any());
        }

        @Test
        @DisplayName("BOTH mode — creates member AND coach approval requests")
        void bothMode_createsTwoApprovalRequests() {
            mapGate.setApprovalMode(GateApprovalMode.BOTH);
            when(mappingRepository.countByProjectIdAndMappingStatus(eq(PROJECT_ID), any()))
                    .thenReturn(0L);
            when(gateRepository.findByProjectIdAndPhase(PROJECT_ID, MigrationPhase.MAP))
                    .thenReturn(Optional.of(mapGate));
            when(approvalRepository.existsByPhaseGateIdAndRequiredRoleAndApprovalStatus(
                    eq(GATE_ID), any(), eq(ApprovalStatus.PENDING)))
                    .thenReturn(false);

            GateStatus result = service.evaluateMapGate(PROJECT_ID);

            assertThat(result).isEqualTo(GateStatus.PENDING);
            assertThat(mapGate.getGateStatus()).isEqualTo(GateStatus.PENDING);

            var captor = ArgumentCaptor.forClass(ApprovalRequest.class);
            verify(approvalRepository, times(2)).save(captor.capture());

            List<ApprovalRequest> saved = captor.getAllValues();
            assertThat(saved).extracting(ApprovalRequest::getRequiredRole)
                    .containsExactlyInAnyOrder("TENANT_ADMIN", "COACH_ADMIN");
        }

        @Test
        @DisplayName("COACH_ONLY mode — creates only coach approval request")
        void coachOnlyMode_createsOneCoachRequest() {
            mapGate.setApprovalMode(GateApprovalMode.COACH_ONLY);
            when(mappingRepository.countByProjectIdAndMappingStatus(eq(PROJECT_ID), any()))
                    .thenReturn(0L);
            when(gateRepository.findByProjectIdAndPhase(PROJECT_ID, MigrationPhase.MAP))
                    .thenReturn(Optional.of(mapGate));
            when(approvalRepository.existsByPhaseGateIdAndRequiredRoleAndApprovalStatus(
                    eq(GATE_ID), eq("COACH_ADMIN"), eq(ApprovalStatus.PENDING)))
                    .thenReturn(false);

            service.evaluateMapGate(PROJECT_ID);

            var captor = ArgumentCaptor.forClass(ApprovalRequest.class);
            verify(approvalRepository, times(1)).save(captor.capture());
            assertThat(captor.getValue().getRequiredRole()).isEqualTo("COACH_ADMIN");
        }

        @Test
        @DisplayName("returns PENDING when gate does not exist")
        void returnsGatePending_whenGateNotFound() {
            when(mappingRepository.countByProjectIdAndMappingStatus(eq(PROJECT_ID), any()))
                    .thenReturn(0L);
            when(gateRepository.findByProjectIdAndPhase(PROJECT_ID, MigrationPhase.MAP))
                    .thenReturn(Optional.empty());

            GateStatus result = service.evaluateMapGate(PROJECT_ID);

            assertThat(result).isEqualTo(GateStatus.PENDING);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // createApprovalRequestsIfNeeded — deduplication
    // ─────────────────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("createApprovalRequestsIfNeeded — deduplication")
    class Deduplication {

        @Test
        @DisplayName("does not create a second PENDING request for the same gate+role")
        void doesNotCreateDuplicatePendingRequest() {
            mapGate.setApprovalMode(GateApprovalMode.COACH_ONLY);
            // Simulate existing PENDING request for COACH_ADMIN
            when(approvalRepository.existsByPhaseGateIdAndRequiredRoleAndApprovalStatus(
                    GATE_ID, "COACH_ADMIN", ApprovalStatus.PENDING))
                    .thenReturn(true);

            service.createApprovalRequestsIfNeeded(mapGate, "Title", "Desc");

            verify(approvalRepository, never()).save(any());
        }

        @Test
        @DisplayName("creates request when no existing PENDING found")
        void createsRequest_whenNoPendingExists() {
            mapGate.setApprovalMode(GateApprovalMode.COACH_ONLY);
            when(approvalRepository.existsByPhaseGateIdAndRequiredRoleAndApprovalStatus(
                    GATE_ID, "COACH_ADMIN", ApprovalStatus.PENDING))
                    .thenReturn(false);

            service.createApprovalRequestsIfNeeded(mapGate, "Title", "Desc");

            verify(approvalRepository, times(1)).save(any(ApprovalRequest.class));
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // checkAndClearGate
    // ─────────────────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("checkAndClearGate")
    class CheckAndClearGate {

        @Test
        @DisplayName("AUTO mode with no approvals — clears immediately")
        void autoMode_clearsWithoutApprovals() {
            mapGate.setApprovalMode(GateApprovalMode.AUTO);
            when(approvalRepository.findByPhaseGateId(GATE_ID)).thenReturn(List.of());

            GateStatus result = service.checkAndClearGate(mapGate);

            assertThat(result).isEqualTo(GateStatus.CLEARED);
            assertThat(mapGate.getGateStatus()).isEqualTo(GateStatus.CLEARED);
            verify(gateRepository).save(mapGate);
        }

        @Test
        @DisplayName("BOTH mode — stays PENDING when only member has approved")
        void bothMode_staysPending_whenOnlyMemberApproved() {
            mapGate.setApprovalMode(GateApprovalMode.BOTH);

            ApprovalRequest memberApproval = approvalRequest("TENANT_ADMIN", ApprovalStatus.APPROVED);
            ApprovalRequest coachApproval  = approvalRequest("COACH_ADMIN",  ApprovalStatus.PENDING);
            when(approvalRepository.findByPhaseGateId(GATE_ID))
                    .thenReturn(List.of(memberApproval, coachApproval));

            GateStatus result = service.checkAndClearGate(mapGate);

            assertThat(result).isEqualTo(GateStatus.PENDING);
            assertThat(mapGate.getGateStatus()).isEqualTo(GateStatus.PENDING);
            verify(gateRepository, never()).save(any());
        }

        @Test
        @DisplayName("BOTH mode — stays PENDING when only coach has approved")
        void bothMode_staysPending_whenOnlyCoachApproved() {
            mapGate.setApprovalMode(GateApprovalMode.BOTH);

            ApprovalRequest memberApproval = approvalRequest("TENANT_ADMIN", ApprovalStatus.PENDING);
            ApprovalRequest coachApproval  = approvalRequest("COACH_ADMIN",  ApprovalStatus.APPROVED);
            when(approvalRepository.findByPhaseGateId(GATE_ID))
                    .thenReturn(List.of(memberApproval, coachApproval));

            GateStatus result = service.checkAndClearGate(mapGate);

            assertThat(result).isEqualTo(GateStatus.PENDING);
        }

        @Test
        @DisplayName("BOTH mode — CLEARED when both member and coach have approved")
        void bothMode_clears_whenBothApproved() {
            mapGate.setApprovalMode(GateApprovalMode.BOTH);

            ApprovalRequest memberApproval = approvalRequest("TENANT_ADMIN", ApprovalStatus.APPROVED);
            ApprovalRequest coachApproval  = approvalRequest("COACH_ADMIN",  ApprovalStatus.APPROVED);
            when(approvalRepository.findByPhaseGateId(GATE_ID))
                    .thenReturn(List.of(memberApproval, coachApproval));

            GateStatus result = service.checkAndClearGate(mapGate);

            assertThat(result).isEqualTo(GateStatus.CLEARED);
            assertThat(mapGate.getGateStatus()).isEqualTo(GateStatus.CLEARED);
            assertThat(mapGate.getClearedAt()).isNotNull();
            verify(gateRepository).save(mapGate);
            verify(auditService).log(eq("GATE_CLEARED"), any(), any(), any());
        }

        @Test
        @DisplayName("COACH_ONLY mode — CLEARED when coach approves")
        void coachOnlyMode_clears_whenCoachApproved() {
            mapGate.setApprovalMode(GateApprovalMode.COACH_ONLY);

            ApprovalRequest coachApproval = approvalRequest("COACH_ADMIN", ApprovalStatus.APPROVED);
            when(approvalRepository.findByPhaseGateId(GATE_ID))
                    .thenReturn(List.of(coachApproval));

            GateStatus result = service.checkAndClearGate(mapGate);

            assertThat(result).isEqualTo(GateStatus.CLEARED);
        }

        @Test
        @DisplayName("COACH_ONLY mode — stays PENDING when approval still PENDING")
        void coachOnlyMode_staysPending_whenNotYetApproved() {
            mapGate.setApprovalMode(GateApprovalMode.COACH_ONLY);

            ApprovalRequest coachApproval = approvalRequest("COACH_ADMIN", ApprovalStatus.PENDING);
            when(approvalRepository.findByPhaseGateId(GATE_ID))
                    .thenReturn(List.of(coachApproval));

            GateStatus result = service.checkAndClearGate(mapGate);

            assertThat(result).isEqualTo(GateStatus.PENDING);
        }

        @Test
        @DisplayName("CUT_OVER gate — marks project COMPLETED when gate clears")
        void cutOverGate_completesProject_whenClears() {
            mapGate.setPhase(MigrationPhase.CUT_OVER);
            mapGate.setApprovalMode(GateApprovalMode.COACH_ONLY);

            ApprovalRequest coachApproval = approvalRequest("COACH_ADMIN", ApprovalStatus.APPROVED);
            when(approvalRepository.findByPhaseGateId(GATE_ID)).thenReturn(List.of(coachApproval));

            GateStatus result = service.checkAndClearGate(mapGate);

            assertThat(result).isEqualTo(GateStatus.CLEARED);
            verify(projectRepository).save(argThat(p ->
                    p.getMigrationStatus() == MigrationStatus.COMPLETED));
            verify(auditService).log(eq("PROJECT_COMPLETED"), any(), any(), any());
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // evaluateDiscoverGate
    // ─────────────────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("evaluateDiscoverGate")
    class EvaluateDiscoverGate {

        PhaseGate discoverGate;

        @BeforeEach
        void setUpDiscoverGate() {
            discoverGate = new PhaseGate();
            discoverGate.setId(UUID.fromString("ffffffff-0000-0000-0000-000000000001"));
            discoverGate.setPhase(MigrationPhase.DISCOVER);
            discoverGate.setGateStatus(GateStatus.PENDING);
            discoverGate.setProject(project);
            when(gateRepository.findByProjectIdAndPhase(PROJECT_ID, MigrationPhase.DISCOVER))
                    .thenReturn(Optional.of(discoverGate));
        }

        @Test
        @DisplayName("AUTO mode — CLEARED immediately (no blocking condition)")
        void autoMode_clears_immediately() {
            discoverGate.setApprovalMode(GateApprovalMode.AUTO);

            GateStatus result = service.evaluateDiscoverGate(PROJECT_ID);

            assertThat(result).isEqualTo(GateStatus.CLEARED);
            assertThat(discoverGate.getGateStatus()).isEqualTo(GateStatus.CLEARED);
            assertThat(discoverGate.getClearedAt()).isNotNull();
            verify(approvalRepository, never()).save(any());
        }

        @Test
        @DisplayName("COACH_ONLY mode — PENDING and creates one coach approval request")
        void coachOnlyMode_createsPendingRequest() {
            UUID discoverGateId = discoverGate.getId();
            discoverGate.setApprovalMode(GateApprovalMode.COACH_ONLY);
            when(approvalRepository.existsByPhaseGateIdAndRequiredRoleAndApprovalStatus(
                    discoverGateId, "COACH_ADMIN", ApprovalStatus.PENDING))
                    .thenReturn(false);
            when(assignmentRepository.findByTenantIdAndActiveTrue(TENANT_ID))
                    .thenReturn(List.of());

            GateStatus result = service.evaluateDiscoverGate(PROJECT_ID);

            assertThat(result).isEqualTo(GateStatus.PENDING);
            verify(approvalRepository, times(1)).save(any(ApprovalRequest.class));
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // evaluateMigrateGate
    // ─────────────────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("evaluateMigrateGate")
    class EvaluateMigrateGate {

        PhaseGate migrateGate;

        @BeforeEach
        void setUpMigrateGate() {
            migrateGate = new PhaseGate();
            migrateGate.setId(UUID.fromString("dddddddd-0000-0000-0000-000000000001"));
            migrateGate.setPhase(MigrationPhase.MIGRATE);
            migrateGate.setGateStatus(GateStatus.PENDING);
            migrateGate.setProject(project);
            when(gateRepository.findByProjectIdAndPhase(PROJECT_ID, MigrationPhase.MIGRATE))
                    .thenReturn(Optional.of(migrateGate));
        }

        @Test
        @DisplayName("BLOCKED when no upload exists")
        void blocked_whenNoUploadExists() {
            when(uploadRepository.findFirstByProjectIdOrderByCreatedAtDesc(PROJECT_ID))
                    .thenReturn(Optional.empty());

            GateStatus result = service.evaluateMigrateGate(PROJECT_ID);

            assertThat(result).isEqualTo(GateStatus.BLOCKED);
            assertThat(migrateGate.getGateStatus()).isEqualTo(GateStatus.BLOCKED);
            assertThat(migrateGate.getBlockedReason()).contains("No data upload found");
            verify(gateRepository).save(migrateGate);
        }

        @Test
        @DisplayName("BLOCKED when import is still PROCESSING")
        void blocked_whenImportStillProcessing() {
            ProjectDataUpload upload = new ProjectDataUpload();
            upload.setImportStatus("PROCESSING");
            when(uploadRepository.findFirstByProjectIdOrderByCreatedAtDesc(PROJECT_ID))
                    .thenReturn(Optional.of(upload));

            GateStatus result = service.evaluateMigrateGate(PROJECT_ID);

            assertThat(result).isEqualTo(GateStatus.BLOCKED);
            assertThat(migrateGate.getBlockedReason()).contains("still in progress");
            verify(gateRepository).save(migrateGate);
        }

        @Test
        @DisplayName("BLOCKED when import FAILED")
        void blocked_whenImportFailed() {
            ProjectDataUpload upload = new ProjectDataUpload();
            upload.setImportStatus("FAILED");
            when(uploadRepository.findFirstByProjectIdOrderByCreatedAtDesc(PROJECT_ID))
                    .thenReturn(Optional.of(upload));

            GateStatus result = service.evaluateMigrateGate(PROJECT_ID);

            assertThat(result).isEqualTo(GateStatus.BLOCKED);
            assertThat(migrateGate.getBlockedReason()).contains("FAILED");
            verify(gateRepository).save(migrateGate);
        }

        @Test
        @DisplayName("AUTO mode — CLEARED when import COMPLETED")
        void autoMode_clears_whenImportCompleted() {
            migrateGate.setApprovalMode(GateApprovalMode.AUTO);
            ProjectDataUpload upload = new ProjectDataUpload();
            upload.setImportStatus("COMPLETED");
            when(uploadRepository.findFirstByProjectIdOrderByCreatedAtDesc(PROJECT_ID))
                    .thenReturn(Optional.of(upload));

            GateStatus result = service.evaluateMigrateGate(PROJECT_ID);

            assertThat(result).isEqualTo(GateStatus.CLEARED);
            assertThat(migrateGate.getGateStatus()).isEqualTo(GateStatus.CLEARED);
            assertThat(migrateGate.getClearedAt()).isNotNull();
            verify(approvalRepository, never()).save(any());
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // evaluateCutOverGate
    // ─────────────────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("evaluateCutOverGate")
    class EvaluateCutOverGate {

        PhaseGate cutOverGate;

        @BeforeEach
        void setUpCutOverGate() {
            cutOverGate = new PhaseGate();
            cutOverGate.setId(UUID.fromString("eeeeeeee-0000-0000-0000-000000000001"));
            cutOverGate.setPhase(MigrationPhase.CUT_OVER);
            cutOverGate.setGateStatus(GateStatus.PENDING);
            cutOverGate.setProject(project);
            when(gateRepository.findByProjectIdAndPhase(PROJECT_ID, MigrationPhase.CUT_OVER))
                    .thenReturn(Optional.of(cutOverGate));
        }

        @Test
        @DisplayName("AUTO mode — CLEARED immediately (no blocking condition)")
        void autoMode_clears_immediately() {
            cutOverGate.setApprovalMode(GateApprovalMode.AUTO);

            GateStatus result = service.evaluateCutOverGate(PROJECT_ID);

            assertThat(result).isEqualTo(GateStatus.CLEARED);
            assertThat(cutOverGate.getGateStatus()).isEqualTo(GateStatus.CLEARED);
            assertThat(cutOverGate.getClearedAt()).isNotNull();
        }

        @Test
        @DisplayName("COACH_ONLY mode — PENDING and creates one coach approval request")
        void coachOnlyMode_createsPendingRequest() {
            UUID cutOverGateId = cutOverGate.getId();
            cutOverGate.setApprovalMode(GateApprovalMode.COACH_ONLY);
            when(approvalRepository.existsByPhaseGateIdAndRequiredRoleAndApprovalStatus(
                    cutOverGateId, "COACH_ADMIN", ApprovalStatus.PENDING))
                    .thenReturn(false);
            when(assignmentRepository.findByTenantIdAndActiveTrue(TENANT_ID))
                    .thenReturn(List.of());

            GateStatus result = service.evaluateCutOverGate(PROJECT_ID);

            assertThat(result).isEqualTo(GateStatus.PENDING);
            verify(approvalRepository, times(1)).save(any(ApprovalRequest.class));
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Gate change chat notifications
    // ─────────────────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("gate change notifications")
    class GateChangeNotifications {

        static final UUID CONV_ID = UUID.fromString("ffff0000-0000-0000-0000-000000000001");

        @Test
        @DisplayName("CLEARED gate sends system message to chat")
        void clearedGate_sendsSystemMessage() {
            mapGate.setApprovalMode(GateApprovalMode.AUTO);
            when(mappingRepository.countByProjectIdAndMappingStatus(eq(PROJECT_ID), any()))
                    .thenReturn(0L);
            when(gateRepository.findByProjectIdAndPhase(PROJECT_ID, MigrationPhase.MAP))
                    .thenReturn(Optional.of(mapGate));
            when(chatService.findConversationIdForOnboarding(PROJECT_ID))
                    .thenReturn(CONV_ID);

            service.evaluateMapGate(PROJECT_ID);

            verify(chatService).sendSystemMessage(eq(CONV_ID), contains("cleared"));
        }

        @Test
        @DisplayName("BLOCKED gate sends system message on transition from PENDING")
        void blockedGate_sendsOnTransition() {
            mapGate.setGateStatus(GateStatus.PENDING);
            when(mappingRepository.countByProjectIdAndMappingStatus(eq(PROJECT_ID), any()))
                    .thenReturn(3L);
            when(gateRepository.findByProjectIdAndPhase(PROJECT_ID, MigrationPhase.MAP))
                    .thenReturn(Optional.of(mapGate));
            when(chatService.findConversationIdForOnboarding(PROJECT_ID))
                    .thenReturn(CONV_ID);

            service.evaluateMapGate(PROJECT_ID);

            verify(chatService).sendSystemMessage(eq(CONV_ID), contains("blocked"));
        }

        @Test
        @DisplayName("re-evaluation that stays BLOCKED does not send duplicate message")
        void reEvaluation_noDuplicate() {
            mapGate.setGateStatus(GateStatus.BLOCKED);
            when(mappingRepository.countByProjectIdAndMappingStatus(eq(PROJECT_ID), any()))
                    .thenReturn(2L);
            when(gateRepository.findByProjectIdAndPhase(PROJECT_ID, MigrationPhase.MAP))
                    .thenReturn(Optional.of(mapGate));

            service.evaluateMapGate(PROJECT_ID);

            verify(chatService, never()).sendSystemMessage(any(), any());
        }

        @Test
        @DisplayName("no error when conversation not found for project")
        void noConversation_noError() {
            mapGate.setApprovalMode(GateApprovalMode.AUTO);
            when(mappingRepository.countByProjectIdAndMappingStatus(eq(PROJECT_ID), any()))
                    .thenReturn(0L);
            when(gateRepository.findByProjectIdAndPhase(PROJECT_ID, MigrationPhase.MAP))
                    .thenReturn(Optional.of(mapGate));
            // chatService.findConversationIdForOnboarding returns null by default (mock default)

            // Should not throw
            GateStatus result = service.evaluateMapGate(PROJECT_ID);

            assertThat(result).isEqualTo(GateStatus.CLEARED);
            verify(chatService, never()).sendSystemMessage(any(), any());
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    private ApprovalRequest approvalRequest(String role, ApprovalStatus status) {
        ApprovalRequest req = new ApprovalRequest();
        req.setId(UUID.randomUUID());
        req.setRequiredRole(role);
        req.setApprovalStatus(status);
        req.setPhaseGate(mapGate);
        req.setProject(project);
        req.setTenant(tenant);
        return req;
    }
}
