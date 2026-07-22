package com.mxsuite.model;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "project_assets")
@Getter
@Setter
@NoArgsConstructor
public class ProjectAsset extends BaseEntity {

    @Column(nullable = false)
    private String filename;

    @Column(name = "content_type")
    private String contentType;

    @Column(name = "file_size")
    private Long fileSize;

    @JsonIgnore
    @Column(name = "storage_path", nullable = false)
    private String storagePath;

    @Column(name = "asset_type")
    private String assetType;

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "project_id", nullable = false)
    private Project project;

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "uploaded_by")
    private User uploadedBy;
}
