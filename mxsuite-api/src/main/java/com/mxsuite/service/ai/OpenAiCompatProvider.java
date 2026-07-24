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
 * OpenAI-compatible chat completions provider.
 * Works with Groq, Grok (xAI), and any other OpenAI-compatible API.
 */
public class OpenAiCompatProvider implements AiProvider {

    private static final Logger log = LoggerFactory.getLogger(OpenAiCompatProvider.class);

    private final String providerName;
    private final String apiKey;
    private final String model;
    private final String baseUrl;
    private final RestTemplate restTemplate = new RestTemplate();

    public OpenAiCompatProvider(String providerName, String apiKey, String model, String baseUrl) {
        this.providerName = providerName;
        this.apiKey = apiKey;
        this.model = model;
        this.baseUrl = baseUrl;
    }

    @Override
    public String chat(String systemPrompt, String userPrompt, int maxTokens) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("Authorization", "Bearer " + apiKey);

        List<Map<String, String>> messages = new ArrayList<>();
        if (systemPrompt != null && !systemPrompt.isBlank()) {
            messages.add(Map.of("role", "system", "content", systemPrompt));
        }
        messages.add(Map.of("role", "user", "content", userPrompt));

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("model", model);
        body.put("max_tokens", maxTokens);
        body.put("messages", messages);

        HttpEntity<Map<String, Object>> request = new HttpEntity<>(body, headers);

        String url = baseUrl + "/v1/chat/completions";
        log.debug("{} request: model={} maxTokens={}", providerName, model, maxTokens);

        ResponseEntity<JsonNode> response = restTemplate.exchange(
                url, HttpMethod.POST, request, JsonNode.class);

        if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
            throw new RuntimeException(providerName + " API returned status " + response.getStatusCode());
        }

        JsonNode choices = response.getBody().path("choices");
        if (choices.isArray() && !choices.isEmpty()) {
            return choices.get(0).path("message").path("content").asText();
        }
        throw new RuntimeException("Unexpected " + providerName + " API response structure");
    }

    @Override
    public boolean isAvailable() {
        return apiKey != null && !apiKey.isBlank();
    }

    @Override
    public String name() {
        return providerName;
    }
}
