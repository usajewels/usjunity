-- ============================================================
-- V33: Chat system — conversations and messages
-- ============================================================

CREATE TABLE conversations (
    id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    member_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    member_name            VARCHAR(200),
    member_avatar_url      VARCHAR(500),
    assigned_coach_id      UUID REFERENCES users(id) ON DELETE SET NULL,
    assigned_coach_name    VARCHAR(200),
    mode                   VARCHAR(10) NOT NULL DEFAULT 'AI'
                               CHECK (mode IN ('AI', 'HUMAN')),
    controlling_coach_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    controlling_coach_name VARCHAR(200),
    status                 VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
                               CHECK (status IN ('ACTIVE', 'ARCHIVED', 'CLOSED')),
    subject                VARCHAR(500),
    sentiment_score        DOUBLE PRECISION,
    sentiment_label        VARCHAR(30),
    help_requested         BOOLEAN NOT NULL DEFAULT FALSE,
    last_message_at        TIMESTAMPTZ,
    last_message_preview   VARCHAR(300),
    unread_coach_count     INTEGER NOT NULL DEFAULT 0,
    unread_member_count    INTEGER NOT NULL DEFAULT 0,
    onboarding_id          UUID REFERENCES onboardings(id) ON DELETE SET NULL,
    version                INTEGER NOT NULL DEFAULT 0,
    created_by             UUID,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_modified_by       UUID,
    last_modified_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    administrator_id       UUID
);

CREATE INDEX idx_conversations_tenant    ON conversations(tenant_id);
CREATE INDEX idx_conversations_member    ON conversations(member_id);
CREATE INDEX idx_conversations_coach     ON conversations(assigned_coach_id);
CREATE INDEX idx_conversations_status    ON conversations(status);
CREATE INDEX idx_conversations_last_msg  ON conversations(last_message_at DESC);

CREATE TABLE chat_messages (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id   UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_type       VARCHAR(10) NOT NULL
                          CHECK (sender_type IN ('MEMBER', 'COACH', 'AI', 'SYSTEM')),
    sender_id         UUID,
    sender_name       VARCHAR(200),
    sender_avatar_url VARCHAR(500),
    content           TEXT NOT NULL,
    sentiment_score   DOUBLE PRECISION,
    metadata          JSONB,
    created_by        UUID,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_modified_by  UUID,
    last_modified_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    administrator_id  UUID
);

CREATE INDEX idx_chat_messages_conversation ON chat_messages(conversation_id, created_at);
CREATE INDEX idx_chat_messages_sender       ON chat_messages(sender_id);
