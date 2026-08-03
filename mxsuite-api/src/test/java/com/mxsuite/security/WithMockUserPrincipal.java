package com.mxsuite.security;

import org.springframework.security.test.context.support.WithSecurityContext;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Test annotation that populates the Spring Security context with a {@link UserPrincipal}
 * for use in {@code @WebMvcTest} slices.
 *
 * <p>Usage:
 * <pre>{@code
 * @WithMockUserPrincipal(role = "COACH_ADMIN")
 * @Test void someTest() { ... }
 * }</pre>
 *
 * <p>The {@code tenantId} defaults to the platform tenant UUID from seed data.
 * Override it when testing tenant-scoped operations (e.g. member-approve).
 */
@Target({ ElementType.METHOD, ElementType.TYPE })
@Retention(RetentionPolicy.RUNTIME)
@WithSecurityContext(factory = UserPrincipalSecurityContextFactory.class)
public @interface WithMockUserPrincipal {

    /** Email address placed in the principal. */
    String email() default "test@mxsuite.com";

    /**
     * Role name — must match a {@link com.mxsuite.model.enums.UserRole} constant.
     * E.g. {@code "PLATFORM_ADMIN"}, {@code "COACH_ADMIN"}, {@code "TENANT_ADMIN"}.
     */
    String role() default "PLATFORM_ADMIN";

    /** UUID of the tenant this principal belongs to. */
    String tenantId() default "00000000-0000-0000-0000-000000000001";

    /** UUID of the user. */
    String userId() default "00000000-0000-0000-0000-000000000010";
}
