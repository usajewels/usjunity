import type { ThemeConfig } from 'antd';

export const mxsuiteTheme: ThemeConfig = {
  token: {
    colorPrimary: '#2ecda7',
    colorSuccess: '#52c41a',
    colorWarning: '#faad14',
    colorError: '#ff4d4f',
    colorInfo: '#2ecda7',
    colorBgLayout: '#f6f3fb',
    colorBgContainer: '#ffffff',
    borderRadius: 6,
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    fontSize: 14,
    colorLink: '#2ecda7',
    colorLinkHover: '#5ddbb8',
    controlHeight: 36,
  },
  components: {
    Layout: {
      siderBg: '#1a0e3a',
      headerBg: '#ffffff',
      headerHeight: 56,
      headerPadding: '0 24px',
    },
    Menu: {
      darkItemBg: '#1a0e3a',
      darkItemSelectedBg: '#6b4fa0',
      darkSubMenuItemBg: '#1a0e3a',
      itemHeight: 44,
    },
    Button: {
      primaryShadow: '0 2px 4px rgba(46, 205, 167, 0.25)',
    },
    Card: {
      headerFontSize: 16,
      paddingLG: 24,
    },
    Table: {
      headerBg: '#ece4fc',
      headerColor: '#2d1854',
      rowHoverBg: '#f3eeff',
      headerSortActiveBg: '#e0d4f5',
      headerSortHoverBg: '#e0d4f5',
      headerFilterHoverBg: '#e0d4f5',
    },
    Tabs: {
      inkBarColor: '#2d1854',
      itemSelectedColor: '#2d1854',
    },
  },
};
