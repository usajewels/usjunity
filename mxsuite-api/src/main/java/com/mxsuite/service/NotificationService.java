package com.mxsuite.service;

import com.mxsuite.model.Notification;
import com.mxsuite.model.User;
import com.mxsuite.model.enums.UserRole;
import com.mxsuite.repository.NotificationRepository;
import com.mxsuite.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

/**
 * Sends in-app notifications to tenant users when platform coaches take actions
 * on their onboarding data (mapping updates, approvals, etc.).
 */
@Service
public class NotificationService {

    private static final Logger log = LoggerFactory.getLogger(NotificationService.class);

    private final NotificationRepository notificationRepository;
    private final UserRepository userRepository;

    public NotificationService(NotificationRepository notificationRepository,
                                UserRepository userRepository) {
        this.notificationRepository = notificationRepository;
        this.userRepository = userRepository;
    }

    /**
     * Notifies all TENANT_ADMIN users of the given tenant that a mapping was updated by a coach.
     * Runs asynchronously so it never blocks the HTTP response.
     */
    @Async
    @Transactional
    public void notifyMappingUpdated(UUID tenantId, UUID projectId, UUID mappingId,
                                      String fieldLabel, String coachName) {
        sendToTenantAdmins(tenantId, projectId,
                "MAPPING_UPDATED",
                "Field mapping updated",
                coachName + " updated the mapping for \"" + fieldLabel + "\".",
                "FieldMapping", mappingId);
    }

    /**
     * Notifies all TENANT_ADMIN users of the given tenant that a mapping was approved by a coach.
     */
    @Async
    @Transactional
    public void notifyMappingApproved(UUID tenantId, UUID projectId, UUID mappingId,
                                       String fieldLabel, String coachName) {
        sendToTenantAdmins(tenantId, projectId,
                "MAPPING_APPROVED",
                "Field mapping approved",
                coachName + " approved the mapping for \"" + fieldLabel + "\".",
                "FieldMapping", mappingId);
    }

    /**
     * Notifies the other party when a data correction is made.
     * Coach corrections notify the member; member corrections notify the coach.
     */
    @Async
    @Transactional
    public void notifyDataCorrected(UUID tenantId, UUID projectId, UUID issueId,
                                     String fieldName, String correctedValue,
                                     String correctedByName, boolean correctedByCoach) {
        String title = "Data correction: " + fieldName;
        String msg = correctedByName + " corrected \"" + fieldName + "\" to \"" + correctedValue + "\".";

        if (correctedByCoach) {
            sendToTenantAdmins(tenantId, projectId, "DATA_CORRECTION", title, msg,
                    "ValidationIssue", issueId);
        } else {
            sendToProjectCoaches(projectId, tenantId, "DATA_CORRECTION", title, msg,
                    "ValidationIssue", issueId);
        }
    }

    /**
     * Notifies a coach that they have been assigned to an organization.
     */
    @Async
    @Transactional
    public void notifyCoachAssigned(UUID coachId, UUID tenantId, String tenantName, String assignedByName) {
        try {
            Notification n = new Notification();
            n.setRecipientId(coachId);
            n.setTenantId(tenantId);
            n.setType("COACH_ASSIGNED");
            n.setTitle("Assigned to " + tenantName);
            n.setMessage(assignedByName + " assigned you to the organization \"" + tenantName + "\".");
            n.setEntityType("Tenant");
            n.setEntityId(tenantId);
            notificationRepository.save(n);
            log.debug("Sent coach assignment notification to user={} tenant={}", coachId, tenantId);
        } catch (Exception e) {
            log.error("Failed to send coach assignment notification: {}", e.getMessage(), e);
        }
    }

    // -------------------------------------------------------------------------

    private void sendToTenantAdmins(UUID tenantId, UUID projectId,
                                     String type, String title, String message,
                                     String entityType, UUID entityId) {
        try {
            List<User> admins = userRepository.findByTenantIdAndRole(tenantId, UserRole.TENANT_ADMIN);
            for (User admin : admins) {
                Notification n = new Notification();
                n.setRecipientId(admin.getId());
                n.setTenantId(tenantId);
                n.setType(type);
                n.setTitle(title);
                n.setMessage(message);
                n.setEntityType(entityType);
                n.setEntityId(entityId);
                n.setProjectId(projectId);
                notificationRepository.save(n);
            }
            log.debug("Sent {} notifications type={} project={}", admins.size(), type, projectId);
        } catch (Exception e) {
            log.error("Failed to send notifications type={} project={}: {}", type, projectId, e.getMessage(), e);
        }
    }

    private void sendToProjectCoaches(UUID projectId, UUID tenantId,
                                       String type, String title, String message,
                                       String entityType, UUID entityId) {
        try {
            List<User> coaches = userRepository.findActiveCoaches();
            for (User coach : coaches) {
                Notification n = new Notification();
                n.setRecipientId(coach.getId());
                n.setTenantId(tenantId);
                n.setType(type);
                n.setTitle(title);
                n.setMessage(message);
                n.setEntityType(entityType);
                n.setEntityId(entityId);
                n.setProjectId(projectId);
                notificationRepository.save(n);
            }
            log.debug("Sent {} coach notifications type={} project={}", coaches.size(), type, projectId);
        } catch (Exception e) {
            log.error("Failed to send coach notifications type={} project={}: {}", type, projectId, e.getMessage(), e);
        }
    }
}
