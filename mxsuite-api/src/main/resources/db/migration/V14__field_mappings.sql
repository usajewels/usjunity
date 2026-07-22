-- =====================================================
-- V14: Field-Level Mappings for Interactive Mapping UI
-- =====================================================

-- Field-level mappings (per project, not buried in plan JSONB)
CREATE TABLE field_mapping_entries (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_entity   VARCHAR(200) NOT NULL,
    source_field    VARCHAR(200) NOT NULL,
    sample_value    TEXT,
    target_entity   VARCHAR(200),
    target_field    VARCHAR(200),
    coercion        VARCHAR(100),
    confidence_pct  NUMERIC(5,2),
    mapping_status  VARCHAR(30) NOT NULL DEFAULT 'NEEDS_REVIEW'
                    CHECK (mapping_status IN ('MAPPED','NEEDS_REVIEW','CFV_PROPOSAL','REJECTED','UNMAPPED')),
    owner_id        UUID REFERENCES users(id),
    customer_comment TEXT,
    created_by      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_modified_by UUID,
    last_modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    administrator_id UUID
);

CREATE INDEX idx_field_mappings_project ON field_mapping_entries(project_id);
CREATE INDEX idx_field_mappings_status ON field_mapping_entries(mapping_status);
CREATE INDEX idx_field_mappings_entity ON field_mapping_entries(project_id, source_entity);

-- Candidate target fields per mapping (AI alternatives)
CREATE TABLE mapping_candidates (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    field_mapping_id  UUID NOT NULL REFERENCES field_mapping_entries(id) ON DELETE CASCADE,
    target_field      VARCHAR(200) NOT NULL,
    match_pct         NUMERIC(5,2),
    description       TEXT,
    sort_order        INTEGER DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mapping_candidates_fk ON mapping_candidates(field_mapping_id);

-- Source schema tree (hierarchical entity/field structure)
CREATE TABLE source_schema_nodes (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    parent_id       UUID REFERENCES source_schema_nodes(id),
    node_name       VARCHAR(200) NOT NULL,
    node_type       VARCHAR(50) NOT NULL DEFAULT 'ENTITY'
                    CHECK (node_type IN ('ENTITY','FIELD')),
    record_count    INTEGER,
    sort_order      INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_schema_nodes_project ON source_schema_nodes(project_id);
CREATE INDEX idx_schema_nodes_parent ON source_schema_nodes(parent_id);
