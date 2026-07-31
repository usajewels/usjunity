package com.mxsuite.service;

import com.mxsuite.model.ChatFile;
import com.mxsuite.model.Conversation;
import com.mxsuite.model.User;
import com.mxsuite.repository.ChatFileRepository;
import com.mxsuite.repository.UserRepository;
import com.mxsuite.security.UserPrincipal;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.InputStreamResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Duration;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Service
public class ChatFileService {

    private static final Logger log = LoggerFactory.getLogger(ChatFileService.class);

    private static final long MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
    private static final String S3_PREFIX = "s3:";
    private static final Duration PRESIGNED_URL_EXPIRY = Duration.ofMinutes(15);

    private static final Set<String> ALLOWED_CONTENT_TYPES = Set.of(
            "image/png", "image/jpeg", "image/gif", "image/webp",
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "text/plain"
    );

    private static final Set<String> ALLOWED_EXTENSIONS = Set.of(
            ".png", ".jpg", ".jpeg", ".gif", ".webp",
            ".pdf", ".docx", ".xlsx", ".txt"
    );

    private final ChatFileRepository chatFileRepository;
    private final UserRepository userRepository;
    private final String basePath;

    @Autowired(required = false)
    private S3StorageService s3StorageService;

    public ChatFileService(ChatFileRepository chatFileRepository,
                           UserRepository userRepository,
                           @Value("${mxsuite.storage.local.base-path:./data/files}") String basePath) {
        this.chatFileRepository = chatFileRepository;
        this.userRepository = userRepository;
        this.basePath = basePath;
    }

    /**
     * Validate, store, and return a ChatFile record.
     * Files are stored in S3 when available, otherwise on local disk.
     */
    public ChatFile upload(MultipartFile file, Conversation conversation, UserPrincipal principal) {
        // Validate not empty
        if (file.isEmpty()) {
            throw new IllegalArgumentException("File is empty");
        }

        // Validate size
        if (file.getSize() > MAX_FILE_SIZE) {
            throw new FileTooLargeException("File exceeds maximum size of 10MB");
        }

        // Validate content type
        String contentType = file.getContentType();
        if (contentType == null || !ALLOWED_CONTENT_TYPES.contains(contentType)) {
            throw new UnsupportedFileTypeException(
                    "File type not allowed. Accepted: images, PDF, Word, Excel, text");
        }

        // Sanitize filename
        String originalFilename = file.getOriginalFilename();
        if (originalFilename == null) originalFilename = "unnamed";
        String sanitizedFilename = Paths.get(originalFilename).getFileName().toString()
                .replaceAll("[^a-zA-Z0-9._-]", "_");

        // Validate extension
        String ext = getExtension(sanitizedFilename);
        if (!ALLOWED_EXTENSIONS.contains(ext.toLowerCase())) {
            throw new UnsupportedFileTypeException(
                    "File extension not allowed: " + ext);
        }

        try {
            User user = userRepository.findById(principal.id())
                    .orElseThrow(() -> new IllegalArgumentException("User not found"));

            // Build storage path: {basePath}/chat/{tenantId}/{conversationId}/{UUID}_{filename}
            String storageName = UUID.randomUUID() + "_" + sanitizedFilename;
            Path storageDir = Paths.get(basePath, "chat",
                    conversation.getTenantId().toString(),
                    conversation.getId().toString());

            // Path traversal defense
            Path resolvedFile = storageDir.resolve(storageName).normalize();
            if (!resolvedFile.startsWith(Paths.get(basePath).normalize())) {
                log.error("Path traversal attempt detected: resolved={} base={}", resolvedFile, basePath);
                throw new IllegalArgumentException("Invalid file path");
            }

            // Always write to local first (needed for S3 upload and as fallback)
            Files.createDirectories(storageDir);
            Files.copy(file.getInputStream(), resolvedFile);

            // Determine final storage path: S3 or local
            String finalStoragePath;

            if (isS3Available()) {
                String s3Key = "chat/" + conversation.getTenantId() + "/"
                        + conversation.getId() + "/" + storageName;
                try {
                    s3StorageService.upload(resolvedFile, s3Key);
                    finalStoragePath = S3_PREFIX + s3Key;
                    Files.deleteIfExists(resolvedFile);
                    log.info("Chat file uploaded to S3: key='{}'", s3Key);
                } catch (Exception e) {
                    log.warn("S3 upload failed, falling back to local storage: {}", e.getMessage());
                    finalStoragePath = resolvedFile.toString();
                }
            } else {
                finalStoragePath = resolvedFile.toString();
            }

            ChatFile chatFile = new ChatFile();
            chatFile.setConversation(conversation);
            chatFile.setFilename(sanitizedFilename);
            chatFile.setContentType(contentType);
            chatFile.setFileSize(file.getSize());
            chatFile.setStoragePath(finalStoragePath);
            chatFile.setUploadedBy(user);

            chatFile = chatFileRepository.save(chatFile);

            log.info("Chat file uploaded: name='{}' size={} conversation={} by user={} storage={}",
                    sanitizedFilename, file.getSize(), conversation.getId(), principal.email(),
                    finalStoragePath.startsWith(S3_PREFIX) ? "s3" : "local");

            return chatFile;
        } catch (IOException e) {
            log.error("Chat file upload failed: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to store file", e);
        }
    }

    /**
     * Build the metadata map for a file attachment message.
     */
    public Map<String, Object> buildFileMetadata(ChatFile chatFile) {
        return Map.of("fileAttachment", Map.of(
                "fileId", chatFile.getId().toString(),
                "url", "/chat/files/" + chatFile.getId() + "/download",
                "filename", chatFile.getFilename(),
                "fileSize", chatFile.getFileSize(),
                "contentType", chatFile.getContentType()
        ));
    }

    /**
     * Return a download response for the given file ID.
     * S3 files redirect to a presigned URL; local files are streamed directly.
     */
    public ResponseEntity<?> getDownloadResponse(UUID fileId) {
        ChatFile chatFile = chatFileRepository.findById(fileId).orElse(null);
        if (chatFile == null) {
            return ResponseEntity.notFound().build();
        }

        String storagePath = chatFile.getStoragePath();

        // S3 mode: redirect to presigned URL
        if (storagePath.startsWith(S3_PREFIX)) {
            if (!isS3Available()) {
                log.error("Chat file {} stored in S3 but S3 is not configured", fileId);
                return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
            }

            String s3Key = storagePath.substring(S3_PREFIX.length());
            URL presignedUrl = s3StorageService.getPresignedUrl(s3Key, PRESIGNED_URL_EXPIRY);

            return ResponseEntity.status(HttpStatus.FOUND)
                    .header(HttpHeaders.LOCATION, presignedUrl.toString())
                    .build();
        }

        // Local mode: stream file
        try {
            Path filePath = Paths.get(storagePath);
            if (!Files.exists(filePath)) {
                log.error("Chat file not found on disk: {}", filePath);
                return ResponseEntity.notFound().build();
            }

            InputStreamResource resource = new InputStreamResource(Files.newInputStream(filePath));
            String ct = chatFile.getContentType() != null ? chatFile.getContentType() : "application/octet-stream";

            return ResponseEntity.ok()
                    .contentType(MediaType.parseMediaType(ct))
                    .header(HttpHeaders.CONTENT_DISPOSITION,
                            "attachment; filename=\"" + chatFile.getFilename() + "\"")
                    .contentLength(chatFile.getFileSize())
                    .body(resource);
        } catch (IOException e) {
            log.error("Chat file download failed for file {}: {}", fileId, e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /**
     * Link a chat file to its message after the message is created.
     */
    public void linkMessage(ChatFile chatFile, UUID messageId) {
        chatFile.setMessageId(messageId);
        chatFileRepository.save(chatFile);
    }

    /**
     * Get the conversation ID for a file (for authorization checks).
     */
    public UUID getConversationId(UUID fileId) {
        return chatFileRepository.findById(fileId)
                .map(ChatFile::getConversationId)
                .orElse(null);
    }

    private boolean isS3Available() {
        return s3StorageService != null && s3StorageService.isEnabled();
    }

    private String getExtension(String filename) {
        int dot = filename.lastIndexOf('.');
        return dot >= 0 ? filename.substring(dot) : "";
    }

    // Custom exceptions for proper HTTP status mapping
    public static class FileTooLargeException extends RuntimeException {
        public FileTooLargeException(String message) { super(message); }
    }

    public static class UnsupportedFileTypeException extends RuntimeException {
        public UnsupportedFileTypeException(String message) { super(message); }
    }
}
