package com.mxsuite.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.LinkedHashMap;
import java.util.Map;

@ConfigurationProperties(prefix = "mxsuite.ai")
public class AiProviderConfig {

    private Map<String, ProviderSettings> providers = new LinkedHashMap<>();
    private Map<String, String> tasks = new LinkedHashMap<>();

    public static class ProviderSettings {
        private String apiKey = "";
        private String model = "";
        private String baseUrl = "";

        public String getApiKey() { return apiKey; }
        public void setApiKey(String apiKey) { this.apiKey = apiKey; }
        public String getModel() { return model; }
        public void setModel(String model) { this.model = model; }
        public String getBaseUrl() { return baseUrl; }
        public void setBaseUrl(String baseUrl) { this.baseUrl = baseUrl; }

        public boolean isConfigured() {
            return apiKey != null && !apiKey.isBlank();
        }
    }

    public Map<String, ProviderSettings> getProviders() { return providers; }
    public void setProviders(Map<String, ProviderSettings> providers) { this.providers = providers; }
    public Map<String, String> getTasks() { return tasks; }
    public void setTasks(Map<String, String> tasks) { this.tasks = tasks; }
}
