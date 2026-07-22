-- =====================================================
-- V13: Migration Lifecycle Extensions
-- =====================================================

-- Extend projects with migration lifecycle fields
ALTER TABLE projects
    ADD COLUMN source_system     VARCHAR(100),
    ADD COLUMN target_system     VARCHAR(100),
    ADD COLUMN migration_phase   VARCHAR(30) CHECK (migration_phase IN (
        'DISCOVER','MAP','GENERATE','DRY_RUN','MIGRATE','CUT_OVER')),
    ADD COLUMN migration_status  VARCHAR(30) DEFAULT 'ACTIVE' CHECK (migration_status IN (
        'ACTIVE','PAUSED','COMPLETED','CANCELLED')),
    ADD COLUMN reconciliation_pct NUMERIC(5,2) DEFAULT 0.00;

CREATE INDEX idx_projects_migration_phase ON projects(migration_phase);
CREATE INDEX idx_projects_migration_status ON projects(migration_status);

-- Phase gates: one per phase per project
CREATE TABLE phase_gates (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    phase           VARCHAR(30) NOT NULL,
    gate_status     VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                    CHECK (gate_status IN ('PENDING','CLEARED','BLOCKED','SKIPPED')),
    required_role   VARCHAR(30),
    cleared_by      UUID REFERENCES users(id),
    cleared_at      TIMESTAMPTZ,
    blocked_reason  TEXT,
    created_by      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_modified_by UUID,
    last_modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    administrator_id UUID,
    UNIQUE(project_id, phase)
);

CREATE INDEX idx_phase_gates_project ON phase_gates(project_id);
CREATE INDEX idx_phase_gates_status ON phase_gates(gate_status);

-- Reusable migration blueprints
CREATE TABLE migration_blueprints (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    source_system   VARCHAR(100) NOT NULL,
    target_system   VARCHAR(100) NOT NULL,
    is_proven       BOOLEAN NOT NULL DEFAULT FALSE,
    definition      JSONB,
    tenant_id       UUID REFERENCES tenants(id),
    created_by      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_modified_by UUID,
    last_modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    administrator_id UUID
);

CREATE INDEX idx_blueprints_systems ON migration_blueprints(source_system, target_system);
