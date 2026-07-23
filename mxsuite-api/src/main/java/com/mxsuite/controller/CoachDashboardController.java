package com.mxsuite.controller;

import com.mxsuite.model.AuditEvent;
import com.mxsuite.model.Project;
import com.mxsuite.model.Tenant;
import com.mxsuite.model.enums.*;
import com.mxsuite.repository.*;
import com.mxsuite.security.UserPrincipal;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.stream.Stream;

@RestController
@RequestMapping("/api/admin/coach-dashboard")
@PreAuthorize("hasAnyRole('PLATFORM_ADMIN', 'COACH_ADMIN', 'PLATFORM_SUPPORT')")
@Transactional(readOnly = true)
public class CoachDashboardController {

    private final TenantRepository tenantRepository;
    private final PlatformAssignmentRepository assignmentRepository;
    private final FieldMappingEntryRepository mappingRepository;
    private final PhaseGateRepository phaseGateRepository;
    private final AuditEventRepository auditEventRepository;
    private final SemanticDecisionRepository decisionRepository;
    private final ApprovalRequestRepository approvalRepository;

    public CoachDashboardController(TenantRepository tenantRepository,
                                     PlatformAssignmentRepository assignmentRepository,
                                     FieldMappingEntryRepository mappingRepository,
                                     PhaseGateRepository phaseGateRepository,
                                     AuditEventRepository auditEventRepository,
                                     SemanticDecisionRepository decisionRepository,
                                     ApprovalRequestRepository approvalRepository) {
        this.tenantRepository = tenantRepository;
        this.assignmentRepository = assignmentRepository;
        this.mappingRepository = mappingRepository;
        this.phaseGateRepository = phaseGateRepository;
        this.auditEventRepository = auditEventRepository;
        this.decisionRepository = decisionRepository;
        this.approvalRepository = approvalRepository;
    }

    // --- DTOs ---

    public record CoachDashboardDto(
            int myOrganizations,
            long totalMappingsToReview,
            long openDecisions,
            long pendingApprovals,
            List<OrgProgressDto> organizations,
            Map<String, Long> phaseDistribution,
            List<ActivityDto> recentActivity,
            List<AttentionItemDto> attentionItems) {}

    public record OrgProgressDto(
            UUID id, String name, String slug,
            String phase,
            long mappedCount, long totalMappings, long needsReview,
            boolean hasBlockedGate,
            Instant lastActivity) {}

    public record ActivityDto(
            UUID id, String actorName, String action,
            String entityType, String entityName,
            String tenantName, Instant timestamp) {}

    public record AttentionItemDto(
            String type, String orgName, UUID orgId, String detail) {}

    // --- Endpoint ---

    @GetMapping
    public ResponseEntity<CoachDashboardDto> getDashboard(
            @AuthenticationPrincipal UserPrincipal principal) {

        List<UUID> visibleIds = visibleTenantIds(principal);
        if (visibleIds.isEmpty()) {
            return ResponseEntity.ok(new CoachDashboardDto(
                    0, 0, 0, 0, List.of(), Map.of(), List.of(), List.of()));
        }

        List<Tenant> tenants = tenantRepository.findAllById(visibleIds);

        // Build per-org progress rows
        List<OrgProgressDto> orgRows = new ArrayList<>();
        Map<String, Long> phaseDist = new LinkedHashMap<>();
        List<AttentionItemDto> attentionItems = new ArrayList<>();
        long totalNeedsReview = 0;
        long totalOpenDecisions = 0;
        long totalPendingApprovals = 0;

        Instant sevenDaysAgo = Instant.now().minus(7, ChronoUnit.DAYS);

        for (Tenant tenant : tenants) {
            if (tenant.getTenantType() != TenantType.CUSTOMER) continue;

            Project project = tenant.getOnboardingProject();

            // Count decisions and approvals per tenant
            totalOpenDecisions += decisionRepository.countByTenantIdAndDecisionStatus(
                    tenant.getId(), DecisionStatus.OPEN);
            totalPendingApprovals += approvalRepository.countByTenantIdAndApprovalStatus(
                    tenant.getId(), ApprovalStatus.PENDING);

            if (project == null) {
                // No onboarding project yet
                orgRows.add(new OrgProgressDto(
                        tenant.getId(), tenant.getName(), tenant.getSlug(),
                        null, 0, 0, 0, false, null));
                attentionItems.add(new AttentionItemDto(
                        "NO_UPLOAD", tenant.getName(), tenant.getId(),
                        "No onboarding data uploaded yet"));
                continue;
            }

            UUID pid = project.getId();

            // Mapping counts
            long mapped = mappingRepository.countByProjectIdAndMappingStatus(pid, MappingStatus.MAPPED);
            long needsReview = mappingRepository.countByProjectIdAndMappingStatus(pid, MappingStatus.NEEDS_REVIEW);
            long unmapped = mappingRepository.countByProjectIdAndMappingStatus(pid, MappingStatus.UNMAPPED);
            long cfv = mappingRepository.countByProjectIdAndMappingStatus(pid, MappingStatus.CFV_PROPOSAL);
            long rejected = mappingRepository.countByProjectIdAndMappingStatus(pid, MappingStatus.REJECTED);
            long total = mapped + needsReview + unmapped + cfv + rejected;

            totalNeedsReview += needsReview;

            // Phase
            String phase = project.getMigrationPhase() != null
                    ? project.getMigrationPhase().name() : null;
            if (phase != null) {
                phaseDist.merge(phase, 1L, Long::sum);
            }

            // Blocked gates
            boolean hasBlocked = phaseGateRepository.countByProjectIdAndGateStatus(
                    pid, GateStatus.BLOCKED) > 0;

            // Last activity
            var recentPage = auditEventRepository.findByTenantIdOrderByTimestampDesc(
                    tenant.getId(), PageRequest.of(0, 1));
            Instant lastActivity = recentPage.hasContent()
                    ? recentPage.getContent().get(0).getTimestamp() : null;

            orgRows.add(new OrgProgressDto(
                    tenant.getId(), tenant.getName(), tenant.getSlug(),
                    phase, mapped, total, needsReview,
                    hasBlocked, lastActivity));

            // Attention: blocked gate
            if (hasBlocked) {
                attentionItems.add(new AttentionItemDto(
                        "BLOCKED_GATE", tenant.getName(), tenant.getId(),
                        "Phase gate blocked at " + (phase != null ? phase : "unknown")));
            }

            // Attention: inactive
            if (lastActivity != null && lastActivity.isBefore(sevenDaysAgo)) {
                long days = ChronoUnit.DAYS.between(lastActivity, Instant.now());
                attentionItems.add(new AttentionItemDto(
                        "INACTIVE", tenant.getName(), tenant.getId(),
                        "No activity in " + days + " days"));
            } else if (lastActivity == null && total == 0) {
                // Has a project but no mappings and no activity
                attentionItems.add(new AttentionItemDto(
                        "NO_UPLOAD", tenant.getName(), tenant.getId(),
                        "No onboarding data uploaded yet"));
            }
        }

        // Recent activity across all visible tenants
        var activityPage = auditEventRepository.findByTenantIdInOrderByTimestampDesc(
                visibleIds, PageRequest.of(0, 15));
        List<ActivityDto> recentActivity = activityPage.getContent().stream()
                .map(e -> {
                    String tenantName = tenants.stream()
                            .filter(t -> t.getId().equals(e.getTenantId()))
                            .map(Tenant::getName)
                            .findFirst().orElse("Unknown");
                    return new ActivityDto(
                            e.getId(), e.getActorName(), e.getAction(),
                            e.getEntityType(), e.getEntityName(),
                            tenantName, e.getTimestamp());
                })
                .toList();

        // Sort orgs: blocked first, then by needsReview desc
        orgRows.sort((a, b) -> {
            if (a.hasBlockedGate() != b.hasBlockedGate())
                return a.hasBlockedGate() ? -1 : 1;
            return Long.compare(b.needsReview(), a.needsReview());
        });

        return ResponseEntity.ok(new CoachDashboardDto(
                orgRows.size(),
                totalNeedsReview,
                totalOpenDecisions,
                totalPendingApprovals,
                orgRows,
                phaseDist,
                recentActivity,
                attentionItems));
    }

    // --- Helpers ---

    private List<UUID> visibleTenantIds(UserPrincipal principal) {
        if (principal.isPlatformAdmin() || principal.isCoachAdmin()) {
            return tenantRepository.findAll().stream()
                    .filter(t -> t.getTenantType() == TenantType.CUSTOMER)
                    .map(Tenant::getId)
                    .toList();
        }
        List<UUID> assigned = assignmentRepository.findByPlatformUserIdAndActiveTrue(principal.id())
                .stream().map(a -> a.getTenant().getId()).toList();
        List<UUID> openToAll = tenantRepository.findByOpenToAllCoachesTrue()
                .stream().map(Tenant::getId).toList();
        return Stream.concat(assigned.stream(), openToAll.stream())
                .distinct().toList();
    }
}
