package com.mxsuite.controller;

import com.mxsuite.model.AuditEvent;
import com.mxsuite.repository.AuditEventRepository;
import com.mxsuite.security.TenantContext;
import com.mxsuite.security.UserPrincipal;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/audit")
@Transactional(readOnly = true)
public class AuditController {

    private static final Logger log = LoggerFactory.getLogger(AuditController.class);

    private final AuditEventRepository repository;

    public AuditController(AuditEventRepository repository) {
        this.repository = repository;
    }

    @GetMapping
    public ResponseEntity<Page<AuditEvent>> list(@AuthenticationPrincipal UserPrincipal principal,
                                                   Pageable pageable,
                                                   @RequestParam(required = false) Boolean platformOnly) {
        UUID tenantId = TenantContext.getCurrentTenantId();
        if (tenantId == null) {
            log.warn("Audit query attempted with no tenant context by user {}", principal.email());
            return ResponseEntity.badRequest().build();
        }

        if (Boolean.TRUE.equals(platformOnly)) {
            if (!principal.isPlatformUser()) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
            }
            return ResponseEntity.ok(
                    repository.findByTenantIdAndPlatformActionOrderByTimestampDesc(tenantId, true, pageable));
        }
        return ResponseEntity.ok(
                repository.findByTenantIdOrderByTimestampDesc(tenantId, pageable));
    }

    @GetMapping("/entity/{entityType}/{entityId}")
    public ResponseEntity<?> listByEntity(@AuthenticationPrincipal UserPrincipal principal,
                                           @PathVariable String entityType,
                                           @PathVariable UUID entityId,
                                           Pageable pageable) {
        // Validate entityType to prevent injection
        if (!entityType.matches("^[A-Za-z]+$")) {
            return ResponseEntity.badRequest().body(Map.of(
                    "status", 400,
                    "message", "Invalid entity type"
            ));
        }

        // VULN-05: Enforce tenant isolation at the query level, not in-memory filtering
        if (principal.isPlatformUser()) {
            // Platform users can see all audit events for the entity
            return ResponseEntity.ok(repository.findByEntityTypeAndEntityIdOrderByTimestampDesc(
                    entityType, entityId, pageable));
        }

        UUID tenantId = TenantContext.getCurrentTenantId();
        if (tenantId == null) {
            log.warn("Audit entity query attempted with no tenant context by user {}", principal.email());
            return ResponseEntity.badRequest().build();
        }

        // Non-platform users: filter at the database level by tenant_id
        return ResponseEntity.ok(repository.findByTenantIdAndEntityTypeAndEntityIdOrderByTimestampDesc(
                tenantId, entityType, entityId, pageable));
    }
}
