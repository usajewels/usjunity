package com.mxsuite.controller;

import com.mxsuite.audit.AuditService;
import com.mxsuite.model.Tenant;
import com.mxsuite.model.User;
import com.mxsuite.model.Workspace;
import com.mxsuite.repository.TenantRepository;
import com.mxsuite.repository.UserRepository;
import com.mxsuite.repository.WorkspaceRepository;
import com.mxsuite.security.JwtTokenProvider;
import com.mxsuite.security.UserPrincipal;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private static final Logger log = LoggerFactory.getLogger(AuthController.class);
    private static final int MAX_FAILED_ATTEMPTS = 5;
    private static final Duration LOCKOUT_DURATION = Duration.ofMinutes(15);
    private static final String LOCKOUT_KEY_PREFIX = "auth:lockout:";

    @SuppressWarnings("unchecked")
    private static final Map<String, List<String>> DEFAULT_FEATURE_CONFIG = Map.ofEntries(
            Map.entry("PLATFORM_ADMIN", List.of("projects", "workspaces", "migration")),
            Map.entry("COACH_ADMIN", List.of("projects", "workspaces", "migration")),
            Map.entry("PLATFORM_SUPPORT", List.of("projects", "workspaces", "migration")),
            Map.entry("TENANT_ADMIN", List.of("my-onboarding")),
            Map.entry("TENANT_USER", List.of("my-onboarding"))
    );

    private final UserRepository userRepository;
    private final TenantRepository tenantRepository;
    private final WorkspaceRepository workspaceRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtTokenProvider tokenProvider;
    private final AuditService auditService;
    private final StringRedisTemplate redisTemplate;
    private final Environment environment;

    public AuthController(UserRepository userRepository, TenantRepository tenantRepository,
                          WorkspaceRepository workspaceRepository,
                          PasswordEncoder passwordEncoder, JwtTokenProvider tokenProvider,
                          AuditService auditService, StringRedisTemplate redisTemplate,
                          Environment environment) {
        this.userRepository = userRepository;
        this.tenantRepository = tenantRepository;
        this.workspaceRepository = workspaceRepository;
        this.passwordEncoder = passwordEncoder;
        this.tokenProvider = tokenProvider;
        this.auditService = auditService;
        this.redisTemplate = redisTemplate;
        this.environment = environment;
    }

    public record LoginRequest(
            @NotBlank @Email @Size(max = 255) String email,
            @NotBlank @Size(min = 8, max = 128) String password) {}

    public record PlatformBrandingDto(String brandName, String logoUrl) {}

    public record AuthResponse(String token, UserDto user, TenantDto tenant,
                                PlatformBrandingDto platformBranding,
                                Map<String, List<String>> featureConfig,
                                boolean devLogin) {}

    public record UserDto(String id, String email, String firstName, String lastName,
                          String role, String tenantId, String avatarUrl,
                          String title, String bio) {}

    public record TenantDto(String id, String name, String slug, String tenantType,
                            String brandName, String logoUrl,
                            Map<String, Object> themeConfig) {}

    @GetMapping("/platform/branding")
    @Transactional(readOnly = true)
    public ResponseEntity<PlatformBrandingDto> getPlatformBranding() {
        return ResponseEntity.ok(loadPlatformBranding());
    }

    @GetMapping("/platform/features")
    @Transactional(readOnly = true)
    public ResponseEntity<Map<String, List<String>>> getPlatformFeatures() {
        return ResponseEntity.ok(loadFeatureConfig());
    }

    @PostMapping("/login")
    @Transactional
    public ResponseEntity<?> login(@Valid @RequestBody LoginRequest request,
                                    HttpServletRequest httpRequest) {
        String clientIp = getClientIp(httpRequest);
        String email = request.email().toLowerCase().trim();
        String lockoutKey = LOCKOUT_KEY_PREFIX + email;

        // VULN-19: Check account lockout
        String attempts = redisTemplate.opsForValue().get(lockoutKey);
        if (attempts != null && Integer.parseInt(attempts) >= MAX_FAILED_ATTEMPTS) {
            log.warn("Locked out account login attempt: email={} from IP={}", email, clientIp);
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(Map.of(
                "status", 429,
                "message", "Account temporarily locked due to too many failed attempts. Try again in 15 minutes."
            ));
        }

        User user = userRepository.findByEmail(email).orElse(null);

        if (user == null || !user.isActive() || user.getPasswordHash() == null
                || !passwordEncoder.matches(request.password(), user.getPasswordHash())) {
            log.warn("Failed login attempt for email={} from IP={}", email, clientIp);
            auditService.logWithoutPrincipal("LOGIN_FAILED", "User",
                    "email=" + email, clientIp);

            // VULN-19: Increment failed attempts counter
            redisTemplate.opsForValue().increment(lockoutKey);
            redisTemplate.expire(lockoutKey, LOCKOUT_DURATION);

            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of(
                "status", 401,
                "message", "Invalid email or password"
            ));
        }

        if (!user.getTenant().isActive()) {
            log.warn("Login attempt for user {} in inactive tenant {}", user.getEmail(), user.getTenant().getSlug());
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of(
                "status", 403,
                "message", "Your organization account is currently inactive"
            ));
        }

        // VULN-19: Clear failed attempts on successful login
        redisTemplate.delete(lockoutKey);

        UserPrincipal principal = new UserPrincipal(
            user.getId(), user.getEmail(), user.getFirstName(), user.getLastName(),
            user.getPasswordHash(), user.getRole(), user.getTenant().getId(), user.isActive()
        );

        // Record last login time
        user.setLastLoginAt(Instant.now());
        userRepository.save(user);

        String token = tokenProvider.generateToken(principal);
        Tenant tenant = user.getTenant();

        // Auto-create default workspace if user has none
        if (workspaceRepository.countByOwnerId(user.getId()) == 0) {
            Workspace ws = new Workspace();
            ws.setName(user.getFirstName() + "'s Workspace");
            ws.setDescription("Default workspace");
            ws.setOwner(user);
            ws.setTenant(tenant);
            workspaceRepository.save(ws);
            log.info("Auto-created default workspace for user={}", user.getEmail());
        }

        log.info("Successful login: user={} tenant={} from IP={}", user.getEmail(), tenant.getSlug(), clientIp);

        return ResponseEntity.ok(new AuthResponse(
            token,
            new UserDto(user.getId().toString(), user.getEmail(), user.getFirstName(),
                        user.getLastName(), user.getRole().name(), tenant.getId().toString(),
                        user.getAvatarUrl(), user.getTitle(), user.getBio()),
            new TenantDto(tenant.getId().toString(), tenant.getName(), tenant.getSlug(),
                          tenant.getTenantType().name(), tenant.getBrandName(), tenant.getLogoUrl(),
                          tenant.getThemeConfig()),
            loadPlatformBranding(),
            loadFeatureConfig(),
            isDevLoginEnabled()
        ));
    }

    // ========== Dev-only: passwordless login ==========

    public record DevUserDto(String id, String email, String firstName, String lastName,
                             String role, String tenantName) {}

    @GetMapping("/dev/users")
    @Transactional(readOnly = true)
    public ResponseEntity<?> listDevUsers() {
        if (!isDevLoginEnabled()) {
            return ResponseEntity.notFound().build();
        }
        List<DevUserDto> users = userRepository.findAll().stream()
                .filter(User::isActive)
                .map(u -> new DevUserDto(
                        u.getId().toString(), u.getEmail(),
                        u.getFirstName(), u.getLastName(),
                        u.getRole().name(),
                        u.getTenant() != null ? u.getTenant().getName() : null))
                .toList();
        return ResponseEntity.ok(users);
    }

    @PostMapping("/dev/login")
    @Transactional
    public ResponseEntity<?> devLogin(@RequestBody Map<String, String> body) {
        if (!isDevLoginEnabled()) {
            return ResponseEntity.notFound().build();
        }
        String email = body.get("email");
        if (email == null || email.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("message", "email is required"));
        }

        User user = userRepository.findByEmail(email.toLowerCase().trim()).orElse(null);
        if (user == null || !user.isActive()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("message", "User not found"));
        }

        UserPrincipal principal = new UserPrincipal(
            user.getId(), user.getEmail(), user.getFirstName(), user.getLastName(),
            user.getPasswordHash(), user.getRole(), user.getTenant().getId(), user.isActive()
        );

        user.setLastLoginAt(Instant.now());
        userRepository.save(user);

        String token = tokenProvider.generateToken(principal);
        Tenant tenant = user.getTenant();

        // Auto-create default workspace if user has none
        if (workspaceRepository.countByOwnerId(user.getId()) == 0) {
            Workspace ws = new Workspace();
            ws.setName(user.getFirstName() + "'s Workspace");
            ws.setDescription("Default workspace");
            ws.setOwner(user);
            ws.setTenant(tenant);
            workspaceRepository.save(ws);
        }

        log.info("Dev login (no password): user={}", user.getEmail());

        return ResponseEntity.ok(new AuthResponse(
            token,
            new UserDto(user.getId().toString(), user.getEmail(), user.getFirstName(),
                        user.getLastName(), user.getRole().name(), tenant.getId().toString(),
                        user.getAvatarUrl(), user.getTitle(), user.getBio()),
            new TenantDto(tenant.getId().toString(), tenant.getName(), tenant.getSlug(),
                          tenant.getTenantType().name(), tenant.getBrandName(), tenant.getLogoUrl(),
                          tenant.getThemeConfig()),
            loadPlatformBranding(),
            loadFeatureConfig(),
            isDevLoginEnabled()
        ));
    }

    private boolean isDevLoginEnabled() {
        for (String profile : environment.getActiveProfiles()) {
            if ("devlogin".equals(profile)) {
                return true;
            }
        }
        return false;
    }

    private PlatformBrandingDto loadPlatformBranding() {
        return tenantRepository.findBySlug("platform")
                .map(pt -> new PlatformBrandingDto(pt.getBrandName(), pt.getLogoUrl()))
                .orElse(new PlatformBrandingDto("GrowthZone MemberSuite", null));
    }

    @SuppressWarnings("unchecked")
    private Map<String, List<String>> loadFeatureConfig() {
        return tenantRepository.findBySlug("platform")
                .map(pt -> {
                    Map<String, Object> raw = pt.getFeatureConfig();
                    if (raw == null || raw.isEmpty()) return DEFAULT_FEATURE_CONFIG;
                    // Convert Map<String, Object> → Map<String, List<String>>
                    return raw.entrySet().stream().collect(Collectors.toMap(
                            Map.Entry::getKey,
                            e -> e.getValue() instanceof List<?> list
                                    ? list.stream().map(Object::toString).collect(Collectors.toList())
                                    : List.<String>of()
                    ));
                })
                .orElse(DEFAULT_FEATURE_CONFIG);
    }

    private String getClientIp(HttpServletRequest request) {
        String xff = request.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) {
            return xff.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }
}
