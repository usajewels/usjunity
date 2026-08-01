import { useEffect, useState } from 'react';
import {
  Button, Input, Space, Spin, Typography, Upload, message,
} from 'antd';
import { SaveOutlined, UploadOutlined } from '@ant-design/icons';
import { platformApi } from '../services/platformApi';

const { Text } = Typography;

interface Props {
  tenantId: string;
}

export default function BrandingSection({ tenantId }: Props) {
  const [brandName, setBrandName] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    platformApi.getTenant(tenantId)
      .then(({ data }) => {
        setBrandName((data.brandName as string) || '');
        setLogoUrl((data.logoUrl as string) || null);
      })
      .catch(() => message.error('Failed to load branding'))
      .finally(() => setLoading(false));
  }, [tenantId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await platformApi.updateTenant(tenantId, { brandName });
      message.success('Brand name saved');
      localStorage.setItem('mxsuite_platform_branding', JSON.stringify({ brandName }));
      window.dispatchEvent(new CustomEvent('platform-branding-updated'));
    } catch {
      message.error('Failed to save brand name');
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (file: File) => {
    try {
      const { data } = await platformApi.uploadLogo(tenantId, file);
      setLogoUrl(data.logoUrl);
      message.success('Logo uploaded');
    } catch {
      message.error('Failed to upload logo');
    }
    return false;
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <Spin tip="Loading branding..." />
      </div>
    );
  }

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <Text strong style={{ display: 'block', marginBottom: 6 }}>Brand Name</Text>
        <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>
          Displayed in the sidebar for all users. This is the platform-wide product name.
        </Text>
        <Space>
          <Input
            value={brandName}
            onChange={(e) => setBrandName(e.target.value)}
            placeholder="GrowthZone MemberSuite"
            style={{ width: 300 }}
          />
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={handleSave}
            loading={saving}
            style={{ background: '#2d1854', borderColor: '#2d1854' }}
          >
            Save
          </Button>
        </Space>
      </div>

      <div>
        <Text strong style={{ display: 'block', marginBottom: 6 }}>Logo</Text>
        <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>
          Displayed in the sidebar and login page. PNG, JPG, SVG, or WEBP (max 2MB).
        </Text>
        <Space align="center" size={16}>
          {logoUrl && (
            <img
              src={logoUrl}
              alt="Current logo"
              style={{ maxHeight: 48, maxWidth: 200, objectFit: 'contain' }}
            />
          )}
          <Upload
            beforeUpload={(file) => { handleLogoUpload(file as unknown as File); return false; }}
            showUploadList={false}
            accept=".png,.jpg,.jpeg,.svg,.webp"
          >
            <Button icon={<UploadOutlined />}>
              {logoUrl ? 'Change Logo' : 'Upload Logo'}
            </Button>
          </Upload>
        </Space>
      </div>
    </>
  );
}
