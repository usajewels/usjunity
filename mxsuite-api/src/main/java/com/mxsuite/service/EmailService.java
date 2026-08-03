package com.mxsuite.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

@Service
public class EmailService {

    private static final Logger log = LoggerFactory.getLogger(EmailService.class);

    private final JavaMailSender mailSender;
    private final String fromAddress;
    private final String appBaseUrl;

    public EmailService(JavaMailSender mailSender,
                        @Value("${mxsuite.email.from:noreply@growthzone.com}") String fromAddress,
                        @Value("${mxsuite.app.base-url:http://localhost:3000}") String appBaseUrl) {
        this.mailSender = mailSender;
        this.fromAddress = fromAddress;
        this.appBaseUrl = appBaseUrl;
    }

    @Async
    public void sendInvitation(String toEmail, String inviterName, String tenantName, String token) {
        try {
            String acceptUrl = appBaseUrl + "/accept-invite?token=" + token;

            SimpleMailMessage message = new SimpleMailMessage();
            message.setFrom(fromAddress);
            message.setTo(toEmail);
            message.setSubject("You've been invited to " + tenantName + " on GrowthZone");
            message.setText(
                "Hello,\n\n" +
                inviterName + " has invited you to join " + tenantName + " on GrowthZone.\n\n" +
                "Click the link below to accept and set up your account:\n" +
                acceptUrl + "\n\n" +
                "This invitation expires in 7 days.\n\n" +
                "If you did not expect this invitation, you can safely ignore this email.\n\n" +
                "— The GrowthZone Team"
            );
            mailSender.send(message);
            log.info("Invitation email sent to {}", toEmail);
        } catch (Exception e) {
            log.error("Failed to send invitation email to {}: {}", toEmail, e.getMessage(), e);
        }
    }

    @Async
    public void sendPasswordReset(String toEmail, String userName, String token) {
        try {
            String resetUrl = appBaseUrl + "/reset-password?token=" + token;

            SimpleMailMessage message = new SimpleMailMessage();
            message.setFrom(fromAddress);
            message.setTo(toEmail);
            message.setSubject("GrowthZone — Password Reset Request");
            message.setText(
                "Hello " + userName + ",\n\n" +
                "We received a request to reset your GrowthZone password.\n\n" +
                "Click the link below to set a new password:\n" +
                resetUrl + "\n\n" +
                "This link expires in 1 hour.\n\n" +
                "If you did not request a password reset, you can safely ignore this email. " +
                "Your password will remain unchanged.\n\n" +
                "— The GrowthZone Team"
            );
            mailSender.send(message);
            log.info("Password reset email sent to {}", toEmail);
        } catch (Exception e) {
            log.error("Failed to send password reset email to {}: {}", toEmail, e.getMessage(), e);
        }
    }

    @Async
    public void sendAdminAlert(String toEmail, String subject, String body) {
        try {
            SimpleMailMessage message = new SimpleMailMessage();
            message.setFrom(fromAddress);
            message.setTo(toEmail);
            message.setSubject("[GrowthZone ALERT] " + subject);
            message.setText(body);
            mailSender.send(message);
            log.info("Admin alert email sent to {}: {}", toEmail, subject);
        } catch (Exception e) {
            log.error("Failed to send admin alert email: {}", e.getMessage(), e);
        }
    }

    @Async
    public void sendGateApprovalNotification(String toEmail, String reviewerName,
                                              String projectName, String phase,
                                              String title, String description) {
        try {
            SimpleMailMessage message = new SimpleMailMessage();
            message.setFrom(fromAddress);
            message.setTo(toEmail);
            message.setSubject("Action Required: " + phase + " gate approval — " + projectName);
            message.setText(
                "Hi " + reviewerName + ",\n\n" +
                "A " + phase + " gate is awaiting your review for project: " + projectName + "\n\n" +
                title + "\n\n" +
                description + "\n\n" +
                "Log in to the GrowthZone Migration Portal to take action:\n" +
                appBaseUrl + "/migration/approvals\n\n" +
                "— GrowthZone Migration Platform"
            );
            mailSender.send(message);
            log.info("Gate approval notification sent to {} for project={} phase={}", toEmail, projectName, phase);
        } catch (Exception e) {
            log.error("Failed to send gate approval notification to {}: {}", toEmail, e.getMessage(), e);
        }
    }

    @Async
    public void sendProjectCompletedNotification(String toEmail, String recipientName,
                                                  String projectName) {
        try {
            SimpleMailMessage message = new SimpleMailMessage();
            message.setFrom(fromAddress);
            message.setTo(toEmail);
            message.setSubject("Migration Complete: " + projectName);
            message.setText(
                "Hi " + recipientName + ",\n\n" +
                "Your GrowthZone migration project \"" + projectName + "\" has been successfully " +
                "completed and cut over to production.\n\n" +
                "You can view the final project record at:\n" +
                appBaseUrl + "/migration\n\n" +
                "Thank you for using the GrowthZone Migration Platform.\n\n" +
                "— The GrowthZone Team"
            );
            mailSender.send(message);
            log.info("Project completion notification sent to {} for project={}", toEmail, projectName);
        } catch (Exception e) {
            log.error("Failed to send project completion notification to {}: {}", toEmail, e.getMessage(), e);
        }
    }
}
