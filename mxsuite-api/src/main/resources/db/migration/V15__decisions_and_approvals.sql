-- =====================================================
-- V15: Semantic Decisions & Approval Requests
-- =====================================================

-- Semantic decisions (cross-project)
CREATE TABLE semantic_decisions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title           VARCHAR(500) NOT NULL,
    summary         TEXT,
    project_id      UUID REFERENCES projects(id) ON DELETE CASCADE,
    field_context   VARCHAR(500),
    decision_status VARCHAR(20) NOT NULL DEFAULT 'OPEN'
                    CHECK (decision_status IN ('OPEN','APPROVED','REJECTED')),
    owner_id        UUID REFERENCES users(id),
    options         JSONB,
    selected_option INTEGER,
    requirements    JSONB,
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    created_by      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_modified_by UUID,
    last_modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    administrator_id UUID
);

CREATE INDEX idx_decisions_tenant ON semantic_decisions(tenant_id);
CREATE INDEX idx_decisions_project ON semantic_decisions(project_id);
CREATE INDEX idx_decisions_status ON semantic_decisions(decision_status);

-- Approval requests (tied to phase gates)
CREATE TABLE approval_requests (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    phase_gate_id   UUID NOT NULL REFERENCES phase_gates(id) ON DELETE CASCADE,
    title           VARCHAR(500) NOT NULL,
    description     TEXT,
    gate_type       VARCHAR(30) NOT NULL,
    approval_status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                    CHECK (approval_status IN ('PENDING','APPROVED','REJECTED')),
    required_role   VARCHAR(30),
    assigned_to     UUID REFERENCES users(id),
    approved_by     UUID REFERENCES users(id),
    approved_at     TIMESTAMPTZ,
    artifact_ref    VARCHAR(500),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    created_by      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_modified_by UUID,
    last_modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    administrator_id UUID
);

CREATE INDEX idx_approvals_tenant ON approval_requests(tenant_id);
CREATE INDEX idx_approvals_project ON approval_requests(project_id);
CREATE INDEX idx_approvals_status ON approval_requests(approval_status);
CREATE INDEX idx_approvals_gate ON approval_requests(phase_gate_id);
