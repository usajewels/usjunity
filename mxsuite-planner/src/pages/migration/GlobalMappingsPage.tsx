import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Select, Spin, Typography, Space, Button } from 'antd';
import { GlobalOutlined, SwapOutlined } from '@ant-design/icons';
import type { MigrationProject } from '@mxsuite/shared';
import { usePageTitle } from '@mxsuite/shared';
import { migrationApi } from '../../services/migrationApi';

const { Text, Title } = Typography;

const LAST_PROJECT_KEY = 'mxsuite_coach_last_project';

export default function GlobalMappingsPage() {
  usePageTitle('Mappings');
  const navigate = useNavigate();
  const [projects, setProjects] = useState<MigrationProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    migrationApi.listProjects({ page: 0, size: 50 }).then(({ data }) => {
      const list: MigrationProject[] = (data as any).content ?? data;
      setProjects(Array.isArray(list) ? list : []);
      if (!Array.isArray(list) || list.length === 0) return;

      // Auto-navigate when there's only one project
      if (list.length === 1) {
        navigate(`/plans/onboarding-projects/projects/${list[0].id}/mappings`, { replace: true });
        return;
      }

      // Auto-navigate to the last project the coach was working on
      const lastProjectId = localStorage.getItem(LAST_PROJECT_KEY);
      if (lastProjectId && list.some((p) => p.id === lastProjectId)) {
        navigate(`/plans/onboarding-projects/projects/${lastProjectId}/mappings`, { replace: true });
      }
    }).catch(() => {
      setLoading(false);
    }).finally(() => {
      setLoading(false);
    });
  }, [navigate]);

  const handleProjectSearch = (value: string) => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const params: Record<string, unknown> = { page: 0, size: 50 };
        if (value.trim()) params.search = value.trim();
        const { data } = await migrationApi.listProjects(params);
        const list: MigrationProject[] = (data as any).content ?? data;
        setProjects(Array.isArray(list) ? list : []);
      } finally {
        setSearching(false);
      }
    }, 300);
  };

  const goToMappings = () => {
    if (selected) {
      localStorage.setItem(LAST_PROJECT_KEY, selected);
      navigate(`/plans/onboarding-projects/projects/${selected}/mappings`);
    }
  };

  const banner = (
    <div style={{
      background: 'linear-gradient(135deg, #2d1854 0%, #1a0e3a 100%)',
      margin: '-24px -24px 24px -24px',
      padding: '28px 32px 20px 32px',
      borderBottom: '3px solid #6b4fa0',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <GlobalOutlined style={{ fontSize: 24, color: 'rgba(255,255,255,0.7)' }} />
        <div>
          <Title level={3} style={{ margin: 0, color: '#fff' }}>Mappings</Title>
          <Text style={{ color: 'rgba(255,255,255,0.7)' }}>Select a project to view its field mappings.</Text>
        </div>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div>
        {banner}
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
          <Spin size="large" />
        </div>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div>
        {banner}
        <div style={{ textAlign: 'center', paddingTop: 80 }}>
          <SwapOutlined style={{ fontSize: 40, color: '#d9d9d9', marginBottom: 16 }} />
          <Title level={5} type="secondary">No onboarding projects found</Title>
          <Text type="secondary">Projects appear here once an organization starts onboarding.</Text>
        </div>
      </div>
    );
  }

  return (
    <div>
      {banner}
      <div style={{ maxWidth: 480, margin: '80px auto', textAlign: 'center' }}>
      <SwapOutlined style={{ fontSize: 36, color: '#2d1854', marginBottom: 16 }} />
      <Title level={4} style={{ marginBottom: 8 }}>Select a Project</Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
        Choose which onboarding project's field mappings to view.
      </Text>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Select
          style={{ width: '100%' }}
          placeholder="Search projects..."
          value={selected}
          onChange={setSelected}
          showSearch
          filterOption={false}
          onSearch={handleProjectSearch}
          notFoundContent={searching ? <Spin size="small" /> : null}
          options={projects.map((p) => ({
            value: p.id,
            label: `${p.name}${(p as any).tenant?.name ? ` — ${(p as any).tenant.name}` : ''}`,
          }))}
          size="large"
        />
        <Button
          type="primary"
          size="large"
          style={{ width: '100%' }}
          disabled={!selected}
          onClick={goToMappings}
        >
          View Mappings
        </Button>
      </Space>
      </div>
    </div>
  );
}
