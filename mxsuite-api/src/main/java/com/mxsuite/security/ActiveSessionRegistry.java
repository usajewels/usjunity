package com.mxsuite.security;

import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * In-memory registry of active user sessions.
 * Updated on each authenticated request via JwtAuthenticationFilter.
 * Sessions expire after IDLE_TIMEOUT_MINUTES of inactivity.
 */
@Component
public class ActiveSessionRegistry {

    private static final long IDLE_TIMEOUT_MINUTES = 15;

    private final ConcurrentHashMap<UUID, SessionInfo> sessions = new ConcurrentHashMap<>();

    public record SessionInfo(
            UUID userId,
            String email,
            String fullName,
            String role,
            UUID tenantId,
            String tenantName,
            Instant firstSeen,
            Instant lastActive,
            String ipAddress) {}

    public void recordActivity(UUID userId, String email, String fullName,
                                String role, UUID tenantId, String tenantName,
                                String ipAddress) {
        sessions.compute(userId, (id, existing) -> new SessionInfo(
                userId, email, fullName, role, tenantId, tenantName,
                existing != null ? existing.firstSeen() : Instant.now(),
                Instant.now(),
                ipAddress));
    }

    public List<SessionInfo> getActiveSessions() {
        evictStale();
        return sessions.values().stream()
                .sorted(Comparator.comparing(SessionInfo::lastActive).reversed())
                .toList();
    }

    public int getActiveCount() {
        evictStale();
        return sessions.size();
    }

    public void removeSession(UUID userId) {
        sessions.remove(userId);
    }

    private void evictStale() {
        Instant cutoff = Instant.now().minusSeconds(IDLE_TIMEOUT_MINUTES * 60);
        sessions.entrySet().removeIf(e -> e.getValue().lastActive().isBefore(cutoff));
    }
}
