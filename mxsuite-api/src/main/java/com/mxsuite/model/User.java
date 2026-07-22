package com.mxsuite.model;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.mxsuite.model.enums.UserRole;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.Map;

@Entity
@Table(name = "users", uniqueConstraints = {
    @UniqueConstraint(columnNames = {"email"})
})
@Getter
@Setter
@NoArgsConstructor
public class User extends BaseEntity {

    @Column(nullable = false)
    private String email;

    @JsonIgnore
    @Column(name = "password_hash")
    private String passwordHash;

    @Column(name = "first_name", nullable = false)
    private String firstName;

    @Column(name = "last_name", nullable = false)
    private String lastName;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private UserRole role;

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "tenant_id", nullable = false)
    private Tenant tenant;

    @Column(name = "is_active", nullable = false)
    private boolean active = true;

    @Column(name = "avatar_url")
    private String avatarUrl;

    @Column(length = 100)
    private String title;

    @Column(length = 500)
    private String bio;

    @Column(name = "last_login_at")
    private Instant lastLoginAt;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "preferences", columnDefinition = "jsonb")
    private Map<String, Object> preferences;

    public String getFullName() {
        return firstName + " " + lastName;
    }

    public boolean isPlatformUser() {
        return role == UserRole.PLATFORM_ADMIN || role == UserRole.PLATFORM_SUPPORT;
    }
}
