package com.mxsuite.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "platform_assignments", uniqueConstraints = {
    @UniqueConstraint(columnNames = {"user_id", "tenant_id"})
})
@Getter
@Setter
@NoArgsConstructor
public class PlatformAssignment extends BaseEntity {

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User platformUser;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "tenant_id", nullable = false)
    private Tenant tenant;

    @Column(name = "is_active", nullable = false)
    private boolean active = true;
}
