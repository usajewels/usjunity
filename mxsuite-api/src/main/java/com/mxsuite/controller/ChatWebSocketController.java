package com.mxsuite.controller;

import com.mxsuite.security.UserPrincipal;
import com.mxsuite.service.ChatService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.stereotype.Controller;

import java.security.Principal;
import java.util.Map;
import java.util.UUID;

@Controller
public class ChatWebSocketController {

    private static final Logger log = LoggerFactory.getLogger(ChatWebSocketController.class);
    private static final int MAX_CONTENT_LENGTH = 10_000;

    private final ChatService chatService;
    private final SimpMessagingTemplate messagingTemplate;

    public ChatWebSocketController(ChatService chatService, SimpMessagingTemplate messagingTemplate) {
        this.chatService = chatService;
        this.messagingTemplate = messagingTemplate;
    }

    /** Member sends a chat message. */
    @MessageMapping("/chat.send")
    public void memberSend(Principal principal, @Payload Map<String, String> payload) {
        try {
            UserPrincipal user = extractPrincipal(principal);
            String convId = payload.get("conversationId");
            String content = payload.get("content");
            if (convId == null || content == null || content.isBlank()) return;
            if (content.length() > MAX_CONTENT_LENGTH) return;
            chatService.sendMemberMessage(UUID.fromString(convId), user, content);
        } catch (IllegalArgumentException e) {
            log.warn("Invalid WebSocket chat.send payload: {}", e.getMessage());
        }
    }

    /** Coach sends a chat message (during takeover). */
    @MessageMapping("/chat.coach.send")
    public void coachSend(Principal principal, @Payload Map<String, String> payload) {
        try {
            UserPrincipal user = extractPrincipal(principal);
            // Role check: only platform users can use coach send
            if (!user.isPlatformUser()) {
                log.warn("Non-platform user {} attempted coach.send", user.id());
                return;
            }
            String convId = payload.get("conversationId");
            String content = payload.get("content");
            if (convId == null || content == null || content.isBlank()) return;
            if (content.length() > MAX_CONTENT_LENGTH) return;
            chatService.sendCoachMessage(UUID.fromString(convId), user, content);
        } catch (IllegalArgumentException e) {
            log.warn("Invalid WebSocket chat.coach.send payload: {}", e.getMessage());
        }
    }

    /** Typing indicator broadcast. */
    @MessageMapping("/chat.typing")
    public void typing(Principal principal, @Payload Map<String, String> payload) {
        try {
            UserPrincipal user = extractPrincipal(principal);
            String convId = payload.get("conversationId");
            if (convId == null) return;
            UUID conversationId = UUID.fromString(convId);
            // Authorization: verify the user has access to this conversation
            // (the subscription interceptor already controls who can listen,
            //  but we also prevent unauthorized users from broadcasting typing)
            chatService.assertUserCanAccess(conversationId, user);
            messagingTemplate.convertAndSend("/topic/chat." + conversationId + ".typing", Map.of(
                    "userId", user.id().toString(),
                    "name", user.getFullName(),
                    "isPlatformUser", user.isPlatformUser()
            ));
        } catch (Exception e) {
            log.warn("Invalid WebSocket chat.typing payload: {}", e.getMessage());
        }
    }

    private UserPrincipal extractPrincipal(Principal principal) {
        if (principal instanceof UsernamePasswordAuthenticationToken auth) {
            return (UserPrincipal) auth.getPrincipal();
        }
        throw new IllegalStateException("Invalid authentication");
    }
}
