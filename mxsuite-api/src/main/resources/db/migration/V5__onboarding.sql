-- =====================================================
-- V5: Data Onboarding table
-- One onboarding session per tenant for guided data import
-- =====================================================

CREATE TABLE onboardings (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    name            VARCHAR(255) NOT NULL DEFAULT 'Data Onboarding',
    status          VARCHAR(30) NOT NULL DEFAULT 'WELCOME'
                    CHECK (status IN ('WELCOME','UPLOAD','MAPPING','REVIEW','SUBMITTED','COMPLETED')),
    current_step    INT NOT NULL DEFAULT 0,

    -- Uploaded CSV
    original_filename VARCHAR(500),
    storage_path    VARCHAR(1000),
    file_size       BIGINT,
    row_count       INT,

    -- Parsed from CSV headers + sample values
    source_columns  JSONB,

    -- GrowthZone target schema
    target_schema   JSONB,

    -- Column mappings (FieldMapping shape)
    mappings        JSONB,

    -- GrowthZone user assigned to help this tenant
    assigned_to     UUID REFERENCES users(id),
    notes           TEXT,

    -- Audit fields (BaseEntity pattern)
    created_by      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_modified_by UUID,
    last_modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    administrator_id UUID
);

CREATE UNIQUE INDEX idx_onboarding_tenant ON onboardings(tenant_id);
CREATE INDEX idx_onboarding_status ON onboardings(status);
