-- =====================================================
-- V22: Mapping Version History & Rollback
-- =====================================================

-- Version snapshots (one per "session" — grouped edits by same user)
CREATE TABLE mapping_versions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    version_number  INTEGER NOT NULL,
    snapshot        JSONB,
    change_count    INTEGER NOT NULL DEFAULT 0,
    label           VARCHAR(200),
    description     TEXT,
    source          VARCHAR(30) NOT NULL DEFAULT 'EDIT'
                    CHECK (source IN ('EDIT','ROLLBACK','IMPORT','AI_MAPPING')),
    created_by      UUID REFERENCES users(id),
    created_by_name VARCHAR(200),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at       TIMESTAMPTZ,
    UNIQUE (project_id, version_number)
);

CREATE INDEX idx_mapping_versions_project ON mapping_versions(project_id);
CREATE INDEX idx_mapping_versions_project_num ON mapping_versions(project_id, version_number DESC);

-- Individual field changes within a version
CREATE TABLE mapping_version_changes (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mapping_version_id  UUID NOT NULL REFERENCES mapping_versions(id) ON DELETE CASCADE,
    field_mapping_id    UUID NOT NULL REFERENCES field_mapping_entries(id) ON DELETE CASCADE,
    change_type         VARCHAR(30) NOT NULL
                        CHECK (change_type IN ('TARGET_CHANGED','STATUS_CHANGED','COMMENT_CHANGED',
                                               'COERCION_CHANGED','SKIPPED','UNSKIPPED','APPROVED','RESTORED')),
    field_name          VARCHAR(50) NOT NULL,
    old_value           TEXT,
    new_value           TEXT,
    source_entity       VARCHAR(200) NOT NULL,
    source_field        VARCHAR(200) NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_version_changes_version ON mapping_version_changes(mapping_version_id);
CREATE INDEX idx_version_changes_mapping ON mapping_version_changes(field_mapping_id);
