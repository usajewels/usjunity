import { Card, Col, Row, Statistic } from 'antd';
import {
  RocketOutlined,
  SafetyCertificateOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import type { MigrationStats } from '@mxsuite/shared';

interface Props {
  stats: MigrationStats;
  loading?: boolean;
  alertCount?: number;
}

export default function StatsCards({ stats, loading, alertCount }: Props) {
  const showAlerts = alertCount != null && alertCount > 0;
  const colSpan = showAlerts ? { xs: 12, sm: 4 } : { xs: 12, sm: 6 };

  return (
    <Row gutter={16} style={{ marginBottom: 24 }}>
      <Col {...colSpan}>
        <Card size="small" loading={loading}>
          <Statistic
            title="Active Migrations"
            value={stats.activeMigrations}
            prefix={<RocketOutlined style={{ color: '#2d1854' }} />}
            valueStyle={{ color: '#2d1854' }}
          />
        </Card>
      </Col>
      <Col {...colSpan}>
        <Card size="small" loading={loading}>
          <Statistic
            title="Gates Awaiting Approval"
            value={stats.gatesAwaitingApproval}
            prefix={<SafetyCertificateOutlined style={{ color: '#6b4fa0' }} />}
            valueStyle={{ color: '#2d1854' }}
          />
        </Card>
      </Col>
      <Col {...colSpan}>
        <Card size="small" loading={loading}>
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
      <Col {...colSpan}>
        <Card size="small" loading={loading}>
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
      {showAlerts && (
        <Col {...colSpan}>
          <Card size="small" loading={loading} style={{ borderTop: '3px solid #fa8c16', borderColor: '#ffe58f' }}>
            <Statistic
              title="Stuck Projects"
              value={alertCount}
              prefix={<WarningOutlined style={{ color: '#fa8c16' }} />}
              valueStyle={{ color: '#fa8c16' }}
            />
          </Card>
        </Col>
      )}
    </Row>
  );
}
