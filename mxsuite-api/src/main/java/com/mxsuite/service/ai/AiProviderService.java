package com.mxsuite.service.ai;

import com.mxsuite.config.AiProviderConfig;
import com.mxsuite.config.AiProviderConfig.ProviderSettings;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.*;

/**
 * Orchestrates AI providers with task-based routing.
 * Each task (e.g. "mapping", "chat") can be routed to a different provider.
 */
@Service
public class AiProviderService {

    private static final Logger log = LoggerFactory.getLogger(AiProviderService.class);

    private final AiProviderConfig config;
    private final Map<String, AiProvider> providers = new LinkedHashMap<>();

    public AiProviderService(AiProviderConfig config) {
        this.config = config;
    }

    @PostConstruct
    public void init() {
        for (var entry : config.getProviders().entrySet()) {
            String name = entry.getKey();
            ProviderSettings settings = entry.getValue();

            if (!settings.isConfigured()) {
                log.info("AI provider '{}' — no API key, skipping", name);
                continue;
            }

            AiProvider provider = createProvider(name, settings);
            providers.put(name, provider);
            log.info("AI provider '{}' registered — model={}", name, settings.getModel());
        }

        if (providers.isEmpty()) {
            log.warn("No AI providers configured — AI features will be unavailable");
        } else {
            log.info("AI providers available: {}", providers.keySet());
            for (var taskEntry : config.getTasks().entrySet()) {
                String task = taskEntry.getKey();
                String providerName = taskEntry.getValue();
                boolean available = providers.containsKey(providerName);
                log.info("AI task '{}' → provider '{}' ({})", task, providerName,
                        available ? "available" : "NOT configured");
            }
        }
    }

    private AiProvider createProvider(String name, ProviderSettings settings) {
        if ("anthropic".equalsIgnoreCase(name)) {
            return new AnthropicProvider(settings.getApiKey(), settings.getModel(), settings.getBaseUrl());
        }
        // All others (groq, grok, openai, etc.) use OpenAI-compatible format
        return new OpenAiCompatProvider(name, settings.getApiKey(), settings.getModel(), settings.getBaseUrl());
    }

    /**
     * Send a chat request using the provider assigned to the given task.
     */
    public String chat(String task, String systemPrompt, String userPrompt, int maxTokens) {
        AiProvider provider = resolveProvider(task);
        log.info("AI task '{}' using provider '{}' ", task, provider.name());
        return provider.chat(systemPrompt, userPrompt, maxTokens);
    }

    /**
     * Whether the provider for the given task is available.
     */
    public boolean isAvailable(String task) {
        String providerName = config.getTasks().getOrDefault(task, "");
        AiProvider provider = providers.get(providerName);
        return provider != null && provider.isAvailable();
    }

    /**
     * Returns names of all configured and available providers.
     */
    public List<String> getAvailableProviders() {
        return new ArrayList<>(providers.keySet());
    }

    private AiProvider resolveProvider(String task) {
        String providerName = config.getTasks().get(task);
        if (providerName == null) {
            throw new IllegalStateException("No AI provider configured for task '" + task + "'");
        }
        AiProvider provider = providers.get(providerName);
        if (provider == null) {
            throw new IllegalStateException(
                    "AI provider '" + providerName + "' for task '" + task + "' is not available — check API key");
        }
        return provider;
    }
}
