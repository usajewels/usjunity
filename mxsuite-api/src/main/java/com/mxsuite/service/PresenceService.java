package com.mxsuite.service;

import com.mxsuite.model.enums.AvailabilityStatus;
import com.mxsuite.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Collection;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * Tracks real-time presence (ONLINE/OFFLINE) and availability status
 * (ONLINE, BUSY, DO_NOT_DISTURB, BE_RIGHT_BACK, AWAY, APPEAR_OFFLINE)
 * for all connected users.
 *
 * <p>Multi-tab safe: session-level connect/disconnect tracking ensures a user
 * is only marked OFFLINE when their last WebSocket session disconnects.</p>
 *
 * <p>All state is in-memory only — no database columns required.</p>
 */
@Service
public class PresenceService {

    private static final Logger log = LoggerFactory.getLogger(PresenceService.class);

    /** Full presence snapshot per user. */
    public record PresenceInfo(UUID userId, UUID tenantId, Instant connectedAt) {}

    /** Availability status + optional custom message set by the user. */
    public record AvailabilityInfo(AvailabilityStatus status, String statusMessage) {}

    /** Combined detail returned to the frontend. */
    public record PresenceDetail(boolean online, AvailabilityStatus availabilityStatus,
                                  String statusMessage) {}

    // sessionId → userId  (multi-tab: many sessions per user)
    private final ConcurrentHashMap<String, UUID> sessionUsers = new ConcurrentHashMap<>();
    // userId → PresenceInfo  (one entry while at least one session is alive)
    private final ConcurrentHashMap<UUID, PresenceInfo> onlineUsers = new ConcurrentHashMap<>();
    // userId → AvailabilityInfo  (persists across reconnects within a session)
    private final ConcurrentHashMap<UUID, AvailabilityInfo> availabilityMap = new ConcurrentHashMap<>();

    private final SimpMessagingTemplate messagingTemplate;
    private final UserRepository userRepository;

    public PresenceService(SimpMessagingTemplate messagingTemplate, UserRepository userRepository) {
        this.messagingTemplate = messagingTemplate;
        this.userRepository = userRepository;
    }

    // ── Connect / Disconnect ──────────────────────────────────────────────────

    /**
     * Called when a WebSocket session is established.
     * Only broadcasts ONLINE on the first session for this user (multi-tab fix).
     */
    public void connect(String sessionId, UUID userId, UUID tenantId) {
        sessionUsers.put(sessionId, userId);
        boolean firstSession = onlineUsers.putIfAbsent(userId,
                new PresenceInfo(userId, tenantId, Instant.now())) == null;
        log.debug("User connected: session={} user={} tenant={} firstSession={}",
                sessionId, userId, tenantId, firstSession);
        if (firstSession) {
            broadcastPresenceChange(userId, tenantId, "ONLINE");
        }
    }

    /**
     * Called when a WebSocket session disconnects.
     * Only broadcasts OFFLINE when the last session for this user closes (multi-tab fix).
     */
    public void disconnect(String sessionId) {
        UUID userId = sessionUsers.remove(sessionId);
        if (userId == null) return; // already cleaned up or unknown session

        boolean hasOtherSessions = sessionUsers.containsValue(userId);
        if (!hasOtherSessions) {
            PresenceInfo info = onlineUsers.remove(userId);
            if (info != null) {
                log.debug("User fully offline: user={} tenant={}", userId, info.tenantId());
                userRepository.findById(userId).ifPresent(u -> {
                    u.setLastSeenAt(Instant.now());
                    userRepository.save(u);
                });
                broadcastPresenceChange(userId, info.tenantId(), "OFFLINE");
            }
        } else {
            log.debug("User still has other sessions, staying ONLINE: user={}", userId);
        }
    }

    // ── Availability ─────────────────────────────────────────────────────────

    /**
     * Sets a user's availability status and optional status message ("Back at 12pm" etc.).
     * Broadcasts the change so all subscribed coaches/members see it immediately.
     */
    public void setAvailability(UUID userId, UUID tenantId,
                                 AvailabilityStatus status, String statusMessage) {
        availabilityMap.put(userId, new AvailabilityInfo(status, statusMessage));
        log.debug("User {} set availability to {} (message={})", userId, status, statusMessage);
        broadcastPresenceChange(userId, tenantId, isOnline(userId) ? "ONLINE" : "OFFLINE");
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    public boolean isOnline(UUID userId) {
        return onlineUsers.containsKey(userId);
    }

    /** Batch binary online check — backwards-compatible with existing /api/chat/presence.
     *  Respects APPEAR_OFFLINE: returns false so the user looks offline to others. */
    public Map<UUID, Boolean> getOnlineStatus(Collection<UUID> userIds) {
        return userIds.stream().collect(Collectors.toMap(id -> id, id -> {
            if (!isOnline(id)) return false;
            AvailabilityInfo avail = availabilityMap.get(id);
            return avail == null || avail.status() != AvailabilityStatus.APPEAR_OFFLINE;
        }));
    }

    /** Detailed presence including availability status — for the new frontend components.
     *  Respects APPEAR_OFFLINE: reports online=false so the user looks offline to others. */
    public Map<UUID, PresenceDetail> getPresenceDetail(Collection<UUID> userIds) {
        return userIds.stream().collect(Collectors.toMap(id -> id, id -> {
            boolean online = isOnline(id);
            AvailabilityInfo avail = availabilityMap.getOrDefault(id,
                    new AvailabilityInfo(AvailabilityStatus.ONLINE, null));
            // APPEAR_OFFLINE: user is connected but should look offline to others
            if (online && avail.status() == AvailabilityStatus.APPEAR_OFFLINE) {
                online = false;
            }
            return new PresenceDetail(online, avail.status(), avail.statusMessage());
        }));
    }

    /** Single-user detail — used by the GET /api/chat/presence/my-status endpoint. */
    public PresenceDetail getMyDetail(UUID userId) {
        boolean online = isOnline(userId);
        AvailabilityInfo avail = availabilityMap.getOrDefault(userId,
                new AvailabilityInfo(AvailabilityStatus.ONLINE, null));
        return new PresenceDetail(online, avail.status(), avail.statusMessage());
    }

    public Set<UUID> getOnlineUserIds() {
        return onlineUsers.keySet();
    }

    // ── Broadcast ─────────────────────────────────────────────────────────────

    private void broadcastPresenceChange(UUID userId, UUID tenantId, String onlineStatus) {
        AvailabilityInfo avail = availabilityMap.getOrDefault(userId,
                new AvailabilityInfo(AvailabilityStatus.ONLINE, null));

        // APPEAR_OFFLINE: broadcast as OFFLINE so others see the user as offline
        String effectiveStatus = (avail.status() == AvailabilityStatus.APPEAR_OFFLINE && "ONLINE".equals(onlineStatus))
                ? "OFFLINE" : onlineStatus;

        Map<String, Object> payload = new HashMap<>();
        payload.put("userId", userId.toString());
        payload.put("status", effectiveStatus);
        payload.put("availabilityStatus", avail.status().name());
        if (avail.statusMessage() != null) payload.put("statusMessage", avail.statusMessage());
        payload.put("timestamp", Instant.now().toString());

        // Broadcast to per-tenant presence topic (coaches subscribe to this)
        messagingTemplate.convertAndSend("/topic/presence." + tenantId, payload);
        // Also send to the user's personal queue (for member-side coach presence)
        messagingTemplate.convertAndSendToUser(userId.toString(), "/queue/presence", payload);
    }
}
