-- =====================================================
-- V16: Reconciliation Reports
-- =====================================================

CREATE TABLE reconciliation_reports (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    overall_status  VARCHAR(20) NOT NULL CHECK (overall_status IN ('PASS','WARN','FAIL')),
    warning_count   INTEGER DEFAULT 0,
    signed_off      BOOLEAN DEFAULT FALSE,
    signer_name     VARCHAR(255),
    signer_role     VARCHAR(100),
    signed_at       TIMESTAMPTZ,
    tiers           JSONB NOT NULL,
    table_breakdown JSONB,
    warning_detail  TEXT,
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    created_by      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_modified_by UUID,
    last_modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    administrator_id UUID
);

CREATE INDEX idx_recon_project ON reconciliation_reports(project_id);
CREATE INDEX idx_recon_tenant ON reconciliation_reports(tenant_id);
CREATE INDEX idx_recon_status ON reconciliation_reports(overall_status);
