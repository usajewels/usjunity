import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { Layout, Menu, Avatar, Dropdown, Typography, Badge, Space, theme, Grid, Drawer, Popover, List, Button as AntButton, Empty } from 'antd';
import {
  DashboardOutlined, ProjectOutlined,
  SettingOutlined, MessageOutlined, BellOutlined, LogoutOutlined,
  UserOutlined, MenuFoldOutlined, MenuUnfoldOutlined, MenuOutlined,
  SwapOutlined, ImportOutlined, TeamOutlined,
  CodeOutlined, HistoryOutlined, BarChartOutlined,
  VerticalAlignTopOutlined, SyncOutlined,
} from '@ant-design/icons';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../store/AuthContext';
import { api } from '@mxsuite/shared';

const ChatBubble = lazy(() => import('mxsuiteChat/ChatBubble'));

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

const ROLE_AVATAR_COLORS: Record<string, string> = {
  PLATFORM_ADMIN: '#2d1854',
  COACH_ADMIN: '#44336b',
  PLATFORM_SUPPORT: '#6b4fa0',
  TENANT_ADMIN: '#9b7fd4',
  TENANT_USER: '#a0a0a0',
};

const ROLE_SHORT_LABELS: Record<string, string> = {
  PLATFORM_ADMIN: 'Admin',
  COACH_ADMIN: 'Coach Admin',
  PLATFORM_SUPPORT: 'Coach',
  TENANT_ADMIN: 'Member Admin',
  TENANT_USER: 'Member',
};

export default function AppLayout({ children }: { children?: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { user, tenant, platformBranding, isPlatformUser, isPlatformAdmin, isTenantAdmin, isDevLogin, hasFeature, login, devLogin, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { token: themeToken } = theme.useToken();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);

  // Sidebar badge counts (coach/admin only)
  const [activeProjectCount, setActiveProjectCount] = useState(0);
  const [openDecisionsCount, setOpenDecisionsCount] = useState(0);
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0);
  const [pendingInvitationsCount, setPendingInvitationsCount] = useState(0);

  // Member sidebar badge counts
  const [memberMappingStats, setMemberMappingStats] = useState<{ mapped: number; total: number; needsReview: number } | null>(null);
  const [memberDecisionStats, setMemberDecisionStats] = useState<{ open: number } | null>(null);
  const [memberUploadRowCount, setMemberUploadRowCount] = useState<number | null>(null);
  const [memberUploadFilename, setMemberUploadFilename] = useState<string | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);

  const fetchOnboardingCounts = useCallback(async () => {
    try {
      const [statsRes, decisionsRes, approvalsRes] = await Promise.all([
        api.get<{ activeMigrations: number }>('/migration/stats'),
        api.get<{ open: number }>('/migration/decisions/stats'),
        api.get<{ pending: number }>('/migration/approvals/stats'),
      ]);
      setActiveProjectCount(statsRes.data.activeMigrations ?? 0);
      setOpenDecisionsCount(decisionsRes.data.open ?? 0);
      setPendingApprovalsCount(approvalsRes.data.pending ?? 0);
    } catch {
      // Silently fail
    }

    // Fetch pending invitations count (platform users)
    if (isPlatformUser) {
      try {
        const { data } = await api.get<{ content: unknown[]; totalElements: number }>(
          '/invitations', { params: { page: 0, size: 1, status: 'PENDING' } }
        );
        setPendingInvitationsCount(data.totalElements ?? 0);
      } catch {
        // Silently fail
      }
    }
  }, [isPlatformUser]);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const { data } = await api.get<{ count: number }>('/notifications/unread-count');
      setUnreadCount(data.count ?? 0);
    } catch {
      // Silently fail — notification polling should never break the app
    }
  }, []);

  const fetchNotifications = useCallback(async () => {
    try {
      const { data } = await api.get<{ content: any[] }>('/notifications', { params: { page: 0, size: 10 } });
      setNotifications(data.content ?? []);
    } catch {
      // Silently fail
    }
  }, []);

  const markAllRead = async () => {
    try {
      await api.put('/notifications/read-all');
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch {
      // Silently fail
    }
  };

  const markOneRead = async (id: string) => {
    try {
      await api.put(`/notifications/${id}/read`);
      setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {
      // Silently fail
    }
  };

  useEffect(() => {
    fetchUnreadCount();
    const timer = setInterval(fetchUnreadCount, 30_000);
    return () => clearInterval(timer);
  }, [fetchUnreadCount]);

  useEffect(() => {
    if (!isPlatformUser) return;
    fetchOnboardingCounts();
    const timer = setInterval(fetchOnboardingCounts, 60_000);
    return () => clearInterval(timer);
  }, [isPlatformUser, fetchOnboardingCounts]);

  // Fetch member onboarding badge counts
  const isMember = hasFeature('my-onboarding');
  const fetchMemberCounts = useCallback(async () => {
    try {
      const { data } = await api.get<{
        mappingStats?: { mapped: number; total: number; needsReview: number };
        decisionStats?: { open: number };
        uploadRowCount?: number;
        uploadFilename?: string;
      }>('/my-onboarding');
      if (data.mappingStats) setMemberMappingStats(data.mappingStats);
      if (data.decisionStats) setMemberDecisionStats(data.decisionStats);
      if (data.uploadRowCount != null) setMemberUploadRowCount(data.uploadRowCount);
      if (data.uploadFilename) setMemberUploadFilename(data.uploadFilename);
    } catch {
      // Silently fail — might not have onboarding yet
    }
  }, []);

  useEffect(() => {
    if (!isMember) return;
    fetchMemberCounts();
    const timer = setInterval(fetchMemberCounts, 60_000);
    // Refresh immediately when an upload completes (event from planner MFE)
    const onUpload = () => fetchMemberCounts();
    window.addEventListener('mxsuite:upload-complete', onUpload);
    return () => { clearInterval(timer); window.removeEventListener('mxsuite:upload-complete', onUpload); };
  }, [isMember, fetchMemberCounts]);

  // Scroll-to-top visibility
  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 400);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const handleBellOpen = (open: boolean) => {
    setNotifOpen(open);
    if (open) fetchNotifications();
  };

  const handleMenuClick = (key: string) => {
    navigate(key);
    if (isMobile) setDrawerOpen(false);
  };

  const menuItems = [
    { key: '/', icon: <DashboardOutlined />, label: 'Dashboard' },
    ...(hasFeature('my-onboarding') ? [{
      key: 'sub:my-onboarding', icon: <ImportOutlined />, label: 'My Onboarding',
      children: [
        { key: '/plans/my-onboarding', label: 'Overview' },
        {
          key: '/plans/my-onboarding/upload',
          title: 'Upload Data',
          label: (
            <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: 8 }}>
              Upload Data
              {memberUploadRowCount != null && memberUploadRowCount > 0
                && !memberUploadFilename?.toLowerCase().endsWith('.bak') && (
                <span style={{
                  fontSize: 11,
                  color: 'rgba(255,255,255,0.85)',
                  fontWeight: 600,
                }}>
                  {memberUploadRowCount.toLocaleString()} rows
                </span>
              )}
            </span>
          ),
        },
        {
          key: '/plans/my-onboarding/mappings',
          title: 'Mappings',
          label: (
            <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: 8 }}>
              Mappings
              {memberMappingStats && memberMappingStats.total > 0 && (
                <span style={{
                  fontSize: 11,
                  color: memberMappingStats.mapped === memberMappingStats.total
                    ? '#b7eb8f'
                    : 'rgba(255,255,255,0.85)',
                  fontWeight: 600,
                }}>
                  {memberMappingStats.mapped}/{memberMappingStats.total}
                </span>
              )}
            </span>
          ),
        },
        {
          key: '/plans/my-onboarding/decisions',
          title: 'Decisions',
          label: (
            <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: 8 }}>
              Decisions
              {memberDecisionStats && memberDecisionStats.open > 0 && (
                <Badge count={memberDecisionStats.open} size="small" />
              )}
            </span>
          ),
        },
        { key: '/plans/my-onboarding/data-review', label: 'Data Review' },
        { key: '/plans/my-onboarding/status', label: 'Status' },
        { key: '/plans/my-onboarding/activity', icon: <HistoryOutlined />, label: 'Activity' },
      ],
    }] : []),
    ...(hasFeature('projects') && !hasFeature('migration') ? [{ key: '/workspaces/projects', icon: <ProjectOutlined />, label: 'Projects' }] : []),
    ...(hasFeature('migration') ? [{
      key: 'sub:migration', icon: <SwapOutlined />, label: 'Onboardings',
      children: [
        {
          key: '/plans/onboarding-projects/projects',
          title: 'Projects',
          label: (
            <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: 8 }}>
              Projects
              {activeProjectCount > 0 && <Badge count={activeProjectCount} size="small" style={{ backgroundColor: '#1677ff' }} />}
            </span>
          ),
        },
        { key: '/plans/onboarding-projects/mappings', label: 'Mappings' },
        {
          key: '/plans/onboarding-projects/decisions',
          title: 'Decisions',
          label: (
            <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: 8 }}>
              Decisions
              {openDecisionsCount > 0 && <Badge count={openDecisionsCount} size="small" />}
            </span>
          ),
        },
        {
          key: '/plans/onboarding-projects/approvals',
          title: 'Approvals',
          label: (
            <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: 8 }}>
              Approvals
              {pendingApprovalsCount > 0 && <Badge count={pendingApprovalsCount} size="small" />}
            </span>
          ),
        },
      ],
    }] : []),
    ...(isTenantAdmin ? [{ key: '/team', icon: <TeamOutlined />, label: 'Team Members' }] : []),
    ...(isPlatformUser ? [{
      key: 'sub:analytics', icon: <BarChartOutlined />, label: 'Analytics',
      children: [
        { key: '/admin/analytics', label: 'Overview' },
        ...(isPlatformAdmin ? [{ key: '/admin/analytics/coaches', label: 'Coach Performance' }] : []),
      ],
    }] : []),
    ...(isPlatformUser ? [
      { type: 'divider' as const },
      { key: '/admin', icon: <SettingOutlined />, label: 'Administration',
        children: [
          { key: '/admin/tenants', label: 'Organizations' },
          { key: '/admin/users', label: 'Users' },
          {
            key: '/admin/invitations',
            title: 'Invitations',
            label: (
              <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: 8 }}>
                Invitations
                {pendingInvitationsCount > 0 && <Badge count={pendingInvitationsCount} size="small" />}
              </span>
            ),
          },
          { key: '/admin/activity', label: 'Activity Log' },
          ...(isPlatformAdmin ? [{ key: '/admin/logs', icon: <CodeOutlined />, label: 'System Logs' }] : []),
        ],
      },
    ] : []),
  ];

  const userMenuItems = [
    { key: 'profile', icon: <UserOutlined />, label: 'Profile' },
    { key: 'settings', icon: <SettingOutlined />, label: 'Settings' },
    ...(isDevLogin ? [
      { type: 'divider' as const },
      { key: 'bounce', icon: <SyncOutlined />, label: 'Bounce UI' },
    ] : []),
    { type: 'divider' as const },
    { key: 'logout', icon: <LogoutOutlined />, label: 'Sign Out', danger: true },
  ];

  // Fix Ant Design Menu's broken ARIA references: tooltip portals and submenu panels
  // are lazily rendered so aria-describedby / aria-controls IDs don't exist at check time.
  useEffect(() => {
    const ARIA_ATTRS = ['aria-describedby', 'aria-controls', 'aria-owns'] as const;
    const clean = () => {
      ARIA_ATTRS.forEach((attr) => {
        document.querySelectorAll(`[role="menuitem"][${attr}]`).forEach((el) => {
          const id = el.getAttribute(attr);
          if (id && !document.getElementById(id)) {
            el.removeAttribute(attr);
          }
        });
      });
    };
    clean();
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((m) => ARIA_ATTRS.includes(m.attributeName as any))) clean();
    });
    observer.observe(document.body, { subtree: true, attributeFilter: [...ARIA_ATTRS] });
    return () => observer.disconnect();
  }, []);

  // Track current path for "remember last page" feature
  useEffect(() => {
    if (location.pathname && location.pathname !== '/login') {
      localStorage.setItem('mxsuite_last_path', location.pathname);
    }
  }, [location.pathname]);

  // Auto-open sidebar submenus based on current path
  const [openKeys, setOpenKeys] = useState<string[]>(() => {
    const keys: string[] = [];
    if (location.pathname.startsWith('/plans/my-onboarding')) keys.push('sub:my-onboarding');
    if (location.pathname.startsWith('/plans/onboarding-projects')) keys.push('sub:migration');
    if (location.pathname.startsWith('/admin')) keys.push('/admin');
    return keys;
  });

  useEffect(() => {
    setOpenKeys(prev => {
      const needed: string[] = [];
      if (location.pathname.startsWith('/plans/my-onboarding')) needed.push('sub:my-onboarding');
      if (location.pathname.startsWith('/plans/onboarding-projects')) needed.push('sub:migration');
      if (location.pathname.startsWith('/admin')) needed.push('/admin');
      const merged = new Set([...prev, ...needed]);
      return [...merged];
    });
  }, [location.pathname]);

  // Normalize certain deep paths to their logical sidebar parent for menu highlighting.
  // e.g. /plans/onboarding-projects/projects/123/mappings → highlight "Mappings" not "Projects"
  const normalizePathForMenu = (path: string): string => {
    if (/^\/plans\/onboarding-projects\/projects\/[^/]+\/mappings(\/.*)?$/.test(path)) {
      return '/plans/onboarding-projects/mappings';
    }
    if (/^\/plans\/onboarding-projects\/projects\/[^/]+\/reconciliation(\/.*)?$/.test(path)) {
      return '/plans/onboarding-projects/projects';
    }
    return path;
  };

  // Compute best-matching selectedKey for nested paths
  const allMenuKeys = [
    '/', '/team',
    '/plans/my-onboarding', '/plans/my-onboarding/upload', '/plans/my-onboarding/mappings',
    '/plans/my-onboarding/decisions', '/plans/my-onboarding/data-review', '/plans/my-onboarding/status', '/plans/my-onboarding/activity',
    '/plans/onboarding-projects', '/plans/onboarding-projects/projects', '/plans/onboarding-projects/mappings', '/plans/onboarding-projects/decisions', '/plans/onboarding-projects/approvals',
    '/admin/tenants', '/admin/users', '/admin/invitations', '/admin/assignments', '/admin/activity',
  ];
  const pathForMenu = normalizePathForMenu(location.pathname);
  const selectedKey = allMenuKeys
    .filter((k) => pathForMenu === k || pathForMenu.startsWith(k + '/'))
    .sort((a, b) => b.length - a.length)[0] || pathForMenu;

  // Sidebar content — shared between Sider (desktop) and Drawer (mobile)
  const sidebarContent = (
    <>
      {/* Brand */}
      <div style={{ minHeight: 48, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <img src={platformBranding?.logoUrl || '/growthzone-logo-white.png'}
             alt={platformBranding?.brandName || 'GrowthZone'}
             style={{ height: 32, maxWidth: 200, objectFit: 'contain' }} />
      </div>

      <Menu
        theme="dark"
        mode="inline"
        selectedKeys={[selectedKey]}
        openKeys={openKeys}
        onOpenChange={setOpenKeys}
        items={menuItems}
        onClick={({ key }) => handleMenuClick(key)}
        style={{ borderRight: 0, marginTop: 8 }}
      />
    </>
  );

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* Desktop Sidebar */}
      {!isMobile && (
        <Sider
          trigger={null}
          collapsible
          collapsed={collapsed}
          width={260}
          style={{ background: '#1a0e3a' }}
        >
          {/* Desktop brand with collapse support */}
          <div style={{ minHeight: 48, padding: collapsed ? '12px 4px' : '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <img src={platformBranding?.logoUrl || '/growthzone-logo-white.png'}
                 alt={platformBranding?.brandName || 'GrowthZone'}
                 style={{ height: collapsed ? 24 : 32, maxWidth: collapsed ? 60 : 200, objectFit: 'contain' }} />
          </div>

          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[selectedKey]}
            openKeys={openKeys}
            onOpenChange={setOpenKeys}
            items={menuItems}
            onClick={({ key }) => navigate(key)}
            style={{ borderRight: 0, marginTop: 8 }}
          />
        </Sider>
      )}

      {/* Mobile Drawer */}
      {isMobile && (
        <Drawer
          placement="left"
          onClose={() => setDrawerOpen(false)}
          open={drawerOpen}
          width={260}
          styles={{ body: { padding: 0, background: '#1a0e3a' }, header: { display: 'none' } }}
        >
          {sidebarContent}
        </Drawer>
      )}

      <Layout style={{ overflow: 'visible' }}>
        <Header style={{
          background: '#fff',
          padding: isMobile ? '0 12px' : '0 24px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid #f0f0f0', height: 56,
        }}>
          <Space>
            {isMobile ? (
              <span onClick={() => setDrawerOpen(true)} style={{ cursor: 'pointer', fontSize: 20 }}>
                <MenuOutlined />
              </span>
            ) : (
              <span onClick={() => setCollapsed(!collapsed)} style={{ cursor: 'pointer', fontSize: 18 }}>
                {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              </span>
            )}
            <Text strong style={{ color: '#000000', marginLeft: 8 }}>
              {platformBranding?.brandName || tenant?.name || 'MemberSuite'}
            </Text>
          </Space>

          <Space size={isMobile ? 'middle' : 'large'}>
            <Popover
              open={notifOpen}
              onOpenChange={handleBellOpen}
              trigger="click"
              placement="bottomRight"
              title={
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Notifications</span>
                  {unreadCount > 0 && (
                    <AntButton type="link" size="small" style={{ padding: 0 }} onClick={markAllRead}>
                      Mark all read
                    </AntButton>
                  )}
                </div>
              }
              content={
                <div style={{ width: 340, maxHeight: 400, overflowY: 'auto' }}>
                  {notifications.length === 0 ? (
                    <Empty description="No notifications" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ margin: '16px 0' }} />
                  ) : (
                    <List
                      dataSource={notifications}
                      renderItem={(n: any) => (
                        <List.Item
                          style={{
                            padding: '8px 0',
                            cursor: n.read ? 'default' : 'pointer',
                            backgroundColor: n.read ? 'transparent' : 'rgba(24,144,255,0.04)',
                          }}
                          onClick={() => { if (!n.read) markOneRead(n.id); }}
                        >
                          <List.Item.Meta
                            title={
                              <span style={{ fontWeight: n.read ? 400 : 600, fontSize: 13 }}>
                                {!n.read && <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#1890ff', display: 'inline-block', marginRight: 6 }} />}
                                {n.title}
                              </span>
                            }
                            description={
                              <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
                                {n.message && <span style={{ display: 'block' }}>{n.message}</span>}
                                {new Date(n.createdAt).toLocaleString()}
                              </span>
                            }
                          />
                        </List.Item>
                      )}
                    />
                  )}
                </div>
              }
            >
              <Badge count={unreadCount} size="small" offset={[-2, 2]}>
                <BellOutlined style={{ fontSize: 18, cursor: 'pointer' }} />
              </Badge>
            </Popover>
            <Dropdown menu={{
              items: userMenuItems,
              onClick: ({ key }) => {
                if (key === 'logout') logout();
                else if (key === 'profile') navigate('/profile');
                else if (key === 'settings') navigate('/settings');
                else if (key === 'bounce' && user?.email) {
                  devLogin(user.email).then(() => window.location.reload());
                }
              },
            }} trigger={['click']}>
              <Space style={{ cursor: 'pointer' }}>
                {user?.avatarUrl ? (
                  <Avatar src={user.avatarUrl} />
                ) : (
                  <Avatar style={{ backgroundColor: ROLE_AVATAR_COLORS[user?.role ?? ''] || '#2d1854' }} icon={<UserOutlined />} />
                )}
                {!isMobile && (
                  <div style={{ lineHeight: 1.3 }}>
                    <Text>{user?.firstName} {user?.lastName}</Text>
                    <div>
                      <Text style={{
                        fontSize: 11,
                        color: ROLE_AVATAR_COLORS[user?.role ?? ''] || '#888',
                      }}>
                        {ROLE_SHORT_LABELS[user?.role ?? ''] || user?.role}
                      </Text>
                    </div>
                  </div>
                )}
              </Space>
            </Dropdown>
          </Space>
        </Header>

        <Content style={{
          margin: isMobile ? 8 : 24,
          padding: isMobile ? 12 : 24,
          background: '#fff', borderRadius: 8, minHeight: 360,
        }}>
          {children || <Outlet />}
        </Content>
      </Layout>

      {/* Floating action buttons — Chat + Scroll to top */}
      <div style={{
        position: 'fixed', bottom: 24, right: 24,
        display: 'flex', flexDirection: 'column', gap: 12,
        zIndex: 1000,
      }}>
        {isPlatformUser ? (
          <div
            onClick={() => navigate('/chat')}
            style={{
              width: 48, height: 48, borderRadius: '50%',
              background: '#2d1854', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', fontSize: 22,
              boxShadow: '0 4px 12px rgba(45,24,84,0.4)',
              transition: 'transform 0.2s, box-shadow 0.2s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.1)'; e.currentTarget.style.boxShadow = '0 6px 16px rgba(45,24,84,0.5)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(45,24,84,0.4)'; }}
            title="Chat Dashboard"
            role="button"
            aria-label="Open chat dashboard"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate('/chat'); }}
          >
            <MessageOutlined />
          </div>
        ) : !location.pathname.startsWith('/chat') ? (
          <Suspense fallback={null}>
            <ChatBubble />
          </Suspense>
        ) : null}
        {showScrollTop && (
          <div
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            style={{
              width: 48, height: 48, borderRadius: '50%',
              background: '#fff', color: '#2d1854',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', fontSize: 20,
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              border: '1px solid #e0d4f5',
              transition: 'transform 0.2s, box-shadow 0.2s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.1)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)'; }}
            title="Scroll to top"
          >
            <VerticalAlignTopOutlined />
          </div>
        )}
      </div>

    </Layout>
  );
}
