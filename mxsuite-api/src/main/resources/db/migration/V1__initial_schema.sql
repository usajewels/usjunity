-- =====================================================
-- MXSuite Platform - Initial Schema
-- =====================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- TENANTS
-- =====================================================
CREATE TABLE tenants (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255) NOT NULL,
    slug            VARCHAR(100) NOT NULL UNIQUE,
    tenant_type     VARCHAR(20) NOT NULL CHECK (tenant_type IN ('PLATFORM', 'CUSTOMER')),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_by      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_modified_by UUID,
    last_modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    administrator_id UUID
);

CREATE INDEX idx_tenants_slug ON tenants(slug);

-- =====================================================
-- USERS
-- =====================================================
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email           VARCHAR(255) NOT NULL UNIQUE,
    password_hash   VARCHAR(255),
    first_name      VARCHAR(100) NOT NULL,
    last_name       VARCHAR(100) NOT NULL,
    role            VARCHAR(30) NOT NULL CHECK (role IN ('PLATFORM_ADMIN', 'PLATFORM_SUPPORT', 'TENANT_ADMIN', 'TENANT_USER')),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    avatar_url      VARCHAR(500),
    created_by      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_modified_by UUID,
    last_modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    administrator_id UUID
);

CREATE INDEX idx_users_tenant ON users(tenant_id);

-- =====================================================
-- PLATFORM ASSIGNMENTS
-- =====================================================
CREATE TABLE platform_assignments (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_by      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_modified_by UUID,
    last_modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    administrator_id UUID,
    UNIQUE(user_id, tenant_id)
);

-- =====================================================
-- PROJECTS
-- =====================================================
CREATE TABLE projects (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    owner_id        UUID NOT NULL REFERENCES users(id),
    created_by      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_modified_by UUID,
    last_modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    administrator_id UUID
);

CREATE INDEX idx_projects_tenant ON projects(tenant_id);

-- =====================================================
-- PROJECT ACCESS
-- =====================================================
CREATE TABLE project_access (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id),
    access_level    VARCHAR(20) NOT NULL CHECK (access_level IN ('VIEWER', 'EDITOR', 'ADMIN')),
    created_by      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_modified_by UUID,
    last_modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    administrator_id UUID,
    UNIQUE(project_id, user_id)
);

-- =====================================================
-- PROJECT ASSETS
-- =====================================================
CREATE TABLE project_assets (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    filename        VARCHAR(500) NOT NULL,
    content_type    VARCHAR(255),
    file_size       BIGINT,
    storage_path    VARCHAR(1000) NOT NULL,
    asset_type      VARCHAR(50),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    uploaded_by     UUID REFERENCES users(id),
    created_by      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_modified_by UUID,
    last_modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    administrator_id UUID
);

CREATE INDEX idx_project_assets_project ON project_assets(project_id);

-- =====================================================
-- WORKSPACES
-- =====================================================
CREATE TABLE workspaces (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    owner_id        UUID NOT NULL REFERENCES users(id),
    tenant_id       UUID REFERENCES tenants(id),
    is_cross_tenant BOOLEAN NOT NULL DEFAULT FALSE,
    created_by      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_modified_by UUID,
    last_modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    administrator_id UUID
);

CREATE INDEX idx_workspaces_owner ON workspaces(owner_id);
CREATE INDEX idx_workspaces_tenant ON workspaces(tenant_id);

-- =====================================================
-- WORKSPACE ACCESS
-- =====================================================
CREATE TABLE workspace_access (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id),
    access_level    VARCHAR(20) NOT NULL CHECK (access_level IN ('VIEWER', 'EDITOR', 'ADMIN')),
    created_by      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_modified_by UUID,
    last_modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    administrator_id UUID,
    UNIQUE(workspace_id, user_id)
);

-- =====================================================
-- WORKSPACE <-> PROJECT
-- =====================================================
CREATE TABLE workspace_projects (
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    PRIMARY KEY (workspace_id, project_id)
);

-- =====================================================
-- PLANS
-- =====================================================
CREATE TABLE plans (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    status          VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
    version         INTEGER NOT NULL DEFAULT 1,
    definition      JSONB,
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_asset_id UUID REFERENCES project_assets(id),
    created_by      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_modified_by UUID,
    last_modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    administrator_id UUID
);

CREATE INDEX idx_plans_project ON plans(project_id);
CREATE INDEX idx_plans_status ON plans(status);

-- =====================================================
-- PLAN RUNS
-- =====================================================
CREATE TABLE plan_runs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_id         UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    run_type        VARCHAR(20) NOT NULL CHECK (run_type IN ('DRY_RUN', 'FULL_RUN')),
    status          VARCHAR(20) NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED')),
    triggered_by    UUID REFERENCES users(id),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    records_processed BIGINT,
    records_succeeded BIGINT,
    records_failed  BIGINT,
    result_summary  JSONB,
    errors          JSONB,
    plan_version    INTEGER,
    created_by      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_modified_by UUID,
    last_modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    administrator_id UUID
);

CREATE INDEX idx_plan_runs_plan ON plan_runs(plan_id);
CREATE INDEX idx_plan_runs_status ON plan_runs(status);

-- =====================================================
-- AUDIT EVENTS (append-only)
-- =====================================================
CREATE TABLE audit_events (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID REFERENCES tenants(id),
    actor_id            UUID NOT NULL,
    actor_name          VARCHAR(255) NOT NULL,
    actor_role          VARCHAR(30) NOT NULL,
    is_platform_action  BOOLEAN NOT NULL DEFAULT FALSE,
    action              VARCHAR(100) NOT NULL,
    entity_type         VARCHAR(100) NOT NULL,
    entity_id           UUID NOT NULL,
    entity_name         VARCHAR(255),
    before_state        JSONB,
    after_state         JSONB,
    metadata            JSONB,
    timestamp           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip_address          VARCHAR(45),
    trace_id            VARCHAR(64)
);

CREATE INDEX idx_audit_tenant ON audit_events(tenant_id);
CREATE INDEX idx_audit_entity ON audit_events(entity_type, entity_id);
CREATE INDEX idx_audit_timestamp ON audit_events(timestamp);
CREATE INDEX idx_audit_actor ON audit_events(actor_id);

-- =====================================================
-- SEED: Platform Tenant
-- =====================================================
INSERT INTO tenants (id, name, slug, tenant_type)
VALUES ('00000000-0000-0000-0000-000000000001', 'MXSuite Platform', 'platform', 'PLATFORM');
