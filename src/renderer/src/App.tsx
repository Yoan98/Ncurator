import React from 'react'
import { HashRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { App as AntdApp, Layout, ConfigProvider, theme, type ThemeConfig } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import enUS from 'antd/locale/en_US'
import { getRendererRuntime } from './i18n'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import ConversationWorkbenchPage from './pages/ConversationWorkbenchPage'
import SettingsPage from './pages/SettingsPage'
import ModelDownloadPage from './pages/ModelDownloadPage'
import NotificationCenter from './components/NotificationCenter'
import { useWpsIntegrationNotices } from './components/workbench/wpsIntegrationFeedback'
import { AppUpdateProvider } from './contexts/AppUpdateProvider'
import { AppearanceProvider } from './contexts/AppearanceProvider'
import { useAppearance } from './contexts/AppearanceContext'
import { DesktopAccountProvider } from './contexts/DesktopAccountProvider'
import AppWindowFrame from './components/app/AppWindowFrame'
import UpdateRequiredPage from './pages/UpdateRequiredPage'
import type { AppStartupStatus } from '../../shared/types'

dayjs.locale(getRendererRuntime().locale === 'zh-CN' ? 'zh-cn' : 'en')

const { Content } = Layout
const PENDING_NOTIFICATION_PARTNER_KEY = 'ncurator.pending-notification-partner'

/** antd 5 的 token 只接受具体色值，因此按明暗各给一套；变量用于自研 CSS，这里不能直接用。 */
const ANT_THEME_TOKENS = {
  light: {
    colorPrimary: '#2F3437',
    colorTextLightSolid: '#FFFFFF',
    colorLink: '#0B6BCB',
    colorText: '#37352F',
    colorTextHeading: '#37352F',
    colorTextSecondary: '#787774',
    colorTextTertiary: '#9B9A97',
    colorBorder: '#EEEEEC',
    colorBorderSecondary: '#EEEEEC',
    colorBgBase: '#FFFFFF',
    colorBgContainer: '#FFFFFF',
    colorBgElevated: '#FFFFFF',
    colorBgLayout: '#FFFFFF',
    colorFillAlter: '#F7F7F5',
    colorFillSecondary: '#F4F4F2',
    colorFillTertiary: '#EFEFED'
  },
  dark: {
    colorPrimary: '#E6E6E6',
    /* 暗色主色是浅底，其上的文字必须是深色；antd 默认仍给白字，导致对比度约 1.2。 */
    colorTextLightSolid: '#1A1A1A',
    colorPrimaryHover: '#F0F0F0',
    colorPrimaryActive: '#D8D8D8',
    colorLink: '#5AA9F0',
    colorText: '#D4D4D4',
    colorTextHeading: '#D4D4D4',
    colorTextSecondary: '#9A9A97',
    colorTextTertiary: '#7A7A76',
    colorBorder: '#2F2F2F',
    colorBorderSecondary: '#2F2F2F',
    colorBgBase: '#191919',
    colorBgContainer: '#191919',
    colorBgElevated: '#252525',
    colorBgLayout: '#191919',
    colorFillAlter: '#141414',
    colorFillSecondary: '#252525',
    colorFillTertiary: '#2C2C2C'
  }
} as const

const buildAntdTheme = (resolved: 'light' | 'dark'): ThemeConfig => {
  const isDark = resolved === 'dark'
  return {
    algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      ...ANT_THEME_TOKENS[resolved],
      borderRadius: 6,
      controlHeight: 34,
      controlHeightLG: 40,
      controlHeightSM: 28,
      fontSize: 14,
      fontFamily:
        '"SF Pro Text", "PingFang SC", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    },
    components: {
      Button: { primaryShadow: 'none', borderRadius: 6, controlHeight: 34, defaultShadow: 'none' },
      Card: { borderRadiusLG: 8 },
      Input: {
        controlHeight: 36,
        activeBorderColor: isDark ? '#5AA9F0' : '#2F3437',
        hoverBorderColor: isDark ? '#3D3D3D' : '#E0DFDC'
      },
      Modal: { borderRadiusLG: 8 },
      Select: {
        activeBorderColor: isDark ? '#5AA9F0' : '#2F3437',
        hoverBorderColor: isDark ? '#3D3D3D' : '#E0DFDC'
      },
      Table: {
        borderColor: isDark ? '#2F2F2F' : '#EEEEEC',
        headerBg: isDark ? '#191919' : '#FFFFFF',
        headerColor: isDark ? '#9A9A97' : '#787774',
        rowHoverBg: isDark ? '#252525' : '#F7F7F5'
      },
      Tag: {
        borderRadiusSM: 6,
        defaultBg: isDark ? '#252525' : '#F4F4F2',
        defaultColor: isDark ? '#9A9A97' : '#787774'
      },
      Tooltip: {
        borderRadius: 8,
        fontSize: 12,
        lineHeight: 1.6667,
        paddingSM: 8,
        paddingXS: 6,
        boxShadowSecondary: isDark
          ? '0 10px 28px rgba(0, 0, 0, 0.6)'
          : '0 10px 28px rgba(15, 15, 15, 0.10)'
      }
    }
  }
}

const WpsIntegrationNoticeBridge: React.FC = () => {
  useWpsIntegrationNotices()
  return null
}

const SystemNotificationNavigationBridge: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    return window.api.onSystemNotificationOpenPartner((partnerId) => {
      if (location.pathname === '/') return
      window.sessionStorage.setItem(PENDING_NOTIFICATION_PARTNER_KEY, partnerId)
      navigate('/')
    })
  }, [location.pathname, navigate])

  return null
}

function App(): React.JSX.Element {
  const [startupStatus, setStartupStatus] = useState<AppStartupStatus | null>(null)

  useEffect(() => {
    let mounted = true
    window.api
      .appStartupGetStatus()
      .then((status) => {
        if (mounted) setStartupStatus(status)
      })
      .catch((error) => console.error('Failed to read app startup status', error))
    return () => {
      mounted = false
    }
  }, [])

  if (!startupStatus) return <div className="h-full bg-[var(--notion-canvas)]" />

  return (
    <AppearanceProvider initialTheme={startupStatus.theme}>
      <AppProviders startupStatus={startupStatus} />
    </AppearanceProvider>
  )
}

const AppProviders: React.FC<{ startupStatus: AppStartupStatus }> = ({ startupStatus }) => {
  const { resolved } = useAppearance()
  const antdTheme = useMemo(() => buildAntdTheme(resolved), [resolved])

  return (
    <ConfigProvider
      locale={getRendererRuntime().locale === 'zh-CN' ? zhCN : enUS}
      theme={antdTheme}
    >
      <AntdApp>
        <AppUpdateProvider>
          {startupStatus.mode === 'update_required' ? (
            <AppWindowFrame>
              <UpdateRequiredPage startupStatus={startupStatus} />
            </AppWindowFrame>
          ) : (
            <HashRouter>
              <SystemNotificationNavigationBridge />
              <WpsIntegrationNoticeBridge />
              <DesktopAccountProvider>
                <AppWindowFrame>
                  <MainLayout />
                  <NotificationCenter />
                </AppWindowFrame>
              </DesktopAccountProvider>
            </HashRouter>
          )}
        </AppUpdateProvider>
      </AntdApp>
    </ConfigProvider>
  )
}

const MainLayout: React.FC = () => (
  <Layout className="h-full min-h-0 bg-[var(--notion-canvas)]">
    <Content className="h-full min-h-0 overflow-hidden bg-[var(--notion-canvas)]">
      <Routes>
        <Route path="/" element={<ConversationWorkbenchPage />} />
        <Route path="/chat" element={<Navigate to="/" replace />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/:section" element={<SettingsPage />} />
        <Route path="/model-download" element={<ModelDownloadPage />} />
      </Routes>
    </Content>
  </Layout>
)

export default App
