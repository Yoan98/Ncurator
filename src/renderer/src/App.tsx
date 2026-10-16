import React from 'react'
import { HashRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { App as AntdApp, Layout, ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import ConversationWorkbenchPage from './pages/ConversationWorkbenchPage'
import SettingsPage from './pages/SettingsPage'
import ModelDownloadPage from './pages/ModelDownloadPage'
import NotificationCenter from './components/NotificationCenter'
import { useWpsIntegrationNotices } from './components/workbench/wpsIntegrationFeedback'
import { AppUpdateProvider } from './contexts/AppUpdateProvider'
import AppWindowFrame from './components/app/AppWindowFrame'
import UpdateRequiredPage from './pages/UpdateRequiredPage'
import type { AppStartupStatus } from '../../shared/types'

dayjs.locale('zh-cn')

const { Content } = Layout
const PENDING_NOTIFICATION_PARTNER_KEY = 'ncurator.pending-notification-partner'

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

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#2F3437',
          colorLink: '#2F3437',
          borderRadius: 6,
          controlHeight: 34,
          controlHeightLG: 40,
          controlHeightSM: 28,
          fontSize: 14,
          fontFamily:
            '"SF Pro Text", "PingFang SC", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
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
        components: {
          Button: {
            primaryShadow: 'none',
            borderRadius: 6,
            controlHeight: 34,
            defaultShadow: 'none'
          },
          Card: {
            borderRadiusLG: 8
          },
          Input: {
            controlHeight: 36,
            activeBorderColor: '#2F3437',
            hoverBorderColor: '#E0DFDC'
          },
          Modal: {
            borderRadiusLG: 8
          },
          Select: {
            activeBorderColor: '#2F3437',
            hoverBorderColor: '#E0DFDC'
          },
          Table: {
            borderColor: '#EEEEEC',
            headerBg: '#FFFFFF',
            headerColor: '#787774',
            rowHoverBg: '#F7F7F5'
          },
          Tag: {
            borderRadiusSM: 6,
            defaultBg: '#F4F4F2',
            defaultColor: '#787774'
          },
          Tooltip: {
            borderRadius: 8,
            fontSize: 12,
            lineHeight: 1.6667,
            paddingSM: 8,
            paddingXS: 6,
            boxShadowSecondary: '0 10px 28px rgba(15, 15, 15, 0.10)'
          }
        }
      }}
    >
      <AntdApp>
        <AppUpdateProvider>
          {!startupStatus ? (
            <AppWindowFrame>
              <div className="h-full bg-white" aria-label="正在启动" />
            </AppWindowFrame>
          ) : startupStatus.mode === 'update_required' ? (
            <AppWindowFrame>
              <UpdateRequiredPage startupStatus={startupStatus} />
            </AppWindowFrame>
          ) : (
            <HashRouter>
              <SystemNotificationNavigationBridge />
              <WpsIntegrationNoticeBridge />
              <AppWindowFrame>
                <MainLayout />
                <NotificationCenter />
              </AppWindowFrame>
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
