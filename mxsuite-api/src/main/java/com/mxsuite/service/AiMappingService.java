package com.mxsuite.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mxsuite.service.ai.AiProviderService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.util.*;

/**
 * Uses an AI provider to intelligently map source fields to target fields.
 * Falls back gracefully — callers should catch exceptions and use rule-based matching.
 */
@Service
public class AiMappingService {

    private static final Logger log = LoggerFactory.getLogger(AiMappingService.class);
    private static final String TASK = "mapping";

    private final AiProviderService aiProviderService;
    private final ObjectMapper objectMapper;

    public record FieldInput(String header, String sampleValue) {}

    public record TargetFieldDef(String entity, String field, String description) {}

    public record AiMapping(
            String sourceField,
            String targetEntity,
            String targetField,
            BigDecimal confidence
    ) {}

    public AiMappingService(AiProviderService aiProviderService, ObjectMapper objectMapper) {
        this.aiProviderService = aiProviderService;
        this.objectMapper = objectMapper;
    }

    public boolean isAvailable() {
        return aiProviderService.isAvailable(TASK);
    }

    /**
     * Ask the AI provider to map source fields to target fields.
     * Returns a list of mappings — one per source field.
     * Fields the model can't confidently map get confidence 0.
     */
    public List<AiMapping> mapFields(List<FieldInput> sourceFields, List<TargetFieldDef> targetFields) {
        if (!isAvailable()) {
            throw new IllegalStateException("No AI provider configured for mapping");
        }

        String prompt = buildPrompt(sourceFields, targetFields);

        try {
            String response = aiProviderService.chat(TASK, null, prompt, 8192);
            return parseResponse(response, sourceFields);
        } catch (Exception e) {
            log.warn("AI mapping failed, caller should fall back to rule-based: {}", e.getMessage());
            throw new RuntimeException("AI mapping failed", e);
        }
    }

    private String buildPrompt(List<FieldInput> sourceFields, List<TargetFieldDef> targetFields) {
        StringBuilder sb = new StringBuilder();
        sb.append("You are a data mapping expert. Map each source field to the best matching target field.\n\n");

        sb.append("TARGET FIELDS:\n");
        for (TargetFieldDef t : targetFields) {
            sb.append("  - ").append(t.entity()).append(".").append(t.field())
                    .append(" (").append(t.description()).append(")\n");
        }

        sb.append("\nSOURCE FIELDS (with sample values):\n");
        for (int i = 0; i < sourceFields.size(); i++) {
            FieldInput f = sourceFields.get(i);
            sb.append("  ").append(i + 1).append(". \"").append(f.header()).append("\"");
            if (f.sampleValue() != null && !f.sampleValue().isBlank()) {
                sb.append("  →  sample: \"").append(truncate(f.sampleValue(), 100)).append("\"");
            }
            sb.append("\n");
        }

        sb.append("\nRULES:\n");
        sb.append("- Each target field can only be used ONCE (no duplicates)\n");
        sb.append("- If no good match exists, set targetEntity and targetField to null and confidence to 0\n");
        sb.append("- Confidence: 95 = obvious match, 80-94 = strong match, 60-79 = likely match, below 60 = weak\n");
        sb.append("- Consider field names, abbreviations, synonyms, sample data format, and domain context\n");
        sb.append("- Sample values help disambiguate: dates, emails, phone numbers, etc.\n\n");

        sb.append("Respond ONLY with a JSON array. No markdown, no explanation. Each element:\n");
        sb.append("{\"sourceField\": \"...\", \"targetEntity\": \"...\"|null, \"targetField\": \"...\"|null, \"confidence\": 0-95}\n");

        return sb.toString();
    }

    private List<AiMapping> parseResponse(String responseText, List<FieldInput> sourceFields) throws Exception {
        // Strip markdown code fences if present
        String json = responseText.trim();
        if (json.startsWith("```")) {
            json = json.replaceAll("^```[a-z]*\\s*", "").replaceAll("\\s*```$", "");
        }

        List<Map<String, Object>> raw = objectMapper.readValue(json, new TypeReference<>() {});
        List<AiMapping> mappings = new ArrayList<>();

        for (Map<String, Object> entry : raw) {
            String sourceField = (String) entry.get("sourceField");
            String targetEntity = entry.get("targetEntity") instanceof String s ? s : null;
            String targetField = entry.get("targetField") instanceof String s ? s : null;
            Object confObj = entry.get("confidence");
            BigDecimal confidence = confObj != null
                    ? new BigDecimal(confObj.toString()).setScale(2, java.math.RoundingMode.HALF_UP)
                    : BigDecimal.ZERO;

            mappings.add(new AiMapping(sourceField, targetEntity, targetField, confidence));
        }

        log.info("AI mapping returned {} results for {} source fields",
                mappings.size(), sourceFields.size());
        return mappings;
    }

    private static String truncate(String s, int max) {
        return s.length() <= max ? s : s.substring(0, max) + "...";
    }
}
