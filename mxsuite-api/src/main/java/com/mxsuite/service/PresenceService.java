package com.mxsuite.service;

import com.mxsuite.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Collection;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

@Service
public class PresenceService {

    private static final Logger log = LoggerFactory.getLogger(PresenceService.class);

    public record PresenceInfo(UUID userId, UUID tenantId, Instant connectedAt) {}

    private final ConcurrentHashMap<UUID, PresenceInfo> onlineUsers = new ConcurrentHashMap<>();
    private final SimpMessagingTemplate messagingTemplate;
    private final UserRepository userRepository;

    public PresenceService(SimpMessagingTemplate messagingTemplate, UserRepository userRepository) {
        this.messagingTemplate = messagingTemplate;
        this.userRepository = userRepository;
    }

    public void connect(UUID userId, UUID tenantId) {
        onlineUsers.put(userId, new PresenceInfo(userId, tenantId, Instant.now()));
        log.debug("User connected: {} (tenant {})", userId, tenantId);
        broadcastPresenceChange(userId, tenantId, "ONLINE");
    }

    public void disconnect(UUID userId) {
        PresenceInfo info = onlineUsers.remove(userId);
        if (info != null) {
            log.debug("User disconnected: {} (tenant {})", userId, info.tenantId());
            // Update lastSeenAt in DB
            userRepository.findById(userId).ifPresent(user -> {
                user.setLastSeenAt(Instant.now());
                userRepository.save(user);
            });
            broadcastPresenceChange(userId, info.tenantId(), "OFFLINE");
        }
    }

    public boolean isOnline(UUID userId) {
        return onlineUsers.containsKey(userId);
    }

    public Map<UUID, Boolean> getOnlineStatus(Collection<UUID> userIds) {
        return userIds.stream().collect(Collectors.toMap(
                id -> id,
                this::isOnline
        ));
    }

    public Set<UUID> getOnlineUserIds() {
        return onlineUsers.keySet();
    }

    private void broadcastPresenceChange(UUID userId, UUID tenantId, String status) {
        Map<String, Object> payload = Map.of(
                "userId", userId.toString(),
                "status", status,
                "timestamp", Instant.now().toString()
        );
        // Broadcast to per-tenant presence topic (coaches subscribe to this)
        messagingTemplate.convertAndSend("/topic/presence." + tenantId, payload);
        // Also broadcast to the user's personal queue (for member-side coach presence)
        messagingTemplate.convertAndSendToUser(
                userId.toString(), "/queue/presence", payload);
    }
}
