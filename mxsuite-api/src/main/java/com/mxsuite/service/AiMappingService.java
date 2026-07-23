package com.mxsuite.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.math.BigDecimal;
import java.util.*;

/**
 * Uses Claude API to intelligently map source fields to target fields.
 * Falls back gracefully — callers should catch exceptions and use rule-based matching.
 */
@Service
public class AiMappingService {

    private static final Logger log = LoggerFactory.getLogger(AiMappingService.class);
    private static final String API_URL = "https://api.anthropic.com/v1/messages";

    private final String apiKey;
    private final String model;
    private final ObjectMapper objectMapper;
    private final RestTemplate restTemplate;

    public record FieldInput(String header, String sampleValue) {}

    public record TargetFieldDef(String entity, String field, String description) {}

    public record AiMapping(
            String sourceField,
            String targetEntity,
            String targetField,
            BigDecimal confidence
    ) {}

    public AiMappingService(
            @Value("${mxsuite.ai.anthropic-api-key:}") String apiKey,
            @Value("${mxsuite.ai.model:claude-sonnet-4-20250514}") String model,
            ObjectMapper objectMapper) {
        this.apiKey = apiKey;
        this.model = model;
        this.objectMapper = objectMapper;
        this.restTemplate = new RestTemplate();
    }

    public boolean isAvailable() {
        return apiKey != null && !apiKey.isBlank();
    }

    /**
     * Ask Claude to map source fields to target fields.
     * Returns a list of mappings — one per source field.
     * Fields Claude can't confidently map get confidence 0.
     */
    public List<AiMapping> mapFields(List<FieldInput> sourceFields, List<TargetFieldDef> targetFields) {
        if (!isAvailable()) {
            throw new IllegalStateException("Anthropic API key not configured");
        }

        String prompt = buildPrompt(sourceFields, targetFields);

        try {
            String response = callClaude(prompt);
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

    private String callClaude(String prompt) throws Exception {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("x-api-key", apiKey);
        headers.set("anthropic-version", "2023-06-01");

        Map<String, Object> body = Map.of(
                "model", model,
                "max_tokens", 4096,
                "messages", List.of(Map.of("role", "user", "content", prompt))
        );

        HttpEntity<Map<String, Object>> request = new HttpEntity<>(body, headers);

        ResponseEntity<JsonNode> response = restTemplate.exchange(
                API_URL, HttpMethod.POST, request, JsonNode.class);

        if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
            throw new RuntimeException("Claude API returned status " + response.getStatusCode());
        }

        // Extract text from response content[0].text
        JsonNode content = response.getBody().path("content");
        if (content.isArray() && !content.isEmpty()) {
            return content.get(0).path("text").asText();
        }
        throw new RuntimeException("Unexpected Claude API response structure");
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
