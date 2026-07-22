package com.mxsuite.audit;

import com.mxsuite.model.AuditEvent;
import com.mxsuite.repository.AuditEventRepository;
import com.mxsuite.security.TenantContext;
import com.mxsuite.security.UserPrincipal;
import io.micrometer.tracing.Tracer;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

@Service
public class AuditService {

    private static final Logger log = LoggerFactory.getLogger(AuditService.class);

    private final AuditEventRepository repository;
    private final Tracer tracer;

    public AuditService(AuditEventRepository repository, Tracer tracer) {
        this.repository = repository;
        this.tracer = tracer;
    }

    public void log(String action, String entityType, UUID entityId, String entityName,
                    Map<String, Object> beforeState, Map<String, Object> afterState) {
        try {
            UserPrincipal principal = getCurrentPrincipal();
            if (principal == null) {
                log.warn("Audit event skipped — no authenticated principal for action={} entity={}/{}",
                        action, entityType, entityId);
                return;
            }

            AuditEvent event = new AuditEvent();
            event.setTenantId(TenantContext.getCurrentTenantId());
            event.setActorId(principal.id());
            event.setActorName(principal.getFullName());
            event.setActorRole(principal.role().name());
            event.setPlatformAction(principal.isPlatformUser());
            event.setAction(action);
            event.setEntityType(entityType);
            event.setEntityId(entityId);
            event.setEntityName(entityName);
            event.setBeforeState(beforeState);
            event.setAfterState(afterState);
            event.setTimestamp(Instant.now());
            event.setIpAddress(getClientIpAddress());

            if (tracer.currentSpan() != null) {
                event.setTraceId(tracer.currentSpan().context().traceId());
            }

            repository.save(event);
            log.debug("Audit: action={} entity={}/{} actor={}", action, entityType, entityId, principal.email());
        } catch (Exception e) {
            log.error("Failed to persist audit event: action={} entity={}/{} — {}",
                    action, entityType, entityId, e.getMessage(), e);
        }
    }

    public void log(String action, String entityType, UUID entityId, String entityName) {
        log(action, entityType, entityId, entityName, null, null);
    }

    public void logWithoutPrincipal(String action, String entityType, String detail,
                                     String ipAddress) {
        try {
            AuditEvent event = new AuditEvent();
            event.setTenantId(null);
            event.setActorId(new UUID(0, 0));
            event.setActorName("anonymous");
            event.setActorRole("NONE");
            event.setPlatformAction(false);
            event.setAction(action);
            event.setEntityType(entityType);
            event.setEntityId(new UUID(0, 0));
            event.setEntityName(detail);
            event.setTimestamp(Instant.now());
            event.setIpAddress(ipAddress);

            if (tracer.currentSpan() != null) {
                event.setTraceId(tracer.currentSpan().context().traceId());
            }

            repository.save(event);
            log.debug("Audit (no-principal): action={} detail={}", action, detail);
        } catch (Exception e) {
            log.error("Failed to persist anonymous audit event: action={} — {}", action, e.getMessage(), e);
        }
    }

    private UserPrincipal getCurrentPrincipal() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof UserPrincipal principal) {
            return principal;
        }
        return null;
    }

    private String getClientIpAddress() {
        try {
            ServletRequestAttributes attrs =
                    (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
            if (attrs == null) return null;
            HttpServletRequest request = attrs.getRequest();

            String xff = request.getHeader("X-Forwarded-For");
            if (xff != null && !xff.isBlank()) {
                return xff.split(",")[0].trim();
            }
            return request.getRemoteAddr();
        } catch (Exception e) {
            log.debug("Could not determine client IP: {}", e.getMessage());
            return null;
        }
    }
}
