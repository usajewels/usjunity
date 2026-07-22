package com.mxsuite.config;

import com.mxsuite.model.User;
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

@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private static final Logger log = LoggerFactory.getLogger(WebSocketConfig.class);

    private final JwtTokenProvider tokenProvider;
    private final UserRepository userRepository;

    // VULN-08: Use same CORS origins for WebSocket
    @Value("${mxsuite.cors.allowed-origins:http://localhost:3000}")
    private String allowedOrigins;

    public WebSocketConfig(JwtTokenProvider tokenProvider, UserRepository userRepository) {
        this.tokenProvider = tokenProvider;
        this.userRepository = userRepository;
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

    // VULN-04: WebSocket JWT Authentication via STOMP CONNECT headers
    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(new ChannelInterceptor() {
            @Override
            public Message<?> preSend(Message<?> message, MessageChannel channel) {
                StompHeaderAccessor accessor =
                        MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
                if (accessor != null && StompCommand.CONNECT.equals(accessor.getCommand())) {
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
                return message;
            }
        });
    }
}
