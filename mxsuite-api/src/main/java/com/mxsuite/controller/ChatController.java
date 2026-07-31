package com.mxsuite.controller;

import com.mxsuite.model.ChatMessage;
import com.mxsuite.model.Conversation;
import com.mxsuite.security.UserPrincipal;
import com.mxsuite.model.ChatFile;
import com.mxsuite.service.ChatFileService;
import com.mxsuite.service.ChatService;
import com.mxsuite.service.PresenceService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/chat")
public class ChatController {

    private final ChatService chatService;
    private final PresenceService presenceService;
    private final ChatFileService chatFileService;

    public ChatController(ChatService chatService, PresenceService presenceService,
                          ChatFileService chatFileService) {
        this.chatService = chatService;
        this.presenceService = presenceService;
        this.chatFileService = chatFileService;
    }

    /* ---- DTOs ---- */

    record CreateConversationRequest(@Size(max = 500) String subject) {}

    record SendMessageRequest(@NotBlank @Size(max = 10000) String content) {}

    record ConversationDto(
            UUID id, UUID tenantId, UUID memberId, String memberName,
            String memberAvatarUrl,
            UUID assignedCoachId, String assignedCoachName,
            UUID controllingCoachId, String controllingCoachName,
            String mode, String status, String subject,
            Double sentimentScore, String sentimentLabel,
            boolean helpRequested,
            Instant lastMessageAt, String lastMessagePreview,
            int unreadCoachCount, int unreadMemberCount,
            Instant createdAt) {}

    record ChatMessageDto(
            UUID id, UUID conversationId,
            String senderType, UUID senderId, String senderName,
            String senderAvatarUrl,
            String content, Double sentimentScore,
            Map<String, Object> metadata, Instant createdAt) {}

    /* ---- Member Endpoints ---- */

    @GetMapping("/conversations")
    public List<ConversationDto> memberConversations(@AuthenticationPrincipal UserPrincipal principal) {
        return chatService.getMemberConversations(principal.id())
                .stream().map(ChatController::toDto).toList();
    }

    @PostMapping("/conversations")
    public ConversationDto createConversation(@AuthenticationPrincipal UserPrincipal principal,
                                               @RequestBody CreateConversationRequest req) {
        Conversation conv = chatService.createConversation(principal, req.subject());
        return toDto(conv);
    }

    @GetMapping("/conversations/{id}/messages")
    public Page<ChatMessageDto> messages(@AuthenticationPrincipal UserPrincipal principal,
                                          @PathVariable UUID id,
                                          @PageableDefault(size = 50) Pageable pageable) {
        chatService.assertMemberOwns(id, principal);
        return chatService.getMessages(id, pageable).map(ChatController::toMsgDto);
    }

    @PostMapping("/conversations/{id}/messages")
    public ChatMessageDto sendMessage(@AuthenticationPrincipal UserPrincipal principal,
                                       @PathVariable UUID id,
                                       @Valid @RequestBody SendMessageRequest req) {
        ChatMessage msg = chatService.sendMemberMessage(id, principal, req.content());
        return toMsgDto(msg);
    }

    @PostMapping("/conversations/{id}/help-request")
    public ConversationDto helpRequest(@AuthenticationPrincipal UserPrincipal principal,
                                        @PathVariable UUID id) {
        chatService.assertMemberOwns(id, principal);
        return toDto(chatService.requestHelp(id));
    }

    @PutMapping("/conversations/{id}/read")
    public ResponseEntity<?> markRead(@AuthenticationPrincipal UserPrincipal principal,
                                        @PathVariable UUID id) {
        chatService.markRead(id, principal);
        return ResponseEntity.ok().build();
    }

    /* ---- Coach Endpoints ---- */

    @GetMapping("/coach/conversations")
    @PreAuthorize("hasAnyRole('PLATFORM_ADMIN', 'COACH_ADMIN', 'PLATFORM_SUPPORT')")
    public List<ConversationDto> coachConversations(@AuthenticationPrincipal UserPrincipal principal) {
        return chatService.getCoachConversations(principal)
                .stream().map(ChatController::toDto).toList();
    }

    @GetMapping("/coach/conversations/{id}/messages")
    @PreAuthorize("hasAnyRole('PLATFORM_ADMIN', 'COACH_ADMIN', 'PLATFORM_SUPPORT')")
    public Page<ChatMessageDto> coachMessages(@AuthenticationPrincipal UserPrincipal principal,
                                                @PathVariable UUID id,
                                                @PageableDefault(size = 50) Pageable pageable) {
        chatService.assertCoachCanAccess(id, principal);
        return chatService.getMessages(id, pageable).map(ChatController::toMsgDto);
    }

    @PostMapping("/coach/conversations/{id}/messages")
    @PreAuthorize("hasAnyRole('PLATFORM_ADMIN', 'COACH_ADMIN', 'PLATFORM_SUPPORT')")
    public ChatMessageDto coachSendMessage(@AuthenticationPrincipal UserPrincipal principal,
                                             @PathVariable UUID id,
                                             @Valid @RequestBody SendMessageRequest req) {
        ChatMessage msg = chatService.sendCoachMessage(id, principal, req.content());
        return toMsgDto(msg);
    }

    @PutMapping("/coach/conversations/{id}/read")
    @PreAuthorize("hasAnyRole('PLATFORM_ADMIN', 'COACH_ADMIN', 'PLATFORM_SUPPORT')")
    public ResponseEntity<?> coachMarkRead(@AuthenticationPrincipal UserPrincipal principal,
                                             @PathVariable UUID id) {
        chatService.markRead(id, principal);
        return ResponseEntity.ok().build();
    }

    @PostMapping("/coach/conversations/{id}/takeover")
    @PreAuthorize("hasAnyRole('PLATFORM_ADMIN', 'COACH_ADMIN', 'PLATFORM_SUPPORT')")
    public ConversationDto takeover(@AuthenticationPrincipal UserPrincipal principal,
                                     @PathVariable UUID id) {
        return toDto(chatService.takeover(id, principal));
    }

    @PostMapping("/coach/conversations/{id}/release")
    @PreAuthorize("hasAnyRole('PLATFORM_ADMIN', 'COACH_ADMIN', 'PLATFORM_SUPPORT')")
    public ConversationDto release(@AuthenticationPrincipal UserPrincipal principal,
                                     @PathVariable UUID id) {
        return toDto(chatService.release(id, principal));
    }

    @GetMapping("/coach/dashboard")
    @PreAuthorize("hasAnyRole('PLATFORM_ADMIN', 'COACH_ADMIN', 'PLATFORM_SUPPORT')")
    public Map<String, Object> coachDashboard(@AuthenticationPrincipal UserPrincipal principal) {
        return chatService.getCoachDashboardStats(principal);
    }

    @GetMapping("/presence")
    public Map<UUID, Boolean> presence(@RequestParam List<UUID> userIds) {
        return presenceService.getOnlineStatus(userIds);
    }

    /* ---- File Sharing ---- */

    @PostMapping("/conversations/{id}/files")
    public ResponseEntity<?> uploadFile(@AuthenticationPrincipal UserPrincipal principal,
                                         @PathVariable UUID id,
                                         @RequestParam("file") MultipartFile file,
                                         @RequestParam(value = "content", defaultValue = "") String content) {
        chatService.assertMemberOwns(id, principal);
        return handleFileUpload(id, principal, file, content, false);
    }

    @PostMapping("/coach/conversations/{id}/files")
    @PreAuthorize("hasAnyRole('PLATFORM_ADMIN', 'COACH_ADMIN', 'PLATFORM_SUPPORT')")
    public ResponseEntity<?> coachUploadFile(@AuthenticationPrincipal UserPrincipal principal,
                                               @PathVariable UUID id,
                                               @RequestParam("file") MultipartFile file,
                                               @RequestParam(value = "content", defaultValue = "") String content) {
        chatService.assertCoachCanAccess(id, principal);
        return handleFileUpload(id, principal, file, content, true);
    }

    @GetMapping("/files/{fileId}/download")
    public ResponseEntity<?> downloadFile(@AuthenticationPrincipal UserPrincipal principal,
                                            @PathVariable UUID fileId) {
        UUID conversationId = chatFileService.getConversationId(fileId);
        if (conversationId == null) return ResponseEntity.notFound().build();
        chatService.assertUserCanAccess(conversationId, principal);
        return chatFileService.getDownloadResponse(fileId);
    }

    private ResponseEntity<?> handleFileUpload(UUID conversationId, UserPrincipal principal,
                                                MultipartFile file, String content, boolean isCoach) {
        try {
            Conversation conv = chatService.getConversation(conversationId);
            ChatFile chatFile = chatFileService.upload(file, conv, principal);
            Map<String, Object> metadata = chatFileService.buildFileMetadata(chatFile);

            String msgContent = content.isBlank() ? chatFile.getFilename() : content;
            ChatMessage msg = isCoach
                    ? chatService.sendCoachFileMessage(conversationId, principal, msgContent, metadata)
                    : chatService.sendMemberFileMessage(conversationId, principal, msgContent, metadata);

            chatFileService.linkMessage(chatFile, msg.getId());

            return ResponseEntity.status(HttpStatus.CREATED).body(toMsgDto(msg));
        } catch (ChatFileService.FileTooLargeException e) {
            return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE)
                    .body(Map.of("status", 413, "message", e.getMessage()));
        } catch (ChatFileService.UnsupportedFileTypeException e) {
            return ResponseEntity.status(HttpStatus.UNSUPPORTED_MEDIA_TYPE)
                    .body(Map.of("status", 415, "message", e.getMessage()));
        }
    }

    /* ---- Mappers (use shadow ID fields to avoid lazy loading) ---- */

    static ConversationDto toDto(Conversation c) {
        return new ConversationDto(
                c.getId(), c.getTenantId(), c.getMemberId(),
                c.getMemberName(), c.getMemberAvatarUrl(),
                c.getAssignedCoachId(), c.getAssignedCoachName(),
                c.getControllingCoachId(), c.getControllingCoachName(),
                c.getMode().name(), c.getStatus().name(), c.getSubject(),
                c.getSentimentScore(), c.getSentimentLabel(),
                c.isHelpRequested(),
                c.getLastMessageAt(), c.getLastMessagePreview(),
                c.getUnreadCoachCount(), c.getUnreadMemberCount(),
                c.getCreatedAt()
        );
    }

    static ChatMessageDto toMsgDto(ChatMessage m) {
        return new ChatMessageDto(
                m.getId(), m.getConversationId(),
                m.getSenderType().name(), m.getSenderId(), m.getSenderName(),
                m.getSenderAvatarUrl(),
                m.getContent(), m.getSentimentScore(),
                m.getMetadata(), m.getCreatedAt()
        );
    }
}
