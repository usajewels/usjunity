package com.mxsuite.security;

import com.mxsuite.model.enums.UserRole;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

public record UserPrincipal(
    UUID id,
    String email,
    String firstName,
    String lastName,
    String password,
    UserRole role,
    UUID tenantId,
    boolean active
) implements UserDetails {

    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() {
        return List.of(new SimpleGrantedAuthority("ROLE_" + role.name()));
    }

    @Override
    public String getPassword() {
        return password;
    }

    @Override
    public String getUsername() {
        return email;
    }

    @Override
    public boolean isAccountNonExpired() {
        return active;
    }

    @Override
    public boolean isAccountNonLocked() {
        return active;
    }

    @Override
    public boolean isCredentialsNonExpired() {
        return active;
    }

    @Override
    public boolean isEnabled() {
        return active;
    }

    public boolean isPlatformUser() {
        return role == UserRole.PLATFORM_ADMIN || role == UserRole.COACH_ADMIN || role == UserRole.PLATFORM_SUPPORT;
    }

    public boolean isPlatformAdmin() {
        return role == UserRole.PLATFORM_ADMIN;
    }

    public boolean isCoachAdmin() {
        return role == UserRole.COACH_ADMIN;
    }

    public boolean isPlatformSupport() {
        return role == UserRole.PLATFORM_SUPPORT;
    }

    public String getFullName() {
        return firstName + " " + lastName;
    }
}
