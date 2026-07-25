package com.mxsuite.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mxsuite.model.EntityCoverageEntry;
import com.mxsuite.service.ai.AiProviderService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.*;

/**
 * Uses an AI provider to detect which target entities are relevant
 * based on uploaded source data columns.
 */
@Service
public class EntityDetectionService {

    private static final Logger log = LoggerFactory.getLogger(EntityDetectionService.class);
    private static final String TASK = "entity-detection";
    private static final String FALLBACK_TASK = "mapping";
    private static final int MAX_COLUMNS = 200;

    private final AiProviderService aiProviderService;
    private final TargetSchemaService targetSchemaService;
    private final ObjectMapper objectMapper;

    /** Entity descriptions for the LLM prompt — entity name → key indicators */
    private static final Map<String, String> ENTITY_DESCRIPTIONS = new LinkedHashMap<>();
    static {
        ENTITY_DESCRIPTIONS.put("Contact",
                "Individual people — members, prospects, staff. Key columns: firstName, lastName, email, phone, title, company");
        ENTITY_DESCRIPTIONS.put("ContactAddress",
                "Mailing/billing addresses linked to contacts. Key columns: address, city, state, zip, country");
        ENTITY_DESCRIPTIONS.put("Organization",
                "Companies, businesses, or organizational entities (separate from contact.company). Key columns: orgName, orgEmail, orgPhone, orgWebsite");
        ENTITY_DESCRIPTIONS.put("Membership",
                "Membership records — type, status, join/expiry dates, dues. Key columns: memberType, memberStatus, joinDate, expirationDate, duesAmount");
        ENTITY_DESCRIPTIONS.put("Event",
                "Events, conferences, workshops. Key columns: eventName, startDate, endDate, eventType, location");
        ENTITY_DESCRIPTIONS.put("EventRegistration",
                "Event attendance/registration records linking contacts to events. Key columns: registrationDate, attendeeStatus, registrationFee");
        ENTITY_DESCRIPTIONS.put("Invoice",
                "Invoices or bills. Key columns: invoiceNumber, invoiceDate, dueDate, invoiceTotal, balanceDue");
        ENTITY_DESCRIPTIONS.put("InvoiceLineItem",
                "Individual line items on invoices. Key columns: itemDescription, quantity, unitPrice, lineTotal");
        ENTITY_DESCRIPTIONS.put("Payment",
                "Payment records. Key columns: paymentAmount, paymentDate, paymentMethod, checkNumber");
        ENTITY_DESCRIPTIONS.put("Order",
                "Sales orders or purchases. Key columns: orderNumber, orderDate, orderTotal");
        ENTITY_DESCRIPTIONS.put("OrderLineItem",
                "Individual line items on orders. Key columns: productName, quantity, unitPrice, lineTotal");
    }

    public EntityDetectionService(AiProviderService aiProviderService,
                                   TargetSchemaService targetSchemaService,
                                   ObjectMapper objectMapper) {
        this.aiProviderService = aiProviderService;
        this.targetSchemaService = targetSchemaService;
        this.objectMapper = objectMapper;
    }

    public boolean isAvailable() {
        return aiProviderService.isAvailable(TASK) || aiProviderService.isAvailable(FALLBACK_TASK);
    }

    /**
     * Detect which target entities are relevant based on source columns.
     * Returns a coverage entry for each of the 11 target entities.
     *
     * @param sourceColumns list of column maps with keys: name, tableName, dataType, sampleValues
     */
    public List<EntityCoverageEntry> detectEntities(List<Map<String, Object>> sourceColumns) {
        if (!isAvailable()) {
            log.warn("No AI provider available for entity detection — returning all entities as detected");
            return allEntitiesFallback();
        }

        String prompt = buildPrompt(sourceColumns);
        String systemPrompt = buildSystemPrompt();

        try {
            String taskId = aiProviderService.isAvailable(TASK) ? TASK : FALLBACK_TASK;
            String response = aiProviderService.chat(taskId, systemPrompt, prompt, 4096);
            List<EntityCoverageEntry> result = parseResponse(response);
            log.info("Entity detection complete: {}/{} entities detected",
                    result.stream().filter(EntityCoverageEntry::isDetected).count(), result.size());
            return result;
        } catch (Exception e) {
            log.warn("Entity detection failed, returning all entities: {}", e.getMessage());
            return allEntitiesFallback();
        }
    }

    private String buildSystemPrompt() {
        return """
                You are a data migration analyst. Your task is to determine which GrowthZone target \
                entities are relevant based on the source data columns provided.

                Analyze the source column names, table names, data types, and sample values to determine \
                which of the 11 target entities the source data contains information for.

                Rules:
                - Confidence 90+ = strong evidence (multiple matching columns with clear names/data)
                - Confidence 60-89 = moderate evidence (some matching columns or ambiguous names)
                - Confidence below 60 = weak/no evidence (mark as detected=false)
                - Contact is almost always present — default to detected unless clearly absent
                - If a parent entity is detected, consider whether child entities are also present \
                  (e.g., if Invoice is present, InvoiceLineItem may also be present)
                - If a child entity is detected, the parent should also be detected
                - Look at table names as strong signals (e.g., a table named "Invoices" strongly indicates Invoice entity)
                - Sample values help confirm: dates in join/expiry columns suggest Membership, dollar amounts suggest financial entities

                Respond ONLY with a JSON array. No markdown fences, no explanation. Each element:
                {"entity": "...", "detected": true|false, "confidence": 0-99, "reasoning": "brief explanation"}
                """;
    }

    private String buildPrompt(List<Map<String, Object>> sourceColumns) {
        StringBuilder sb = new StringBuilder();

        sb.append("TARGET ENTITIES TO EVALUATE:\n\n");
        for (var entry : ENTITY_DESCRIPTIONS.entrySet()) {
            sb.append("  - ").append(entry.getKey()).append(": ").append(entry.getValue()).append("\n");
        }

        sb.append("\nSOURCE DATA COLUMNS:\n\n");

        // Cap at MAX_COLUMNS to keep prompt reasonable
        int limit = Math.min(sourceColumns.size(), MAX_COLUMNS);
        for (int i = 0; i < limit; i++) {
            Map<String, Object> col = sourceColumns.get(i);
            String name = Objects.toString(col.get("name"), "unknown");
            String tableName = col.get("tableName") != null ? Objects.toString(col.get("tableName")) : null;
            String dataType = col.get("dataType") != null ? Objects.toString(col.get("dataType")) : null;

            sb.append("  ").append(i + 1).append(". ");
            if (tableName != null) {
                sb.append("[").append(tableName).append("] ");
            }
            sb.append("\"").append(name).append("\"");
            if (dataType != null) {
                sb.append(" (").append(dataType).append(")");
            }

            // Add up to 3 sample values
            Object samples = col.get("sampleValues");
            if (samples instanceof List<?> sampleList && !sampleList.isEmpty()) {
                List<String> vals = sampleList.stream()
                        .limit(3)
                        .map(v -> truncate(Objects.toString(v, ""), 60))
                        .toList();
                sb.append("  → samples: ").append(vals);
            }
            sb.append("\n");
        }

        if (sourceColumns.size() > MAX_COLUMNS) {
            sb.append("  ... (").append(sourceColumns.size() - MAX_COLUMNS).append(" more columns omitted)\n");
        }

        sb.append("\nTotal source columns: ").append(sourceColumns.size()).append("\n");
        sb.append("\nAnalyze these source columns and return a JSON array with detection results for ALL 11 entities listed above.");

        return sb.toString();
    }

    private List<EntityCoverageEntry> parseResponse(String responseText) throws Exception {
        // Strip markdown code fences if present
        String json = responseText.trim();
        if (json.startsWith("```")) {
            json = json.replaceAll("^```[a-z]*\\s*", "").replaceAll("\\s*```$", "");
        }

        List<Map<String, Object>> raw = objectMapper.readValue(json, new TypeReference<>() {});
        List<EntityCoverageEntry> entries = new ArrayList<>();
        Set<String> seen = new HashSet<>();

        for (Map<String, Object> item : raw) {
            String entity = (String) item.get("entity");
            if (entity == null || seen.contains(entity)) continue;
            seen.add(entity);

            boolean detected = Boolean.TRUE.equals(item.get("detected"));
            Object confObj = item.get("confidence");
            BigDecimal confidence = confObj != null
                    ? new BigDecimal(confObj.toString()).setScale(2, RoundingMode.HALF_UP)
                    : BigDecimal.ZERO;
            String reasoning = item.get("reasoning") instanceof String s ? s : "";

            // Apply threshold: below 60 = not detected
            if (confidence.compareTo(BigDecimal.valueOf(60)) < 0) {
                detected = false;
            }

            entries.add(new EntityCoverageEntry(entity, detected, confidence, reasoning));
        }

        // Ensure all 11 entities are represented
        for (String entityName : ENTITY_DESCRIPTIONS.keySet()) {
            if (!seen.contains(entityName)) {
                entries.add(new EntityCoverageEntry(entityName, false, BigDecimal.ZERO, "Not evaluated by AI"));
            }
        }

        // Enforce parent-child consistency
        enforceParentChildConsistency(entries);

        return entries;
    }

    /**
     * If a child entity is detected, ensure its parent is too.
     * If a parent is NOT detected but its child is, promote the parent.
     */
    private void enforceParentChildConsistency(List<EntityCoverageEntry> entries) {
        Map<String, EntityCoverageEntry> byName = new HashMap<>();
        for (EntityCoverageEntry e : entries) {
            byName.put(e.getEntity(), e);
        }

        // Parent → child relationships
        Map<String, String> childToParent = Map.of(
                "ContactAddress", "Contact",
                "EventRegistration", "Event",
                "InvoiceLineItem", "Invoice",
                "OrderLineItem", "Order"
        );

        for (var rel : childToParent.entrySet()) {
            EntityCoverageEntry child = byName.get(rel.getKey());
            EntityCoverageEntry parent = byName.get(rel.getValue());
            if (child != null && parent != null && child.isDetected() && !parent.isDetected()) {
                parent.setDetected(true);
                if (parent.getConfidence().compareTo(BigDecimal.valueOf(60)) < 0) {
                    parent.setConfidence(BigDecimal.valueOf(60));
                }
                parent.setReasoning(parent.getReasoning() + " (promoted: child " + rel.getKey() + " detected)");
            }
        }
    }

    /** Fallback when AI is unavailable — all entities detected with confidence 50 */
    private List<EntityCoverageEntry> allEntitiesFallback() {
        return ENTITY_DESCRIPTIONS.keySet().stream()
                .map(entity -> new EntityCoverageEntry(
                        entity, true, BigDecimal.valueOf(50),
                        "AI unavailable — defaulting to included"))
                .toList();
    }

    private static String truncate(String s, int max) {
        return s.length() <= max ? s : s.substring(0, max) + "...";
    }
}
