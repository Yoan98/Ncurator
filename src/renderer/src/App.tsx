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
          colorPrimary: '#D97757',
          colorLink: '#D97757',
          borderRadius: 8,
          controlHeight: 36,
          controlHeightLG: 40,
          controlHeightSM: 28,
          fontSize: 14,
          fontFamily:
            '"SF Pro Text", "PingFang SC", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          colorText: '#1F1F1F',
          colorTextHeading: '#1F1F1F',
          colorBorder: '#E5E5E4',
          colorBgLayout: '#F5F5F4'
        },
        components: {
          Button: {
            primaryShadow: '0 2px 8px rgba(217, 119, 87, 0.2)',
            borderRadius: 10,
            controlHeight: 36
          },
          Card: {
            borderRadiusLG: 12
          },
          Input: {
            controlHeight: 38,
            activeBorderColor: '#D97757',
            hoverBorderColor: '#C66A4A'
          },
          Select: {
            activeBorderColor: '#D97757',
            hoverBorderColor: '#C66A4A'
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
  <Layout className="min-h-screen bg-[#F5F5F4]">
    <Content className="overflow-auto bg-[#F5F5F4]">
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
