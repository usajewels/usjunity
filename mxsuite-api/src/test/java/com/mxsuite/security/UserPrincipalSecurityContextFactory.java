package com.mxsuite.security;

import com.mxsuite.model.enums.UserRole;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.test.context.support.WithSecurityContextFactory;

import java.util.UUID;

/**
 * Creates a Spring Security context containing a {@link UserPrincipal} record,
 * enabling {@code @PreAuthorize} and {@code @AuthenticationPrincipal} to work
 * correctly inside {@code @WebMvcTest} slices.
 */
public class UserPrincipalSecurityContextFactory
        implements WithSecurityContextFactory<WithMockUserPrincipal> {

    @Override
    public SecurityContext createSecurityContext(WithMockUserPrincipal annotation) {
        UserPrincipal principal = new UserPrincipal(
                UUID.fromString(annotation.userId()),
                annotation.email(),
                "Test",
                "User",
                /* password (unused in tests) */ null,
                UserRole.valueOf(annotation.role()),
                UUID.fromString(annotation.tenantId()),
                /* active */ true
        );

        var auth = new UsernamePasswordAuthenticationToken(
                principal, null, principal.getAuthorities());

        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(auth);
        return context;
    }
}
