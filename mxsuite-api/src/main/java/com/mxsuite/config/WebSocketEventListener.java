package com.mxsuite.config;

import com.mxsuite.security.UserPrincipal;
import com.mxsuite.service.PresenceService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.messaging.SessionConnectEvent;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

@Component
public class WebSocketEventListener {

    private static final Logger log = LoggerFactory.getLogger(WebSocketEventListener.class);

    private final PresenceService presenceService;

    public WebSocketEventListener(PresenceService presenceService) {
        this.presenceService = presenceService;
    }

    @EventListener
    public void handleSessionConnect(SessionConnectEvent event) {
        UserPrincipal principal = extractPrincipal(event.getUser());
        if (principal != null) {
            presenceService.connect(principal.id(), principal.tenantId());
        }
    }

    @EventListener
    public void handleSessionDisconnect(SessionDisconnectEvent event) {
        UserPrincipal principal = extractPrincipal(event.getUser());
        if (principal != null) {
            presenceService.disconnect(principal.id());
        }
    }

    private UserPrincipal extractPrincipal(java.security.Principal user) {
        if (user instanceof UsernamePasswordAuthenticationToken auth
                && auth.getPrincipal() instanceof UserPrincipal principal) {
            return principal;
        }
        return null;
    }
}
