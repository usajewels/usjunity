package com.mxsuite.security;

import com.mxsuite.model.User;
import com.mxsuite.repository.UserRepository;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.UUID;

@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(JwtAuthenticationFilter.class);

    private final JwtTokenProvider tokenProvider;
    private final UserRepository userRepository;
    private final ActiveSessionRegistry sessionRegistry;

    public JwtAuthenticationFilter(JwtTokenProvider tokenProvider, UserRepository userRepository,
                                    ActiveSessionRegistry sessionRegistry) {
        this.tokenProvider = tokenProvider;
        this.userRepository = userRepository;
        this.sessionRegistry = sessionRegistry;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                     FilterChain filterChain) throws ServletException, IOException {
        try {
            String token = extractToken(request);

            if (StringUtils.hasText(token) && tokenProvider.validateToken(token)) {
                UUID userId = tokenProvider.getUserIdFromToken(token);
                UUID tenantId = tokenProvider.getTenantIdFromToken(token);

                User user = userRepository.findByIdWithTenant(userId).orElse(null);
                if (user != null && user.isActive()) {
                    UserPrincipal principal = new UserPrincipal(
                        user.getId(), user.getEmail(), user.getFirstName(), user.getLastName(),
                        user.getPasswordHash(), user.getRole(), user.getTenant().getId(), user.isActive()
                    );

                    UsernamePasswordAuthenticationToken authentication =
                        new UsernamePasswordAuthenticationToken(principal, null, principal.getAuthorities());
                    authentication.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
                    SecurityContextHolder.getContext().setAuthentication(authentication);

                    // Set tenant context from token
                    TenantContext.setCurrentTenantId(tenantId);

                    // Record active session
                    sessionRegistry.recordActivity(
                            user.getId(), user.getEmail(), user.getFullName(),
                            user.getRole().name(), user.getTenant().getId(),
                            user.getTenant().getName(), request.getRemoteAddr());

                    // Platform users can switch tenant context via header
                    String tenantHeader = request.getHeader("X-Tenant-Id");
                    if (StringUtils.hasText(tenantHeader) && principal.isPlatformUser()) {
                        try {
                            UUID overrideTenantId = UUID.fromString(tenantHeader);
                            TenantContext.setCurrentTenantId(overrideTenantId);
                            log.debug("Platform user {} switched to tenant {}", principal.email(), overrideTenantId);
                        } catch (IllegalArgumentException e) {
                            log.warn("Invalid X-Tenant-Id header '{}' from user {}", tenantHeader, principal.email());
                            response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
                            response.setContentType("application/json");
                            response.getWriter().write("{\"status\":400,\"message\":\"Invalid X-Tenant-Id header format\"}");
                            return;
                        }
                    } else if (StringUtils.hasText(tenantHeader) && !principal.isPlatformUser()) {
                        // Only warn if they're trying to switch to a different tenant
                        try {
                            UUID headerTenantId = UUID.fromString(tenantHeader);
                            if (!headerTenantId.equals(tenantId)) {
                                log.warn("Non-platform user {} attempted to switch to tenant {}", principal.email(), tenantHeader);
                            }
                        } catch (IllegalArgumentException ignored) {}
                    }
                } else if (user != null && !user.isActive()) {
                    log.warn("Inactive user attempted access: userId={}", userId);
                } else {
                    log.warn("Token references non-existent user: userId={}", userId);
                }
            }
        } catch (Exception e) {
            log.error("Failed to process authentication: {}", e.getMessage());
        }

        try {
            filterChain.doFilter(request, response);
        } finally {
            TenantContext.clear();
        }
    }

    private String extractToken(HttpServletRequest request) {
        String header = request.getHeader("Authorization");
        if (StringUtils.hasText(header) && header.startsWith("Bearer ")) {
            return header.substring(7);
        }
        return null;
    }
}
