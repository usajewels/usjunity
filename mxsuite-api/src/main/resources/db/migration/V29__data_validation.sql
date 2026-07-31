-- =========================================================
-- V29: Data Validation Engine
-- Stores validation run results and per-row/per-field issues
-- found when checking uploaded data against target schema.
-- =========================================================

CREATE TABLE validation_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    upload_id       UUID REFERENCES project_data_uploads(id) ON DELETE SET NULL,
    triggered_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'RUNNING',
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ,
    total_rows      INT NOT NULL DEFAULT 0,
    valid_rows      INT NOT NULL DEFAULT 0,
    warning_rows    INT NOT NULL DEFAULT 0,
    error_rows      INT NOT NULL DEFAULT 0,
    summary_json    JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by      UUID,
    last_modified_at TIMESTAMPTZ,
    last_modified_by UUID,
    administrator_id UUID,
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX idx_validation_runs_project ON validation_runs(project_id);
CREATE INDEX idx_validation_runs_tenant  ON validation_runs(tenant_id);

CREATE TABLE validation_issues (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    validation_run_id   UUID NOT NULL REFERENCES validation_runs(id) ON DELETE CASCADE,
    row_number          INT NOT NULL,
    source_entity       VARCHAR(200),
    target_entity       VARCHAR(200),
    target_field        VARCHAR(200),
    source_column       VARCHAR(200),
    current_value       TEXT,
    severity            VARCHAR(20) NOT NULL,
    rule_code           VARCHAR(30) NOT NULL,
    message             TEXT NOT NULL,
    resolved            BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_value      TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          UUID,
    last_modified_at    TIMESTAMPTZ,
    last_modified_by    UUID,
    administrator_id    UUID
);

CREATE INDEX idx_val_issues_run_severity ON validation_issues(validation_run_id, severity);
CREATE INDEX idx_val_issues_run_row      ON validation_issues(validation_run_id, row_number);
CREATE INDEX idx_val_issues_run_entity   ON validation_issues(validation_run_id, target_entity, target_field);
