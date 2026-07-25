package com.mxsuite.service.ai;

import com.mxsuite.config.AiProviderConfig;
import com.mxsuite.config.AiProviderConfig.ProviderSettings;
import com.mxsuite.repository.TenantRepository;
import com.mxsuite.util.EncryptionUtil;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.*;

/**
 * Orchestrates AI providers with task-based routing.
 * Each task (e.g. "mapping", "chat") can be routed to a different provider.
 * Checks DB overrides (platform tenant ai_config) before falling back to YAML defaults.
 * Supports admin-managed API keys stored encrypted in the database.
 */
@Service
public class AiProviderService {

    private static final Logger log = LoggerFactory.getLogger(AiProviderService.class);

    private final AiProviderConfig config;
    private final TenantRepository tenantRepository;
    private final String encryptionSecret;
    private final Map<String, AiProvider> providers = new LinkedHashMap<>();
    private final Set<String> dbKeyProviders = new HashSet<>();

    public AiProviderService(AiProviderConfig config, TenantRepository tenantRepository,
                             @Value("${mxsuite.security.jwt.secret:}") String encryptionSecret) {
        this.config = config;
        this.tenantRepository = tenantRepository;
        this.encryptionSecret = encryptionSecret;
    }

    @PostConstruct
    public void init() {
        // Load providers from env var keys
        for (var entry : config.getProviders().entrySet()) {
            String name = entry.getKey();
            ProviderSettings settings = entry.getValue();

            if (!settings.isConfigured()) {
                log.info("AI provider '{}' — no env API key, skipping", name);
                continue;
            }

            AiProvider provider = createProvider(name, settings);
            providers.put(name, provider);
            log.info("AI provider '{}' registered (env key) — model={}", name, settings.getModel());
        }

        // Override with DB keys if present
        applyDbKeyOverrides();

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

    private void applyDbKeyOverrides() {
        Map<String, String> dbKeys = getDbEncryptedKeys();
        for (var entry : dbKeys.entrySet()) {
            String name = entry.getKey();
            String encryptedKey = entry.getValue();
            try {
                String apiKey = EncryptionUtil.decrypt(encryptedKey, encryptionSecret);
                ProviderSettings yamlSettings = config.getProviders().get(name);
                if (yamlSettings == null) continue;

                AiProvider provider = createProviderWithKey(name, apiKey, yamlSettings);
                providers.put(name, provider);
                dbKeyProviders.add(name);
                log.info("AI provider '{}' loaded with DB key — model={}", name, yamlSettings.getModel());
            } catch (Exception e) {
                log.warn("Failed to decrypt DB key for provider '{}': {}", name, e.getMessage());
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

    private AiProvider createProviderWithKey(String name, String apiKey, ProviderSettings settings) {
        if ("anthropic".equalsIgnoreCase(name)) {
            return new AnthropicProvider(apiKey, settings.getModel(), settings.getBaseUrl());
        }
        return new OpenAiCompatProvider(name, apiKey, settings.getModel(), settings.getBaseUrl());
    }

    /**
     * Reload a specific provider with a new DB key (or fall back to env key if DB key removed).
     */
    public void reloadProvider(String name) {
        ProviderSettings yamlSettings = config.getProviders().get(name);
        if (yamlSettings == null) {
            log.warn("Cannot reload unknown provider '{}'", name);
            return;
        }

        Map<String, String> dbKeys = getDbEncryptedKeys();
        String encryptedKey = dbKeys.get(name);

        if (encryptedKey != null) {
            try {
                String apiKey = EncryptionUtil.decrypt(encryptedKey, encryptionSecret);
                AiProvider provider = createProviderWithKey(name, apiKey, yamlSettings);
                providers.put(name, provider);
                dbKeyProviders.add(name);
                log.info("Reloaded AI provider '{}' with DB key", name);
            } catch (Exception e) {
                log.error("Failed to reload provider '{}' from DB key: {}", name, e.getMessage());
            }
        } else {
            // Fall back to env var key
            dbKeyProviders.remove(name);
            if (yamlSettings.isConfigured()) {
                AiProvider provider = createProvider(name, yamlSettings);
                providers.put(name, provider);
                log.info("Reloaded AI provider '{}' with env key", name);
            } else {
                providers.remove(name);
                log.info("AI provider '{}' removed — no env key and no DB key", name);
            }
        }
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
        String providerName = resolveProviderName(task);
        if (providerName == null || providerName.isBlank()) return false;
        AiProvider provider = providers.get(providerName);
        return provider != null && provider.isAvailable();
    }

    /**
     * Returns names of all configured and available providers.
     */
    public List<String> getAvailableProviders() {
        return new ArrayList<>(providers.keySet());
    }

    /**
     * Returns the key source for a provider: "db", "env", or "none".
     */
    public String getProviderKeySource(String name) {
        if (dbKeyProviders.contains(name)) return "db";
        if (providers.containsKey(name)) return "env";
        return "none";
    }

    /**
     * Returns the effective task→provider map (DB overrides merged over YAML defaults).
     */
    public Map<String, String> getEffectiveTaskAssignments() {
        Map<String, String> effective = new LinkedHashMap<>(config.getTasks());
        Map<String, String> dbOverrides = getDbTaskOverrides();
        effective.putAll(dbOverrides);
        return effective;
    }

    @SuppressWarnings("unchecked")
    private Map<String, String> getDbTaskOverrides() {
        try {
            return tenantRepository.findBySlug("platform")
                    .filter(t -> t.getAiConfig() != null)
                    .map(t -> {
                        Object tasks = t.getAiConfig().get("tasks");
                        if (tasks instanceof Map<?, ?> tasksMap) {
                            Map<String, String> result = new LinkedHashMap<>();
                            tasksMap.forEach((k, v) -> result.put(String.valueOf(k), String.valueOf(v)));
                            return result;
                        }
                        return Collections.<String, String>emptyMap();
                    })
                    .orElse(Collections.emptyMap());
        } catch (Exception e) {
            log.warn("Failed to read AI config from DB, using YAML defaults: {}", e.getMessage());
            return Collections.emptyMap();
        }
    }

    private Map<String, String> getDbEncryptedKeys() {
        try {
            return tenantRepository.findBySlug("platform")
                    .filter(t -> t.getAiConfig() != null)
                    .map(t -> {
                        Object keys = t.getAiConfig().get("keys");
                        if (keys instanceof Map<?, ?> keysMap) {
                            Map<String, String> result = new LinkedHashMap<>();
                            keysMap.forEach((k, v) -> result.put(String.valueOf(k), String.valueOf(v)));
                            return result;
                        }
                        return Collections.<String, String>emptyMap();
                    })
                    .orElse(Collections.emptyMap());
        } catch (Exception e) {
            log.warn("Failed to read AI keys from DB: {}", e.getMessage());
            return Collections.emptyMap();
        }
    }

    private String resolveProviderName(String task) {
        Map<String, String> dbOverrides = getDbTaskOverrides();
        String providerName = dbOverrides.get(task);
        if (providerName == null) {
            providerName = config.getTasks().get(task);
        }
        return providerName;
    }

    private AiProvider resolveProvider(String task) {
        String providerName = resolveProviderName(task);
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
