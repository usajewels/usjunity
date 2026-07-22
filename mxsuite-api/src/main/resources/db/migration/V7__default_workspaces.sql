-- Create default workspace for Denver Chamber of Commerce
INSERT INTO workspaces (id, name, description, owner_id, tenant_id, is_cross_tenant, created_at, last_modified_at)
VALUES (
    '00000000-0000-0000-0000-000000000200',
    'Denver Chamber',
    'Default workspace for Denver Chamber of Commerce',
    '00000000-0000-0000-0000-000000000020',
    '00000000-0000-0000-0000-000000000002',
    false,
    NOW(),
    NOW()
);
