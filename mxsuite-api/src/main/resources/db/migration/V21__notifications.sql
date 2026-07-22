-- In-app notification inbox for tenant users
CREATE TABLE notifications (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recipient_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id        UUID REFERENCES tenants(id) ON DELETE CASCADE,
    type             VARCHAR(60) NOT NULL,
    title            VARCHAR(300) NOT NULL,
    message          VARCHAR(1000),
    entity_type      VARCHAR(100),
    entity_id        UUID,
    project_id       UUID REFERENCES projects(id) ON DELETE CASCADE,
    is_read          BOOLEAN NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_recipient_unread ON notifications(recipient_id, is_read);
CREATE INDEX idx_notifications_tenant            ON notifications(tenant_id);
CREATE INDEX idx_notifications_project           ON notifications(project_id);
