import { Tree, Typography } from 'antd';
import type { DataNode } from 'antd/es/tree';
import type { SchemaNodeDto } from '@mxsuite/shared';

const { Text } = Typography;

interface Props {
  nodes: SchemaNodeDto[];
  selectedEntity?: string;
  onSelectEntity: (entity: string | null) => void;
  loading?: boolean;
}

function toTreeData(nodes: SchemaNodeDto[]): DataNode[] {
  return nodes.map(node => ({
    key: node.nodeName,
    title: (
      <span>
        <Text strong={node.nodeType === 'ENTITY'}>{node.nodeName}</Text>
        {node.recordCount != null && (
          <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
            {node.recordCount.toLocaleString()}
          </Text>
        )}
      </span>
    ),
    children: node.children?.length ? toTreeData(node.children) : undefined,
    isLeaf: node.nodeType === 'FIELD',
  }));
}

export default function SourceSchemaTree({ nodes, selectedEntity, onSelectEntity, loading }: Props) {
  const treeData = toTreeData(nodes);

  return (
    <div style={{
      width: 240,
      borderRight: '1px solid #f0f0f0',
      overflow: 'auto',
      padding: '12px 8px',
      flexShrink: 0,
    }}>
      <Text strong style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', display: 'block', marginBottom: 8, paddingLeft: 4 }}>
        Source schema
      </Text>
      {loading ? (
        <Text type="secondary" style={{ padding: 12 }}>Loading...</Text>
      ) : (
        <Tree
          treeData={treeData}
          selectedKeys={selectedEntity ? [selectedEntity] : []}
          onSelect={(keys) => {
            const key = keys[0] as string | undefined;
            onSelectEntity(key || null);
          }}
          defaultExpandAll
          style={{ fontSize: 12 }}
        />
      )}
    </div>
  );
}
