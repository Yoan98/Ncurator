import React from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Layout, ConfigProvider, theme } from 'antd'
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
          colorPrimary: '#181818',
          colorLink: '#181818',
          borderRadius: 10,
          controlHeight: 36,
          controlHeightLG: 40,
          controlHeightSM: 28,
          fontSize: 14,
          fontFamily:
            '"SF Pro Text", "PingFang SC", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          colorText: '#181818',
          colorTextHeading: '#181818',
          colorBorder: '#E1DED6',
          colorBgLayout: '#F6F5F1'
        },
        components: {
          Button: {
            primaryShadow: '0 2px 8px rgba(24, 24, 24, 0.12)',
            borderRadius: 10,
            controlHeight: 36,
            defaultShadow: 'none'
          },
          Card: {
            borderRadiusLG: 18
          },
          Input: {
            controlHeight: 38,
            activeBorderColor: '#181818',
            hoverBorderColor: '#3F3F3D'
          },
          Modal: {
            borderRadiusLG: 24
          },
          Select: {
            activeBorderColor: '#181818',
            hoverBorderColor: '#3F3F3D'
          }
        }
      }}
    >
      <HashRouter>
        <MainLayout />
      </HashRouter>
    </ConfigProvider>
  )
}

const MainLayout: React.FC = () => (
  <Layout className="min-h-screen bg-[var(--ink-canvas)]">
    <Content className="overflow-auto bg-[var(--ink-canvas)]">
      <Routes>
        <Route path="/" element={<ConversationWorkbenchPage />} />
        <Route path="/chat" element={<Navigate to="/" replace />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/:section" element={<SettingsPage />} />
        <Route path="/model-download" element={<ModelDownloadPage />} />
        <Route path="/test" element={<TestPage />} />
      </Routes>
    </Content>
    <NotificationCenter />
  </Layout>
)

export default App
