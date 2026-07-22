package com.mxsuite.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

@Component
public class RateLimitFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(RateLimitFilter.class);

    // Login: max 5 attempts per IP per minute
    private static final int LOGIN_MAX_ATTEMPTS = 5;
    private static final long LOGIN_WINDOW_MS = 60_000;

    // VULN-07: Sensitive auth endpoints (forgot-password, reset-password, invitation accept)
    private static final int SENSITIVE_MAX_ATTEMPTS = 5;
    private static final long SENSITIVE_WINDOW_MS = 60_000;

    // General API: max 100 requests per IP per minute
    private static final int API_MAX_REQUESTS = 100;
    private static final long API_WINDOW_MS = 60_000;

    private final Map<String, RateBucket> loginBuckets = new ConcurrentHashMap<>();
    private final Map<String, RateBucket> sensitiveBuckets = new ConcurrentHashMap<>();
    private final Map<String, RateBucket> apiBuckets = new ConcurrentHashMap<>();

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                     FilterChain filterChain) throws ServletException, IOException {
        String clientIp = getClientIp(request);
        String path = request.getRequestURI();
        String method = request.getMethod();

        // Login rate limiting
        if (path.startsWith("/api/auth/login") && "POST".equalsIgnoreCase(method)) {
            if (!checkRate(loginBuckets, clientIp, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS)) {
                log.warn("Login rate limit exceeded for IP: {}", clientIp);
                sendRateLimitResponse(response, "Too many login attempts. Please try again later.");
                return;
            }
        }
        // VULN-07: Rate limit sensitive auth endpoints
        else if ("POST".equalsIgnoreCase(method) && (
                path.startsWith("/api/auth/forgot-password") ||
                path.startsWith("/api/auth/reset-password") ||
                path.matches(".*/api/invitations/.*/accept"))) {
            if (!checkRate(sensitiveBuckets, clientIp, SENSITIVE_MAX_ATTEMPTS, SENSITIVE_WINDOW_MS)) {
                log.warn("Sensitive endpoint rate limit exceeded for IP={} path={}", clientIp, path);
                sendRateLimitResponse(response, "Too many requests. Please try again later.");
                return;
            }
        }
        // General API rate limiting
        else if (path.startsWith("/api/")) {
            if (!checkRate(apiBuckets, clientIp, API_MAX_REQUESTS, API_WINDOW_MS)) {
                log.warn("API rate limit exceeded for IP: {}", clientIp);
                sendRateLimitResponse(response, "Rate limit exceeded. Please slow down.");
                return;
            }
        }

        filterChain.doFilter(request, response);
    }

    private void sendRateLimitResponse(HttpServletResponse response, String message) throws IOException {
        response.setStatus(429);
        response.setContentType("application/json");
        response.getWriter().write("{\"status\":429,\"message\":\"" + message + "\"}");
    }

    private boolean checkRate(Map<String, RateBucket> buckets, String key, int maxRequests, long windowMs) {
        long now = System.currentTimeMillis();
        buckets.entrySet().removeIf(e -> now - e.getValue().windowStart > windowMs * 2);

        RateBucket bucket = buckets.compute(key, (k, existing) -> {
            if (existing == null || now - existing.windowStart > windowMs) {
                return new RateBucket(now);
            }
            return existing;
        });

        return bucket.count.incrementAndGet() <= maxRequests;
    }

    private String getClientIp(HttpServletRequest request) {
        String xff = request.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) {
            return xff.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }

    private static class RateBucket {
        final long windowStart;
        final AtomicInteger count;

        RateBucket(long windowStart) {
            this.windowStart = windowStart;
            this.count = new AtomicInteger(0);
        }
    }
}
