-- =====================================================
-- Development Seed Data
-- =====================================================

-- Platform admin user (password: admin123)
INSERT INTO users (id, email, password_hash, first_name, last_name, role, tenant_id)
VALUES (
    '00000000-0000-0000-0000-000000000010',
    'admin@mxsuite.com',
    '$2a$10$eWw15ejscxyCZ8DUUZLZXeiclBKRyLphU9WkqxmElui8L0AILbp8W',
    'Platform', 'Admin',
    'PLATFORM_ADMIN',
    '00000000-0000-0000-0000-000000000001'
) ON CONFLICT DO NOTHING;

-- Sample customer tenant
INSERT INTO tenants (id, name, slug, tenant_type)
VALUES ('00000000-0000-0000-0000-000000000002', 'Denver Chamber of Commerce', 'denver-chamber', 'CUSTOMER')
ON CONFLICT DO NOTHING;

-- Customer admin user (password: admin123)
INSERT INTO users (id, email, password_hash, first_name, last_name, role, tenant_id)
VALUES (
    '00000000-0000-0000-0000-000000000020',
    'admin@denverchamber.org',
    '$2a$10$eWw15ejscxyCZ8DUUZLZXeiclBKRyLphU9WkqxmElui8L0AILbp8W',
    'Jane', 'Smith',
    'TENANT_ADMIN',
    '00000000-0000-0000-0000-000000000002'
) ON CONFLICT DO NOTHING;

-- Onboarding coach user (password: admin123)
INSERT INTO users (id, email, password_hash, first_name, last_name, role, tenant_id)
VALUES (
    '00000000-0000-0000-0000-000000000011',
    'support@mxsuite.com',
    '$2a$10$eWw15ejscxyCZ8DUUZLZXeiclBKRyLphU9WkqxmElui8L0AILbp8W',
    'Onboarding', 'Coach',
    'PLATFORM_SUPPORT',
    '00000000-0000-0000-0000-000000000001'
) ON CONFLICT DO NOTHING;

-- Assign onboarding coach to Denver Chamber
INSERT INTO platform_assignments (id, user_id, tenant_id)
VALUES (
    '00000000-0000-0000-0000-000000000100',
    '00000000-0000-0000-0000-000000000011',
    '00000000-0000-0000-0000-000000000002'
) ON CONFLICT DO NOTHING;
