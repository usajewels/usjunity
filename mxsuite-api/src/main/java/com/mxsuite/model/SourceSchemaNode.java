package com.mxsuite.model;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "source_schema_nodes")
@Getter
@Setter
@NoArgsConstructor
public class SourceSchemaNode {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "project_id", nullable = false)
    private Project project;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "parent_id")
    private SourceSchemaNode parent;

    @Column(name = "node_name", nullable = false, length = 200)
    private String nodeName;

    @Column(name = "node_type", nullable = false, length = 50)
    private String nodeType = "ENTITY";

    @Column(name = "record_count")
    private Integer recordCount;

    @Column(name = "sort_order")
    private Integer sortOrder = 0;

    @Column(name = "created_at", updatable = false)
    private Instant createdAt = Instant.now();

    @OneToMany(mappedBy = "parent", cascade = CascadeType.ALL)
    @OrderBy("sortOrder ASC")
    private List<SourceSchemaNode> children = new ArrayList<>();
}
