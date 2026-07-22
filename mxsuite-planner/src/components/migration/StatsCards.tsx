import { Card, Col, Row, Statistic } from 'antd';
import {
  RocketOutlined,
  SafetyCertificateOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import type { MigrationStats } from '@mxsuite/shared';

interface Props {
  stats: MigrationStats;
  loading?: boolean;
}

export default function StatsCards({ stats, loading }: Props) {
  return (
    <Row gutter={16} style={{ marginBottom: 24 }}>
      <Col xs={12} sm={6}>
        <Card size="small" loading={loading} style={{ borderTop: '3px solid #2d1854', borderColor: '#e0d4f5' }}>
          <Statistic
            title="Active Migrations"
            value={stats.activeMigrations}
            prefix={<RocketOutlined style={{ color: '#2d1854' }} />}
            valueStyle={{ color: '#2d1854' }}
          />
        </Card>
      </Col>
      <Col xs={12} sm={6}>
        <Card size="small" loading={loading} style={{ borderTop: '3px solid #2d1854', borderColor: '#e0d4f5' }}>
          <Statistic
            title="Gates Awaiting Approval"
            value={stats.gatesAwaitingApproval}
            prefix={<SafetyCertificateOutlined style={{ color: '#6b4fa0' }} />}
            valueStyle={{ color: '#2d1854' }}
          />
        </Card>
      </Col>
      <Col xs={12} sm={6}>
        <Card size="small" loading={loading} style={{ borderTop: '3px solid #2d1854', borderColor: '#e0d4f5' }}>
          <Statistic
            title="Avg Cycle Time"
            value={stats.avgCycleTimeDays}
            suffix="days"
            precision={1}
            prefix={<ClockCircleOutlined style={{ color: '#6b4fa0' }} />}
            valueStyle={{ color: '#2d1854' }}
          />
        </Card>
      </Col>
      <Col xs={12} sm={6}>
        <Card size="small" loading={loading} style={{ borderTop: '3px solid #2d1854', borderColor: '#e0d4f5' }}>
          <Statistic
            title="Reconciliation Pass Rate"
            value={stats.reconciliationPassRate}
            suffix="%"
            precision={1}
            prefix={<CheckCircleOutlined style={{ color: '#6b4fa0' }} />}
            valueStyle={{ color: '#2d1854' }}
          />
        </Card>
      </Col>
    </Row>
  );
}
