package com.mxsuite.security;

import java.util.UUID;

public final class TenantContext {

    // VULN-20: InheritableThreadLocal propagates tenant to @Async child threads
    private static final ThreadLocal<UUID> CURRENT_TENANT = new InheritableThreadLocal<>();

    private TenantContext() {}

    public static UUID getCurrentTenantId() {
        return CURRENT_TENANT.get();
    }

    public static void setCurrentTenantId(UUID tenantId) {
        CURRENT_TENANT.set(tenantId);
    }

    public static void clear() {
        CURRENT_TENANT.remove();
    }
}
