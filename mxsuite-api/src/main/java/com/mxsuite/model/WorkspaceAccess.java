package com.mxsuite.model;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.mxsuite.model.enums.AccessLevel;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "workspace_access", uniqueConstraints = {
    @UniqueConstraint(columnNames = {"workspace_id", "user_id"})
})
@Getter
@Setter
@NoArgsConstructor
public class WorkspaceAccess extends BaseEntity {

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "workspace_id", nullable = false)
    private Workspace workspace;

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Enumerated(EnumType.STRING)
    @Column(name = "access_level", nullable = false)
    private AccessLevel accessLevel;
}
