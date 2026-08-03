package com.mxsuite.service;

import com.lowagie.text.*;
import com.lowagie.text.pdf.PdfWriter;
import com.lowagie.text.pdf.draw.LineSeparator;
import com.mxsuite.model.ChatMessage;
import com.mxsuite.model.Conversation;
import com.mxsuite.model.enums.MessageSender;
import com.mxsuite.repository.ChatMessageRepository;
import com.mxsuite.repository.ConversationRepository;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class ChatPdfExportService {

    private static final DateTimeFormatter DATE_FMT =
            DateTimeFormatter.ofPattern("MMM d, yyyy h:mm a").withZone(ZoneId.systemDefault());
    private static final DateTimeFormatter DATE_ONLY_FMT =
            DateTimeFormatter.ofPattern("MMM d, yyyy").withZone(ZoneId.systemDefault());

    private static final Color COLOR_MEMBER = new Color(0x1a, 0x56, 0xdb);   // dark blue
    private static final Color COLOR_COACH = new Color(0x6b, 0x4f, 0xa0);    // purple
    private static final Color COLOR_AI = new Color(0x8c, 0x8c, 0x8c);       // gray
    private static final Color COLOR_SYSTEM = new Color(0x8c, 0x8c, 0x8c);   // gray

    private final ConversationRepository conversationRepository;
    private final ChatMessageRepository chatMessageRepository;

    public ChatPdfExportService(ConversationRepository conversationRepository,
                                 ChatMessageRepository chatMessageRepository) {
        this.conversationRepository = conversationRepository;
        this.chatMessageRepository = chatMessageRepository;
    }

    @Transactional(readOnly = true)
    public byte[] generatePdf(UUID conversationId) {
        Conversation conv = conversationRepository.findById(conversationId)
                .orElseThrow(() -> new IllegalArgumentException("Conversation not found"));

        List<ChatMessage> messages = chatMessageRepository
                .findByConversationIdOrderByCreatedAtAsc(conversationId, Pageable.unpaged())
                .getContent();

        try {
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            Document doc = new Document(PageSize.A4, 50, 50, 50, 50);
            PdfWriter.getInstance(doc, baos);
            doc.open();

            addHeader(doc, conv, messages);
            addMessages(doc, messages);

            doc.close();
            return baos.toByteArray();
        } catch (DocumentException e) {
            throw new RuntimeException("Failed to generate PDF", e);
        }
    }

    private void addHeader(Document doc, Conversation conv, List<ChatMessage> messages)
            throws DocumentException {
        Font titleFont = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 18, COLOR_COACH);
        Paragraph title = new Paragraph("Chat Transcript", titleFont);
        title.setAlignment(Element.ALIGN_CENTER);
        title.setSpacingAfter(16);
        doc.add(title);

        Font labelFont = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 10, Color.DARK_GRAY);
        Font valueFont = FontFactory.getFont(FontFactory.HELVETICA, 10, Color.BLACK);

        if (conv.getMemberName() != null) {
            doc.add(metaLine("Member:", conv.getMemberName(), labelFont, valueFont));
        }
        String coachName = conv.getControllingCoachName() != null
                ? conv.getControllingCoachName() : conv.getAssignedCoachName();
        if (coachName != null) {
            doc.add(metaLine("Coach:", coachName, labelFont, valueFont));
        }
        if (conv.getSubject() != null) {
            doc.add(metaLine("Subject:", conv.getSubject(), labelFont, valueFont));
        }

        if (!messages.isEmpty()) {
            Instant first = messages.get(0).getCreatedAt();
            Instant last = messages.get(messages.size() - 1).getCreatedAt();
            String period = DATE_ONLY_FMT.format(first) + " – " + DATE_ONLY_FMT.format(last);
            doc.add(metaLine("Period:", period, labelFont, valueFont));
        }

        doc.add(metaLine("Exported:", DATE_FMT.format(Instant.now()), labelFont, valueFont));

        LineSeparator separator = new LineSeparator(1f, 100f, Color.LIGHT_GRAY, Element.ALIGN_CENTER, -2);
        doc.add(new Chunk(separator));
        doc.add(Chunk.NEWLINE);
    }

    private Paragraph metaLine(String label, String value, Font labelFont, Font valueFont) {
        Paragraph p = new Paragraph();
        p.add(new Chunk(label + " ", labelFont));
        p.add(new Chunk(value, valueFont));
        p.setSpacingAfter(2);
        return p;
    }

    private void addMessages(Document doc, List<ChatMessage> messages) throws DocumentException {
        Font timestampFont = FontFactory.getFont(FontFactory.HELVETICA, 8, Color.GRAY);
        Font contentFont = FontFactory.getFont(FontFactory.HELVETICA, 10, Color.BLACK);
        Font systemFont = FontFactory.getFont(FontFactory.HELVETICA_OBLIQUE, 10, COLOR_SYSTEM);
        Font attachFont = FontFactory.getFont(FontFactory.HELVETICA, 9, COLOR_COACH);

        LineSeparator dotted = new LineSeparator(0.5f, 80f, Color.LIGHT_GRAY,
                Element.ALIGN_CENTER, -2);

        for (ChatMessage msg : messages) {
            if (msg.getSenderType() == MessageSender.SYSTEM) {
                addSystemMessage(doc, msg, timestampFont, systemFont);
            } else {
                addRegularMessage(doc, msg, timestampFont, contentFont, attachFont);
            }

            doc.add(new Chunk(dotted));
            doc.add(Chunk.NEWLINE);
        }
    }

    private void addSystemMessage(Document doc, ChatMessage msg,
                                   Font timestampFont, Font systemFont)
            throws DocumentException {
        if (msg.getCreatedAt() != null) {
            Paragraph ts = new Paragraph(DATE_FMT.format(msg.getCreatedAt()), timestampFont);
            ts.setAlignment(Element.ALIGN_CENTER);
            doc.add(ts);
        }

        Paragraph content = new Paragraph(msg.getContent(), systemFont);
        content.setAlignment(Element.ALIGN_CENTER);
        content.setSpacingAfter(4);
        doc.add(content);
    }

    private void addRegularMessage(Document doc, ChatMessage msg,
                                    Font timestampFont, Font contentFont, Font attachFont)
            throws DocumentException {
        // Timestamp
        if (msg.getCreatedAt() != null) {
            Paragraph ts = new Paragraph(DATE_FMT.format(msg.getCreatedAt()), timestampFont);
            ts.setSpacingAfter(1);
            doc.add(ts);
        }

        // Sender name with role label
        Color senderColor = switch (msg.getSenderType()) {
            case MEMBER -> COLOR_MEMBER;
            case COACH -> COLOR_COACH;
            case AI -> COLOR_AI;
            default -> Color.BLACK;
        };
        String roleLabel = switch (msg.getSenderType()) {
            case MEMBER -> "Member";
            case COACH -> "Coach";
            case AI -> "AI Assistant";
            default -> "";
        };
        String senderDisplay = msg.getSenderType() == MessageSender.AI
                ? "AI Assistant"
                : (msg.getSenderName() != null ? msg.getSenderName() : roleLabel);
        if (msg.getSenderType() != MessageSender.AI && !roleLabel.isEmpty()) {
            senderDisplay += " (" + roleLabel + ")";
        }

        Font senderFont = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 10, senderColor);
        Paragraph sender = new Paragraph(senderDisplay, senderFont);
        sender.setSpacingAfter(2);
        doc.add(sender);

        // Content
        Paragraph content = new Paragraph(msg.getContent(), contentFont);
        content.setSpacingAfter(2);
        doc.add(content);

        // File attachment info from metadata
        String filename = extractFilename(msg.getMetadata());
        if (filename != null) {
            Paragraph attach = new Paragraph("Attachment: " + filename, attachFont);
            attach.setSpacingAfter(2);
            doc.add(attach);
        }
    }

    @SuppressWarnings("unchecked")
    private String extractFilename(Map<String, Object> metadata) {
        if (metadata == null) return null;
        Object fileAtt = metadata.get("fileAttachment");
        if (fileAtt instanceof Map<?, ?> fa) {
            Object fn = fa.get("filename");
            return fn != null ? fn.toString() : null;
        }
        return null;
    }
}
