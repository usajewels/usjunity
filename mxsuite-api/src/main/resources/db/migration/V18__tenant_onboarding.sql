-- Link each tenant to its single onboarding project
ALTER TABLE tenants
    ADD COLUMN onboarding_project_id UUID REFERENCES projects(id);

CREATE UNIQUE INDEX idx_tenant_onboarding_project ON tenants(onboarding_project_id);

-- Track uploaded data files per project (parsed CSV/Excel metadata)
CREATE TABLE project_data_uploads (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    original_filename VARCHAR(500),
    sheet_name       VARCHAR(200),
    row_count        INTEGER,
    source_columns   JSONB,
    upload_status    VARCHAR(30) NOT NULL DEFAULT 'PENDING'
        CHECK (upload_status IN ('PENDING','PARSED','PROCESSING','COMPLETED','FAILED')),
    created_by       UUID,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_modified_by UUID,
    last_modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    administrator_id UUID
);

CREATE INDEX idx_project_data_uploads_project ON project_data_uploads(project_id);
