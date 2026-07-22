package com.mxsuite.controller;

import com.mxsuite.audit.AuditService;
import com.mxsuite.model.User;
import com.mxsuite.repository.UserRepository;
import com.mxsuite.security.UserPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/profile")
@Transactional(readOnly = true)
public class ProfileController {

    private static final Logger log = LoggerFactory.getLogger(ProfileController.class);
    private static final long MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2 MB

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final AuditService auditService;
    private final String basePath;

    public ProfileController(UserRepository userRepository,
                             PasswordEncoder passwordEncoder,
                             AuditService auditService,
                             @Value("${mxsuite.storage.local.base-path}") String basePath) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.auditService = auditService;
        this.basePath = basePath;
    }

    public record ProfileResponse(String id, String email, String firstName, String lastName,
                                  String role, String tenantId, String tenantName,
                                  String avatarUrl, String title, String bio,
                                  String createdAt, String lastLoginAt,
                                  Map<String, Object> preferences) {}

    public record UpdateProfileRequest(
            @Size(min = 1, max = 100) String firstName,
            @Size(min = 1, max = 100) String lastName,
            @Size(max = 100) String title,
            @Size(max = 500) String bio) {}

    public record ChangePasswordRequest(
            @NotBlank @Size(min = 8, max = 128) String currentPassword,
            @NotBlank @Size(min = 8, max = 128) String newPassword) {}

    @GetMapping
    public ResponseEntity<ProfileResponse> getProfile(@AuthenticationPrincipal UserPrincipal principal) {
        User user = userRepository.findByIdWithTenant(principal.id()).orElse(null);
        if (user == null) return ResponseEntity.notFound().build();

        return ResponseEntity.ok(toProfileResponse(user));
    }

    @PutMapping
    @Transactional
    public ResponseEntity<ProfileResponse> updateProfile(@AuthenticationPrincipal UserPrincipal principal,
                                                          @Valid @RequestBody UpdateProfileRequest request) {
        User user = userRepository.findByIdWithTenant(principal.id()).orElse(null);
        if (user == null) return ResponseEntity.notFound().build();

        if (request.firstName() != null) user.setFirstName(request.firstName().trim());
        if (request.lastName() != null) user.setLastName(request.lastName().trim());
        if (request.title() != null) user.setTitle(request.title().trim());
        if (request.bio() != null) user.setBio(request.bio().trim());

        userRepository.save(user);
        auditService.log("UPDATE_PROFILE", "User", user.getId(), user.getFullName());
        log.info("Profile updated for user={}", user.getEmail());

        return ResponseEntity.ok(toProfileResponse(user));
    }

    @PutMapping("/password")
    @Transactional
    public ResponseEntity<?> changePassword(@AuthenticationPrincipal UserPrincipal principal,
                                             @Valid @RequestBody ChangePasswordRequest request) {
        User user = userRepository.findById(principal.id()).orElse(null);
        if (user == null) return ResponseEntity.notFound().build();

        if (!passwordEncoder.matches(request.currentPassword(), user.getPasswordHash())) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of(
                    "status", 400,
                    "message", "Current password is incorrect"
            ));
        }

        user.setPasswordHash(passwordEncoder.encode(request.newPassword()));
        userRepository.save(user);
        auditService.log("CHANGE_PASSWORD", "User", user.getId(), user.getFullName());
        log.info("Password changed for user={}", user.getEmail());

        return ResponseEntity.ok(Map.of("message", "Password changed successfully"));
    }

    @PostMapping("/avatar")
    @Transactional
    public ResponseEntity<?> uploadAvatar(@AuthenticationPrincipal UserPrincipal principal,
                                           @RequestParam("file") MultipartFile file) {
        if (file.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("status", 400, "message", "File is empty"));
        }
        if (file.getSize() > MAX_AVATAR_SIZE) {
            return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).body(Map.of(
                    "status", 413, "message", "Avatar must be under 2MB"));
        }

        String contentType = file.getContentType();
        if (contentType == null || !contentType.startsWith("image/")) {
            return ResponseEntity.status(HttpStatus.UNSUPPORTED_MEDIA_TYPE).body(Map.of(
                    "status", 415, "message", "Only image files are allowed"));
        }

        User user = userRepository.findById(principal.id()).orElse(null);
        if (user == null) return ResponseEntity.notFound().build();

        try {
            String ext = contentType.contains("png") ? ".png" :
                         contentType.contains("svg") ? ".svg" :
                         contentType.contains("webp") ? ".webp" : ".jpg";
            String filename = "avatar_" + UUID.randomUUID() + ext;
            Path avatarDir = Paths.get(basePath, "avatars");
            Files.createDirectories(avatarDir);
            Path avatarPath = avatarDir.resolve(filename);
            Files.copy(file.getInputStream(), avatarPath);

            // Delete old avatar if it exists on disk
            if (user.getAvatarUrl() != null && user.getAvatarUrl().startsWith("/uploads/avatars/")) {
                String oldFilename = user.getAvatarUrl().replace("/uploads/avatars/", "");
                Path oldPath = avatarDir.resolve(oldFilename);
                Files.deleteIfExists(oldPath);
            }

            String avatarUrl = "/uploads/avatars/" + filename;
            user.setAvatarUrl(avatarUrl);
            userRepository.save(user);

            log.info("Avatar uploaded for user={}", user.getEmail());
            return ResponseEntity.ok(Map.of("avatarUrl", avatarUrl));
        } catch (IOException e) {
            log.error("Avatar upload failed for user {}: {}", principal.email(), e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of(
                    "status", 500, "message", "Failed to save avatar"));
        }
    }

    @GetMapping("/preferences")
    public ResponseEntity<?> getPreferences(@AuthenticationPrincipal UserPrincipal principal) {
        User user = userRepository.findById(principal.id()).orElse(null);
        if (user == null) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(user.getPreferences() != null ? user.getPreferences() : Map.of());
    }

    @PutMapping("/preferences")
    @Transactional
    public ResponseEntity<?> updatePreferences(@AuthenticationPrincipal UserPrincipal principal,
                                                @RequestBody Map<String, Object> preferences) {
        User user = userRepository.findById(principal.id()).orElse(null);
        if (user == null) return ResponseEntity.notFound().build();

        user.setPreferences(preferences);
        userRepository.save(user);
        log.info("Preferences updated for user={}", user.getEmail());

        return ResponseEntity.ok(preferences);
    }

    private ProfileResponse toProfileResponse(User user) {
        return new ProfileResponse(
                user.getId().toString(),
                user.getEmail(),
                user.getFirstName(),
                user.getLastName(),
                user.getRole().name(),
                user.getTenant().getId().toString(),
                user.getTenant().getName(),
                user.getAvatarUrl(),
                user.getTitle(),
                user.getBio(),
                user.getCreatedAt() != null ? user.getCreatedAt().toString() : null,
                user.getLastLoginAt() != null ? user.getLastLoginAt().toString() : null,
                user.getPreferences()
        );
    }
}
