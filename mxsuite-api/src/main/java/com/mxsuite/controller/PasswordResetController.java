package com.mxsuite.controller;

import com.mxsuite.audit.AuditService;
import com.mxsuite.model.PasswordResetToken;
import com.mxsuite.repository.PasswordResetTokenRepository;
import com.mxsuite.repository.UserRepository;
import com.mxsuite.service.EmailService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.security.SecureRandom;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class PasswordResetController {

    private static final Logger log = LoggerFactory.getLogger(PasswordResetController.class);

    private final UserRepository userRepository;
    private final PasswordResetTokenRepository tokenRepository;
    private final PasswordEncoder passwordEncoder;
    private final EmailService emailService;
    private final AuditService auditService;

    public PasswordResetController(UserRepository userRepository,
                                    PasswordResetTokenRepository tokenRepository,
                                    PasswordEncoder passwordEncoder,
                                    EmailService emailService,
                                    AuditService auditService) {
        this.userRepository = userRepository;
        this.tokenRepository = tokenRepository;
        this.passwordEncoder = passwordEncoder;
        this.emailService = emailService;
        this.auditService = auditService;
    }

    public record ForgotPasswordRequest(
            @NotBlank @Email @Size(max = 255) String email) {}

    public record ResetPasswordRequest(
            @NotBlank String token,
            @NotBlank @Size(min = 8, max = 128)
            @Pattern(regexp = "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[!@#$%^&*(),.?\":{}|<>]).{8,}$",
                     message = "Password must include uppercase, lowercase, number, and special character")
            String newPassword) {}

    @PostMapping("/forgot-password")
    @Transactional
    public ResponseEntity<?> forgotPassword(@Valid @RequestBody ForgotPasswordRequest request,
                                              HttpServletRequest httpRequest) {
        // Always return success to prevent email enumeration
        String email = request.email().toLowerCase().trim();
        String clientIp = getClientIp(httpRequest);

        var user = userRepository.findByEmail(email).orElse(null);
        if (user != null && user.isActive()) {
            // VULN-14: Invalidate any existing unused tokens before creating a new one
            tokenRepository.invalidateAllByUserId(user.getId());

            PasswordResetToken resetToken = new PasswordResetToken();
            resetToken.setToken(generateSecureToken());
            resetToken.setUser(user);
            resetToken.setExpiresAt(Instant.now().plus(1, ChronoUnit.HOURS));
            tokenRepository.save(resetToken);

            emailService.sendPasswordReset(user.getEmail(), user.getFirstName(), resetToken.getToken());
            log.info("Password reset requested for email={} from IP={}", email, clientIp);
        } else {
            log.info("Password reset requested for unknown/inactive email={} from IP={}", email, clientIp);
        }

        return ResponseEntity.ok(Map.of(
                "message", "If an account with that email exists, a password reset link has been sent."));
    }

    @PostMapping("/reset-password")
    @Transactional
    public ResponseEntity<?> resetPassword(@Valid @RequestBody ResetPasswordRequest request) {
        // VULN-06: Use pessimistic lock to prevent race condition on token consumption
        var resetToken = tokenRepository.findByTokenAndUsedFalseForUpdate(request.token()).orElse(null);
        if (resetToken == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of(
                    "status", 404, "message", "Invalid or expired reset token"));
        }

        if (resetToken.isExpired()) {
            return ResponseEntity.status(HttpStatus.GONE).body(Map.of(
                    "status", 410, "message", "This reset link has expired. Please request a new one."));
        }

        var user = resetToken.getUser();
        user.setPasswordHash(passwordEncoder.encode(request.newPassword()));
        userRepository.save(user);

        resetToken.setUsed(true);
        tokenRepository.save(resetToken);

        auditService.logWithoutPrincipal("PASSWORD_RESET", "User",
                "email=" + user.getEmail(), null);
        log.info("Password reset completed for user: {}", user.getEmail());

        return ResponseEntity.ok(Map.of(
                "message", "Password has been reset. You can now log in with your new password."));
    }

    /** VULN-09: Generate cryptographically secure token using SecureRandom */
    private String generateSecureToken() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private String getClientIp(HttpServletRequest request) {
        String xff = request.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) {
            return xff.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }
}
