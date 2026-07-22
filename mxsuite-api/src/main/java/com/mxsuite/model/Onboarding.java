package com.mxsuite.model;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.mxsuite.model.enums.OnboardingStatus;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.util.List;
import java.util.Map;

@Entity
@Table(name = "onboardings")
@Getter
@Setter
@NoArgsConstructor
public class Onboarding extends BaseEntity {

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "tenant_id", nullable = false)
    private Tenant tenant;

    @Column(name = "tenant_id", insertable = false, updatable = false)
    private java.util.UUID tenantId;

    @Column(nullable = false)
    private String name = "Data Onboarding";

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private OnboardingStatus status = OnboardingStatus.WELCOME;

    @Column(name = "current_step", nullable = false)
    private int currentStep = 0;

    @Column(name = "original_filename")
    private String originalFilename;

    @JsonIgnore
    @Column(name = "storage_path")
    private String storagePath;

    @Column(name = "file_size")
    private Long fileSize;

    @Column(name = "row_count")
    private Integer rowCount;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "source_columns", columnDefinition = "jsonb")
    private List<Map<String, Object>> sourceColumns;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "target_schema", columnDefinition = "jsonb")
    private List<Map<String, Object>> targetSchema;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "mappings", columnDefinition = "jsonb")
    private List<Map<String, Object>> mappings;

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "assigned_to")
    private User assignedTo;

    @Column(name = "assigned_to", insertable = false, updatable = false)
    private java.util.UUID assignedToId;

    private String notes;

    @Column(name = "sheet_name")
    private String sheetName;

    @Transient
    private String lastModifiedByName;
}
