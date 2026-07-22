import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Select, Spin, Typography, Space, Button } from 'antd';
import { SwapOutlined } from '@ant-design/icons';
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
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    migrationApi.listProjects({ page: 0, size: 100 }).then(({ data }) => {
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

  const goToMappings = () => {
    if (selected) {
      localStorage.setItem(LAST_PROJECT_KEY, selected);
      navigate(`/plans/onboarding-projects/projects/${selected}/mappings`);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <SwapOutlined style={{ fontSize: 40, color: '#d9d9d9', marginBottom: 16 }} />
        <Title level={5} type="secondary">No onboarding projects found</Title>
        <Text type="secondary">Projects appear here once an organization starts onboarding.</Text>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 480, margin: '80px auto', textAlign: 'center' }}>
      <SwapOutlined style={{ fontSize: 36, color: '#2d1854', marginBottom: 16 }} />
      <Title level={4} style={{ marginBottom: 8 }}>Select a Project</Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
        Choose which onboarding project's field mappings to view.
      </Text>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Select
          style={{ width: '100%' }}
          placeholder="Select project..."
          value={selected}
          onChange={setSelected}
          showSearch
          optionFilterProp="label"
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
  );
}
