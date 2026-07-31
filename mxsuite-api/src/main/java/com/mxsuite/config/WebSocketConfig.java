package com.mxsuite.config;

import com.mxsuite.model.User;
import com.mxsuite.repository.ConversationRepository;
import com.mxsuite.repository.UserRepository;
import com.mxsuite.security.JwtTokenProvider;
import com.mxsuite.security.TenantContext;
import com.mxsuite.security.UserPrincipal;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

import java.util.Arrays;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private static final Logger log = LoggerFactory.getLogger(WebSocketConfig.class);

    // Pattern: /topic/chat.{conversationId} or /topic/chat.{conversationId}.typing
    private static final Pattern CHAT_TOPIC_PATTERN =
            Pattern.compile("^/topic/chat\\.([0-9a-f-]{36})(\\.typing)?$");

    // Pattern: /topic/chat.dashboard.{tenantId}
    private static final Pattern DASHBOARD_TOPIC_PATTERN =
            Pattern.compile("^/topic/chat\\.dashboard\\.([0-9a-f-]{36})$");

    // Pattern: /topic/presence.{tenantId}
    private static final Pattern PRESENCE_TOPIC_PATTERN =
            Pattern.compile("^/topic/presence\\.([0-9a-f-]{36})$");

    private final JwtTokenProvider tokenProvider;
    private final UserRepository userRepository;
    private final ConversationRepository conversationRepository;

    // VULN-08: Use same CORS origins for WebSocket
    @Value("${mxsuite.cors.allowed-origins:http://localhost:3000}")
    private String allowedOrigins;

    public WebSocketConfig(JwtTokenProvider tokenProvider, UserRepository userRepository,
                           ConversationRepository conversationRepository) {
        this.tokenProvider = tokenProvider;
        this.userRepository = userRepository;
        this.conversationRepository = conversationRepository;
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry config) {
        config.enableSimpleBroker("/topic", "/queue");
        config.setApplicationDestinationPrefixes("/app");
        config.setUserDestinationPrefix("/user");
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        String[] origins = Arrays.stream(allowedOrigins.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .toArray(String[]::new);
        registry.addEndpoint("/ws")
                .setAllowedOrigins(origins)
                .withSockJS();
    }

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(new ChannelInterceptor() {
            @Override
            public Message<?> preSend(Message<?> message, MessageChannel channel) {
                StompHeaderAccessor accessor =
                        MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
                if (accessor == null) return message;

                // --- CONNECT: JWT authentication ---
                if (StompCommand.CONNECT.equals(accessor.getCommand())) {
                    handleConnect(accessor);
                }

                // --- SUBSCRIBE: authorize chat topic subscriptions ---
                if (StompCommand.SUBSCRIBE.equals(accessor.getCommand())) {
                    handleSubscribe(accessor);
                }

                return message;
            }
        });
    }

    private void handleConnect(StompHeaderAccessor accessor) {
        String authHeader = accessor.getFirstNativeHeader("Authorization");
        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            log.warn("WebSocket CONNECT rejected: missing or invalid Authorization header");
            throw new IllegalArgumentException("Missing or invalid Authorization header");
        }

        String token = authHeader.substring(7);
        if (!tokenProvider.validateToken(token)) {
            log.warn("WebSocket CONNECT rejected: invalid JWT token");
            throw new IllegalArgumentException("Invalid or expired JWT token");
        }

        UUID userId = tokenProvider.getUserIdFromToken(token);
        UUID tenantId = tokenProvider.getTenantIdFromToken(token);
        User user = userRepository.findById(userId).orElse(null);

        if (user == null || !user.isActive()) {
            log.warn("WebSocket CONNECT rejected: user not found or inactive, userId={}", userId);
            throw new IllegalArgumentException("User not found or inactive");
        }

        UserPrincipal principal = new UserPrincipal(
                user.getId(), user.getEmail(), user.getFirstName(), user.getLastName(),
                user.getPasswordHash(), user.getRole(), user.getTenant().getId(), user.isActive()
        );

        UsernamePasswordAuthenticationToken authentication =
                new UsernamePasswordAuthenticationToken(principal, null, principal.getAuthorities());
        accessor.setUser(authentication);

        TenantContext.setCurrentTenantId(tenantId);
        log.debug("WebSocket CONNECT authenticated: user={} tenant={}", principal.email(), tenantId);
    }

    private void handleSubscribe(StompHeaderAccessor accessor) {
        String destination = accessor.getDestination();
        if (destination == null) return;

        // /user/queue/* subscriptions are user-scoped by Spring — safe
        if (destination.startsWith("/user/")) return;

        UserPrincipal principal = extractPrincipal(accessor);
        if (principal == null) {
            throw new IllegalArgumentException("Not authenticated");
        }

        // Presence topic: /topic/presence.{tenantId} — only platform users
        Matcher presenceMatcher = PRESENCE_TOPIC_PATTERN.matcher(destination);
        if (presenceMatcher.matches()) {
            if (!principal.isPlatformUser()) {
                log.warn("WebSocket SUBSCRIBE rejected: non-platform user {} tried to subscribe to {}",
                        principal.id(), destination);
                throw new IllegalArgumentException("Access denied");
            }
            return;
        }

        // Non-chat topics — allow (no chat data)
        if (!destination.startsWith("/topic/chat.")) return;

        // Dashboard topic: /topic/chat.dashboard.{tenantId}
        Matcher dashboardMatcher = DASHBOARD_TOPIC_PATTERN.matcher(destination);
        if (dashboardMatcher.matches()) {
            // Only platform users can subscribe to dashboard topics
            if (!principal.isPlatformUser()) {
                log.warn("WebSocket SUBSCRIBE rejected: non-platform user {} tried to subscribe to {}",
                        principal.id(), destination);
                throw new IllegalArgumentException("Access denied");
            }
            return;
        }

        // Conversation topic: /topic/chat.{conversationId} or /topic/chat.{conversationId}.typing
        Matcher chatMatcher = CHAT_TOPIC_PATTERN.matcher(destination);
        if (chatMatcher.matches()) {
            UUID conversationId = UUID.fromString(chatMatcher.group(1));
            var conv = conversationRepository.findById(conversationId).orElse(null);
            if (conv == null) {
                throw new IllegalArgumentException("Conversation not found");
            }

            // Platform users (coaches) can subscribe to any visible conversation
            if (principal.isPlatformUser()) return;

            // Members can only subscribe to their own conversations
            if (!conv.getMemberId().equals(principal.id())) {
                log.warn("WebSocket SUBSCRIBE rejected: user {} tried to subscribe to conversation {}",
                        principal.id(), conversationId);
                throw new IllegalArgumentException("Access denied");
            }
            return;
        }

        // Unknown chat topic pattern — deny
        log.warn("WebSocket SUBSCRIBE rejected: unknown chat topic pattern: {}", destination);
        throw new IllegalArgumentException("Access denied");
    }

    private UserPrincipal extractPrincipal(StompHeaderAccessor accessor) {
        if (accessor.getUser() instanceof UsernamePasswordAuthenticationToken auth
                && auth.getPrincipal() instanceof UserPrincipal principal) {
            return principal;
        }
        return null;
    }
}
