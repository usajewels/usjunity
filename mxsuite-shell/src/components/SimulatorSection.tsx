import { useState, useEffect, useCallback } from 'react';
import {
  Card, Button, InputNumber, Select, Space, Typography, Divider,
  Input, Progress, message,
} from 'antd';
import {
  BankOutlined, UserAddOutlined, MailOutlined, DeleteOutlined,
  ThunderboltOutlined, WarningOutlined, TeamOutlined, BulbOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { platformApi } from '../services/platformApi';

const { Text, Title } = Typography;

/* ------------------------------------------------------------------ */
/*  Random-data dictionaries                                           */
/* ------------------------------------------------------------------ */

const ADJECTIVES = [
  'Apex', 'Summit', 'Bright', 'Pinnacle', 'Horizon', 'Crest', 'Nova',
  'Vanguard', 'Prime', 'Atlas', 'Stellar', 'Cascade', 'Meridian', 'Vertex',
  'Zenith', 'Harbor', 'Granite', 'Silver', 'Cobalt', 'Ember',
];

const NOUNS = [
  'Technologies', 'Healthcare', 'Financial', 'Solutions', 'Industries',
  'Consulting', 'Partners', 'Dynamics', 'Enterprises', 'Group',
  'Services', 'Systems', 'Networks', 'Capital', 'Logistics',
  'Analytics', 'Ventures', 'Global', 'Digital', 'Labs',
];

const FIRST_NAMES = [
  'James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael',
  'Linda', 'David', 'Elizabeth', 'William', 'Barbara', 'Richard', 'Susan',
  'Joseph', 'Jessica', 'Thomas', 'Sarah', 'Christopher', 'Karen',
  'Daniel', 'Lisa', 'Matthew', 'Nancy', 'Anthony', 'Betty', 'Mark', 'Margaret',
  'Steven', 'Sandra',
];

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller',
  'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez',
  'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin',
  'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark',
  'Ramirez', 'Lewis', 'Robinson',
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

const DECISION_TITLES = [
  'Member ID format migration strategy',
  'Duplicate email handling policy',
  'Historical transaction data retention',
  'Custom field mapping for legacy addresses',
  'Membership tier consolidation approach',
  'Event registration data merge strategy',
  'Payment gateway transition plan',
  'Contact phone number normalization',
  'Inactive member archive policy',
  'Committee assignment data migration',
  'Certification record handling',
  'Sponsor relationship data model',
  'Invoice numbering scheme migration',
  'Chapter affiliation mapping strategy',
  'Communication preference migration',
];

const DECISION_OPTIONS_POOL = [
  ['Merge and deduplicate', 'Keep separate records', 'Manual review required'],
  ['Use new format', 'Keep legacy format', 'Hybrid approach'],
  ['Migrate all history', 'Last 3 years only', 'Summary records only'],
  ['Auto-map by name', 'Manual mapping', 'AI-assisted mapping'],
  ['Consolidate tiers', 'Preserve all tiers', 'Create mapping table'],
];

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface TenantOption { id: string; name: string; slug: string; tenantType: string }

const ROLE_OPTIONS = [
  { label: 'Member Admin', value: 'TENANT_ADMIN' },
  { label: 'Member', value: 'TENANT_USER' },
];

export default function SimulatorSection() {
  /* ---- shared state ---- */
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [tenantsLoading, setTenantsLoading] = useState(false);

  const fetchTenants = useCallback(async () => {
    setTenantsLoading(true);
    try {
      const { data } = await platformApi.listTenants();
      setTenants(data.content ?? []);
    } catch {
      /* silent */
    } finally {
      setTenantsLoading(false);
    }
  }, []);

  useEffect(() => { fetchTenants(); }, [fetchTenants]);

  /* ---- org generator ---- */
  const [orgCount, setOrgCount] = useState(3);
  const [orgCoachIds, setOrgCoachIds] = useState<string[]>([]);
  const [orgProgress, setOrgProgress] = useState<number | null>(null);

  const generateOrgs = async () => {
    setOrgProgress(0);
    let created = 0;
    for (let i = 0; i < orgCount; i++) {
      const name = `${pick(ADJECTIVES)} ${pick(NOUNS)}`;
      const slug = toSlug(name) + '-' + Math.random().toString(36).slice(2, 6);
      const first = pick(FIRST_NAMES);
      const last = pick(LAST_NAMES);
      try {
        const coachIds = orgCoachIds.length > 0
          ? [pick(orgCoachIds)]  // randomly assign one selected coach per org
          : undefined;
        await platformApi.createTenantWithOwner({
          name,
          slug,
          ownerEmail: `${first.toLowerCase()}.${last.toLowerCase()}@${slug}.test`,
          ownerFirstName: first,
          ownerLastName: last,
          coachIds,
        });
        created++;
      } catch {
        /* skip duplicates */
      }
      setOrgProgress(Math.round(((i + 1) / orgCount) * 100));
    }
    message.success(`Created ${created} organization(s) with owner accounts`);
    setOrgProgress(null);
    fetchTenants();
  };

  /* ---- user generator ---- */
  const [userCount, setUserCount] = useState(5);
  const [userTenantId, setUserTenantId] = useState<string | undefined>();
  const [userRole, setUserRole] = useState('TENANT_USER');
  const [userProgress, setUserProgress] = useState<number | null>(null);

  const generateUsers = async () => {
    if (!userTenantId) { message.warning('Select an organization first'); return; }
    const tenant = tenants.find(t => t.id === userTenantId);
    const slug = tenant?.slug || 'test';
    setUserProgress(0);
    let created = 0;
    for (let i = 0; i < userCount; i++) {
      const first = pick(FIRST_NAMES);
      const last = pick(LAST_NAMES);
      const rand = Math.random().toString(36).slice(2, 5);
      try {
        await platformApi.createUser({
          email: `${first.toLowerCase()}.${last.toLowerCase()}.${rand}@${slug}.test`,
          password: 'Test1234!',
          firstName: first,
          lastName: last,
          role: userRole,
          tenantId: userTenantId,
        });
        created++;
      } catch {
        /* skip */
      }
      setUserProgress(Math.round(((i + 1) / userCount) * 100));
    }
    message.success(`Created ${created} user(s)`);
    setUserProgress(null);
  };

  /* ---- invitation generator ---- */
  const [invCount, setInvCount] = useState(5);
  const [invTenantId, setInvTenantId] = useState<string | undefined>();
  const [invRole, setInvRole] = useState('TENANT_USER');
  const [invProgress, setInvProgress] = useState<number | null>(null);

  const generateInvitations = async () => {
    if (!invTenantId) { message.warning('Select an organization first'); return; }
    const tenant = tenants.find(t => t.id === invTenantId);
    const slug = tenant?.slug || 'test';
    setInvProgress(0);
    let created = 0;
    for (let i = 0; i < invCount; i++) {
      const first = pick(FIRST_NAMES);
      const last = pick(LAST_NAMES);
      const rand = Math.random().toString(36).slice(2, 5);
      try {
        await platformApi.createInvitation(
          { email: `${first.toLowerCase()}.${last.toLowerCase()}.${rand}@${slug}.test`, role: invRole },
          invTenantId,
        );
        created++;
      } catch {
        /* skip */
      }
      setInvProgress(Math.round(((i + 1) / invCount) * 100));
    }
    message.success(`Created ${created} invitation(s)`);
    setInvProgress(null);
  };

  /* ---- coach/coach-admin generator ---- */
  const COACH_ROLE_OPTIONS = [
    { label: 'Onboarding Coach', value: 'PLATFORM_SUPPORT' },
    { label: 'Coach Admin', value: 'COACH_ADMIN' },
  ];
  const [coachGenCount, setCoachGenCount] = useState(3);
  const [coachGenRole, setCoachGenRole] = useState('PLATFORM_SUPPORT');
  const [coachGenProgress, setCoachGenProgress] = useState<number | null>(null);

  const platformTenant = tenants.find(t => t.tenantType === 'PLATFORM');

  const generateCoaches = async () => {
    if (!platformTenant) { message.warning('Platform organization not found'); return; }
    setCoachGenProgress(0);
    let created = 0;
    for (let i = 0; i < coachGenCount; i++) {
      const first = pick(FIRST_NAMES);
      const last = pick(LAST_NAMES);
      const rand = Math.random().toString(36).slice(2, 5);
      try {
        await platformApi.createUser({
          email: `${first.toLowerCase()}.${last.toLowerCase()}.${rand}@mxsuite.test`,
          password: 'Test1234!',
          firstName: first,
          lastName: last,
          role: coachGenRole,
          tenantId: platformTenant.id,
        });
        created++;
      } catch { /* skip */ }
      setCoachGenProgress(Math.round(((i + 1) / coachGenCount) * 100));
    }
    message.success(`Created ${created} ${coachGenRole === 'COACH_ADMIN' ? 'coach admin(s)' : 'coach(es)'}`);
    setCoachGenProgress(null);
    fetchCoaches();
  };

  /* ---- coach assignment generator ---- */
  const [coaches, setCoaches] = useState<Array<{ id: string; firstName: string; lastName: string; email: string; role: string }>>([]);
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachAssigning, setCoachAssigning] = useState(false);

  const fetchCoaches = useCallback(async () => {
    setCoachLoading(true);
    try {
      const { data } = await platformApi.listCoaches();
      setCoaches(data ?? []);
    } catch { /* silent */ }
    finally { setCoachLoading(false); }
  }, []);

  useEffect(() => { fetchCoaches(); }, [fetchCoaches]);

  const assignCoachesRandomly = async () => {
    if (coaches.length === 0) { message.warning('No coaches available to assign'); return; }
    if (tenants.length === 0) { message.warning('No organizations available'); return; }
    setCoachAssigning(true);
    let assigned = 0;
    for (const tenant of tenants) {
      const coach = pick(coaches);
      try {
        await platformApi.assignCoach(tenant.id, coach.id);
        assigned++;
      } catch {
        /* skip — may already be assigned */
      }
    }
    message.success(`Assigned coaches to ${assigned} organization(s)`);
    setCoachAssigning(false);
  };

  /* ---- decision generator ---- */
  const [decCount, setDecCount] = useState(5);
  const [decTenantId, setDecTenantId] = useState<string | undefined>();
  const [decProgress, setDecProgress] = useState<number | null>(null);

  const generateDecisions = async () => {
    if (!decTenantId) { message.warning('Select an organization first'); return; }
    setDecProgress(0);
    let created = 0;
    const shuffled = [...DECISION_TITLES].sort(() => Math.random() - 0.5);
    const count = Math.min(decCount, shuffled.length);
    for (let i = 0; i < count; i++) {
      const opts = pick(DECISION_OPTIONS_POOL);
      try {
        await platformApi.createDecision({
          title: shuffled[i],
          summary: `Requires team input on how to handle this during migration for the organization.`,
          tenantId: decTenantId,
          options: opts.map((label, idx) => ({
            label,
            description: `Option ${idx + 1}: ${label}`,
            isRecommended: idx === 0,
          })),
        });
        created++;
      } catch { /* skip */ }
      setDecProgress(Math.round(((i + 1) / count) * 100));
    }
    message.success(`Created ${created} decision(s)`);
    setDecProgress(null);
  };

  /* ---- reset demo ---- */
  const [resetText, setResetText] = useState('');
  const [resetting, setResetting] = useState(false);

  const handleReset = async () => {
    setResetting(true);
    try {
      const { data } = await platformApi.resetDemo();
      message.success(`Reset complete — ${data.deletedOrganizations} organization(s) deleted`);
      setResetText('');
      fetchTenants();
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'Failed to reset demo environment');
    } finally {
      setResetting(false);
    }
  };

  /* ---- render ---- */
  const cardStyle: React.CSSProperties = { marginBottom: 16 };
  const labelStyle: React.CSSProperties = { display: 'inline-block', width: 110, fontWeight: 500 };

  const tenantSelectProps = {
    placeholder: 'Select organization',
    loading: tenantsLoading,
    options: tenants.filter(t => t.tenantType !== 'PLATFORM').map(t => ({ label: t.name, value: t.id })),
    style: { width: 260 } as React.CSSProperties,
    showSearch: true,
    filterOption: (input: string, option?: { label: string }) =>
      (option?.label ?? '').toLowerCase().includes(input.toLowerCase()),
  };

  return (
    <div style={{ maxWidth: 700 }}>
      {/* Generate Organizations */}
      <Card
        title={<Space><BankOutlined /> Generate Organizations</Space>}
        size="small"
        style={cardStyle}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
          Creates organizations with random names and an auto-generated owner account (password: Test1234!). Optionally assign coach admins — one is randomly picked per org. Max 50 per batch.
        </Text>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <span style={labelStyle}>Coach admins</span>
            <Select
              mode="multiple"
              placeholder="None (optional)"
              loading={coachLoading}
              options={coaches.filter(c => c.role === 'COACH_ADMIN').map(c => ({
                label: `${c.firstName} ${c.lastName}`,
                value: c.id,
              }))}
              value={orgCoachIds}
              onChange={setOrgCoachIds}
              style={{ width: 360 }}
              allowClear
              showSearch
              filterOption={(input, option) =>
                (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())
              }
            />
          </div>
          <div>
            <span style={labelStyle}>Count</span>
            <Space>
              <InputNumber min={1} max={50} value={orgCount} onChange={v => setOrgCount(v ?? 3)} style={{ width: 80 }} />
              <Button
                type="primary"
                icon={<ThunderboltOutlined />}
                onClick={generateOrgs}
                loading={orgProgress !== null}
              >
                Generate
              </Button>
            </Space>
          </div>
        </div>
        {orgProgress !== null && <Progress percent={orgProgress} size="small" style={{ marginTop: 8 }} />}
      </Card>

      {/* Generate Users */}
      <Card
        title={<Space><UserAddOutlined /> Generate Users</Space>}
        size="small"
        style={cardStyle}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
          Creates users with random names in the selected organization (password: Test1234!). Max 50 per batch.
        </Text>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <span style={labelStyle}>Organization</span>
            <Select {...tenantSelectProps} value={userTenantId} onChange={setUserTenantId} />
          </div>
          <div>
            <span style={labelStyle}>Role</span>
            <Select options={ROLE_OPTIONS} value={userRole} onChange={setUserRole} style={{ width: 180 }} />
          </div>
          <div>
            <span style={labelStyle}>Count</span>
            <Space>
              <InputNumber min={1} max={50} value={userCount} onChange={v => setUserCount(v ?? 5)} style={{ width: 80 }} />
              <Button
                type="primary"
                icon={<ThunderboltOutlined />}
                onClick={generateUsers}
                loading={userProgress !== null}
                disabled={!userTenantId}
              >
                Generate
              </Button>
            </Space>
          </div>
        </div>
        {userProgress !== null && <Progress percent={userProgress} size="small" style={{ marginTop: 8 }} />}
      </Card>

      {/* Generate Invitations */}
      <Card
        title={<Space><MailOutlined /> Generate Invitations</Space>}
        size="small"
        style={cardStyle}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
          Creates pending invitations with random email addresses in the selected organization. Max 50 per batch.
        </Text>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <span style={labelStyle}>Organization</span>
            <Select {...tenantSelectProps} value={invTenantId} onChange={setInvTenantId} />
          </div>
          <div>
            <span style={labelStyle}>Role</span>
            <Select options={ROLE_OPTIONS} value={invRole} onChange={setInvRole} style={{ width: 180 }} />
          </div>
          <div>
            <span style={labelStyle}>Count</span>
            <Space>
              <InputNumber min={1} max={50} value={invCount} onChange={v => setInvCount(v ?? 5)} style={{ width: 80 }} />
              <Button
                type="primary"
                icon={<ThunderboltOutlined />}
                onClick={generateInvitations}
                loading={invProgress !== null}
                disabled={!invTenantId}
              >
                Generate
              </Button>
            </Space>
          </div>
        </div>
        {invProgress !== null && <Progress percent={invProgress} size="small" style={{ marginTop: 8 }} />}
      </Card>

      {/* Generate Coaches */}
      <Card
        title={<Space><SafetyCertificateOutlined /> Generate Coaches</Space>}
        size="small"
        style={cardStyle}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
          Creates coaches or coach admins in the platform organization (password: Test1234!). Max 50 per batch.
        </Text>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <span style={labelStyle}>Role</span>
            <Select options={COACH_ROLE_OPTIONS} value={coachGenRole} onChange={setCoachGenRole} style={{ width: 200 }} />
          </div>
          <div>
            <span style={labelStyle}>Count</span>
            <Space>
              <InputNumber min={1} max={50} value={coachGenCount} onChange={v => setCoachGenCount(v ?? 3)} style={{ width: 80 }} />
              <Button
                type="primary"
                icon={<ThunderboltOutlined />}
                onClick={generateCoaches}
                loading={coachGenProgress !== null}
                disabled={!platformTenant}
              >
                Generate
              </Button>
            </Space>
          </div>
        </div>
        {!platformTenant && (
          <Text type="warning" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
            Platform organization not found — coaches cannot be created
          </Text>
        )}
        {coachGenProgress !== null && <Progress percent={coachGenProgress} size="small" style={{ marginTop: 8 }} />}
      </Card>

      {/* Assign Coaches */}
      <Card
        title={<Space><TeamOutlined /> Assign Coaches</Space>}
        size="small"
        style={cardStyle}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
          Randomly assigns an available coach to each organization. Coaches already assigned are skipped.
        </Text>
        <Space align="center">
          <Text style={{ fontSize: 13 }}>
            {coaches.length} coach(es) available &middot; {tenants.length} organization(s)
          </Text>
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            onClick={assignCoachesRandomly}
            loading={coachAssigning}
            disabled={coaches.length === 0 || tenants.length === 0}
          >
            Assign All
          </Button>
        </Space>
      </Card>

      {/* Generate Decisions */}
      <Card
        title={<Space><BulbOutlined /> Generate Decisions</Space>}
        size="small"
        style={cardStyle}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
          Creates migration decisions with realistic titles and multiple options for the selected organization. Max 15 per batch.
        </Text>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <span style={labelStyle}>Organization</span>
            <Select {...tenantSelectProps} value={decTenantId} onChange={setDecTenantId} />
          </div>
          <div>
            <span style={labelStyle}>Count</span>
            <Space>
              <InputNumber min={1} max={15} value={decCount} onChange={v => setDecCount(v ?? 5)} style={{ width: 80 }} />
              <Button
                type="primary"
                icon={<ThunderboltOutlined />}
                onClick={generateDecisions}
                loading={decProgress !== null}
                disabled={!decTenantId}
              >
                Generate
              </Button>
            </Space>
          </div>
        </div>
        {decProgress !== null && <Progress percent={decProgress} size="small" style={{ marginTop: 8 }} />}
      </Card>

      {/* Danger Zone */}
      <Divider />
      <Card
        title={<Space><WarningOutlined style={{ color: '#ff4d4f' }} /> Danger Zone</Space>}
        size="small"
        styles={{ header: { background: '#fff2f0', borderBottom: '2px solid #ffa39e' } }}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>
          Delete all non-platform organizations and their users, invitations, and data. Platform admin accounts are preserved.
        </Text>
        <Text strong style={{ display: 'block', marginBottom: 12 }}>
          Type <Text code>RESET</Text> to confirm:
        </Text>
        <Space>
          <Input
            value={resetText}
            onChange={e => setResetText(e.target.value)}
            placeholder="Type RESET"
            style={{ width: 160 }}
          />
          <Button
            danger
            icon={<DeleteOutlined />}
            onClick={handleReset}
            loading={resetting}
            disabled={resetText !== 'RESET'}
          >
            Reset Demo Data
          </Button>
        </Space>
      </Card>
    </div>
  );
}
