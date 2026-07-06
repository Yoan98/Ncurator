import React from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { App as AntdApp, Layout, ConfigProvider, theme } from 'antd'
import ConversationWorkbenchPage from './pages/ConversationWorkbenchPage'
import SettingsPage from './pages/SettingsPage'
import TestPage from './pages/TestPage'
import ModelDownloadPage from './pages/ModelDownloadPage'
import NotificationCenter from './components/NotificationCenter'

const { Content } = Layout

function App(): React.JSX.Element {
  return (
    <ConfigProvider
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
          }
        }
      }}
    >
      <AntdApp>
        <HashRouter>
          <MainLayout />
          <NotificationCenter />
        </HashRouter>
      </AntdApp>
    </ConfigProvider>
  )
}

const MainLayout: React.FC = () => (
  <Layout className="min-h-screen bg-[var(--notion-canvas)]">
    <Content className="overflow-auto bg-[var(--notion-canvas)]">
      <Routes>
        <Route path="/" element={<ConversationWorkbenchPage />} />
        <Route path="/chat" element={<Navigate to="/" replace />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/:section" element={<SettingsPage />} />
        <Route path="/model-download" element={<ModelDownloadPage />} />
        <Route path="/test" element={<TestPage />} />
      </Routes>
    </Content>
  </Layout>
)

export default App
