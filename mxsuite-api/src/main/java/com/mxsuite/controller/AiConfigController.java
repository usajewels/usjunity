package com.mxsuite.controller;

import com.mxsuite.config.AiProviderConfig;
import com.mxsuite.repository.TenantRepository;
import com.mxsuite.service.ai.AiProviderService;
import com.mxsuite.util.EncryptionUtil;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api/admin/ai")
@PreAuthorize("hasAnyRole('PLATFORM_ADMIN', 'PLATFORM_SUPPORT')")
public class AiConfigController {

    private static final Logger log = LoggerFactory.getLogger(AiConfigController.class);

    private final AiProviderConfig config;
    private final AiProviderService aiProviderService;
    private final TenantRepository tenantRepository;
    private final String encryptionSecret;

    public AiConfigController(AiProviderConfig config, AiProviderService aiProviderService,
                              TenantRepository tenantRepository,
                              @Value("${mxsuite.security.jwt.secret:}") String encryptionSecret) {
        this.config = config;
        this.aiProviderService = aiProviderService;
        this.tenantRepository = tenantRepository;
        this.encryptionSecret = encryptionSecret;
    }

    public record ProviderInfo(String name, String model, boolean available, String keySource) {}

    public record AiStatusResponse(
            List<ProviderInfo> providers,
            Map<String, String> taskAssignments,
            Map<String, String> yamlDefaults) {}

    public record SetKeyRequest(@NotBlank String provider, @NotBlank String apiKey) {}

    @GetMapping("/status")
    public AiStatusResponse getStatus() {
        List<ProviderInfo> providerInfos = new ArrayList<>();
        for (var entry : config.getProviders().entrySet()) {
            String name = entry.getKey();
            var settings = entry.getValue();
            String keySource = aiProviderService.getProviderKeySource(name);
            boolean available = !"none".equals(keySource);
            providerInfos.add(new ProviderInfo(name, settings.getModel(), available, keySource));
        }

        Map<String, String> effective = aiProviderService.getEffectiveTaskAssignments();
        Map<String, String> defaults = new LinkedHashMap<>(config.getTasks());

        return new AiStatusResponse(providerInfos, effective, defaults);
    }

    @PutMapping("/keys")
    @PreAuthorize("hasRole('PLATFORM_ADMIN')")
    @Transactional
    public ResponseEntity<Map<String, Object>> setKey(@Valid @RequestBody SetKeyRequest request) {
        String providerName = request.provider().toLowerCase();
        if (!config.getProviders().containsKey(providerName)) {
            return ResponseEntity.badRequest().body(Map.of("message", "Unknown provider: " + providerName));
        }

        var tenant = tenantRepository.findBySlug("platform").orElse(null);
        if (tenant == null) {
            return ResponseEntity.internalServerError().body(Map.of("message", "Platform tenant not found"));
        }

        String encrypted = EncryptionUtil.encrypt(request.apiKey(), encryptionSecret);

        Map<String, Object> aiConfig = tenant.getAiConfig() != null
                ? new LinkedHashMap<>(tenant.getAiConfig())
                : new LinkedHashMap<>();

        @SuppressWarnings("unchecked")
        Map<String, String> keys = aiConfig.containsKey("keys")
                ? new LinkedHashMap<>((Map<String, String>) aiConfig.get("keys"))
                : new LinkedHashMap<>();

        keys.put(providerName, encrypted);
        aiConfig.put("keys", keys);
        tenant.setAiConfig(aiConfig);
        tenantRepository.save(tenant);

        aiProviderService.reloadProvider(providerName);
        log.info("API key set for provider '{}' via admin UI", providerName);

        return ResponseEntity.ok(Map.of(
                "provider", providerName,
                "keySource", "db"
        ));
    }

    @DeleteMapping("/keys/{provider}")
    @PreAuthorize("hasRole('PLATFORM_ADMIN')")
    @Transactional
    public ResponseEntity<Map<String, Object>> removeKey(@PathVariable String provider) {
        String providerName = provider.toLowerCase();

        var tenant = tenantRepository.findBySlug("platform").orElse(null);
        if (tenant == null || tenant.getAiConfig() == null) {
            return ResponseEntity.ok(Map.of("provider", providerName, "keySource", "none"));
        }

        Map<String, Object> aiConfig = new LinkedHashMap<>(tenant.getAiConfig());
        if (aiConfig.containsKey("keys")) {
            @SuppressWarnings("unchecked")
            Map<String, String> keys = new LinkedHashMap<>((Map<String, String>) aiConfig.get("keys"));
            keys.remove(providerName);
            aiConfig.put("keys", keys);
            tenant.setAiConfig(aiConfig);
            tenantRepository.save(tenant);
        }

        aiProviderService.reloadProvider(providerName);
        String newSource = aiProviderService.getProviderKeySource(providerName);
        log.info("DB key removed for provider '{}', reverted to source: {}", providerName, newSource);

        return ResponseEntity.ok(Map.of(
                "provider", providerName,
                "keySource", newSource
        ));
    }
}
