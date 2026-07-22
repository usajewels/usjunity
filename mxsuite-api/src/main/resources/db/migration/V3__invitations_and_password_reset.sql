-- =====================================================
-- MXSuite Platform - V3: Invitations & Password Reset
-- =====================================================

-- =====================================================
-- INVITATIONS
-- =====================================================
CREATE TABLE invitations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email           VARCHAR(255) NOT NULL,
    token           VARCHAR(255) NOT NULL UNIQUE,
    role            VARCHAR(30) NOT NULL CHECK (role IN ('PLATFORM_ADMIN', 'PLATFORM_SUPPORT', 'TENANT_ADMIN', 'TENANT_USER')),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    invited_by      UUID NOT NULL REFERENCES users(id),
    status          VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'CANCELLED', 'EXPIRED')),
    expires_at      TIMESTAMPTZ NOT NULL,
    accepted_at     TIMESTAMPTZ,
    created_by      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_modified_by UUID,
    last_modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    administrator_id UUID
);

CREATE UNIQUE INDEX idx_invitation_token ON invitations(token);
CREATE INDEX idx_invitation_email ON invitations(email);
CREATE INDEX idx_invitation_tenant ON invitations(tenant_id);
CREATE INDEX idx_invitation_status ON invitations(tenant_id, status);

-- =====================================================
-- PASSWORD RESET TOKENS
-- =====================================================
CREATE TABLE password_reset_tokens (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token           VARCHAR(255) NOT NULL UNIQUE,
    user_id         UUID NOT NULL REFERENCES users(id),
    expires_at      TIMESTAMPTZ NOT NULL,
    used            BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_reset_token ON password_reset_tokens(token);
CREATE INDEX idx_reset_user ON password_reset_tokens(user_id);
