package com.mxsuite.service.ai;

import com.fasterxml.jackson.databind.JsonNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.*;
import org.springframework.web.client.RestTemplate;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Anthropic Claude provider — uses the /v1/messages API format.
 */
public class AnthropicProvider implements AiProvider {

    private static final Logger log = LoggerFactory.getLogger(AnthropicProvider.class);

    private final String apiKey;
    private final String model;
    private final String baseUrl;
    private final RestTemplate restTemplate = new RestTemplate();

    public AnthropicProvider(String apiKey, String model, String baseUrl) {
        this.apiKey = apiKey;
        this.model = model;
        this.baseUrl = baseUrl;
    }

    @Override
    public String chat(String systemPrompt, String userPrompt, int maxTokens) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("x-api-key", apiKey);
        headers.set("anthropic-version", "2023-06-01");

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("model", model);
        body.put("max_tokens", maxTokens);
        if (systemPrompt != null && !systemPrompt.isBlank()) {
            body.put("system", systemPrompt);
        }
        body.put("messages", List.of(Map.of("role", "user", "content", userPrompt)));

        HttpEntity<Map<String, Object>> request = new HttpEntity<>(body, headers);

        String url = baseUrl + "/v1/messages";
        log.debug("Anthropic request: model={} maxTokens={}", model, maxTokens);

        ResponseEntity<JsonNode> response = restTemplate.exchange(
                url, HttpMethod.POST, request, JsonNode.class);

        if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
            throw new RuntimeException("Anthropic API returned status " + response.getStatusCode());
        }

        JsonNode content = response.getBody().path("content");
        if (content.isArray() && !content.isEmpty()) {
            return content.get(0).path("text").asText();
        }
        throw new RuntimeException("Unexpected Anthropic API response structure");
    }

    @Override
    public boolean isAvailable() {
        return apiKey != null && !apiKey.isBlank();
    }

    @Override
    public String name() {
        return "anthropic";
    }
}
