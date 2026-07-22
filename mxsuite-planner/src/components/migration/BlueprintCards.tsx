import { Card, Col, Row, Tag, Typography } from 'antd';
import type { MigrationBlueprint } from '@mxsuite/shared';

const { Text, Paragraph } = Typography;

interface Props {
  blueprints: MigrationBlueprint[];
  loading?: boolean;
}

export default function BlueprintCards({ blueprints, loading }: Props) {
  if (loading) {
    return (
      <Row gutter={16}>
        {[1, 2, 3].map(i => (
          <Col xs={24} sm={8} key={i}>
            <Card size="small" loading style={{ marginBottom: 16 }} />
          </Col>
        ))}
      </Row>
    );
  }

  if (blueprints.length === 0) {
    return <Text type="secondary">No blueprints available yet.</Text>;
  }

  return (
    <Row gutter={16}>
      {blueprints.map(bp => (
        <Col xs={24} sm={8} key={bp.id}>
          <Card
            size="small"
            style={{ marginBottom: 16 }}
            title={
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text strong style={{ fontSize: 13 }}>
                  {bp.sourceSystem} → {bp.targetSystem}
                </Text>
                {bp.proven && <Tag color="green">Proven</Tag>}
              </div>
            }
          >
            <Paragraph
              ellipsis={{ rows: 2 }}
              style={{ marginBottom: 0, fontSize: 12, color: 'rgba(0,0,0,0.65)' }}
            >
              {bp.description || bp.name}
            </Paragraph>
          </Card>
        </Col>
      ))}
    </Row>
  );
}
