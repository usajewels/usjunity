package com.mxsuite.controller;

import com.mxsuite.model.Notification;
import com.mxsuite.repository.NotificationRepository;
import com.mxsuite.security.UserPrincipal;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/notifications")
@Transactional(readOnly = true)
public class NotificationController {

    private final NotificationRepository notificationRepository;

    public NotificationController(NotificationRepository notificationRepository) {
        this.notificationRepository = notificationRepository;
    }

    /** Paginated list of notifications for the current user, newest first. */
    @GetMapping
    public Page<Notification> list(@AuthenticationPrincipal UserPrincipal principal,
                                    @PageableDefault(size = 20) Pageable pageable) {
        return notificationRepository.findByRecipientIdOrderByCreatedAtDesc(principal.id(), pageable);
    }

    /** Count of unread notifications — used for the bell badge. */
    @GetMapping("/unread-count")
    public Map<String, Long> unreadCount(@AuthenticationPrincipal UserPrincipal principal) {
        return Map.of("count", notificationRepository.countByRecipientIdAndReadFalse(principal.id()));
    }

    /** Mark a single notification as read. */
    @PutMapping("/{id}/read")
    @Transactional
    public ResponseEntity<?> markRead(@AuthenticationPrincipal UserPrincipal principal,
                                       @PathVariable UUID id) {
        return notificationRepository.findById(id)
                .filter(n -> n.getRecipientId().equals(principal.id()))
                .map(n -> {
                    n.setRead(true);
                    notificationRepository.save(n);
                    return ResponseEntity.ok(n);
                })
                .orElse(ResponseEntity.notFound().build());
    }

    /** Mark all unread notifications as read. */
    @PutMapping("/read-all")
    @Transactional
    public Map<String, Integer> markAllRead(@AuthenticationPrincipal UserPrincipal principal) {
        int updated = notificationRepository.markAllRead(principal.id());
        return Map.of("updated", updated);
    }
}
