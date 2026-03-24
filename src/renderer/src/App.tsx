import React from 'react'
import { HashRouter, Routes, Route, useLocation, useNavigate, Navigate } from 'react-router-dom'
import { Layout, ConfigProvider, theme, Button, Dropdown } from 'antd'
import {
  HiOutlineCog6Tooth,
  HiOutlineBeaker,
  HiCloudArrowDown,
  HiOutlineHome
} from 'react-icons/hi2'
import ConversationWorkbenchPage from './pages/ConversationWorkbenchPage'
import SettingsPage from './pages/SettingsPage'
import TestPage from './pages/TestPage'
import ModelDownloadPage from './pages/ModelDownloadPage'
import NotificationCenter from './components/NotificationCenter'
import brandIcon from '../../../resources/icon.png'

const { Header, Content } = Layout

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

const MainLayout: React.FC = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const isWorkbenchPage = location.pathname === '/'

  return (
    <Layout className="min-h-screen bg-[#F5F5F4]">
      <Header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-[#E5E5E4] !bg-[#F5F5F4]/88 px-5 backdrop-blur-md transition-all">
        <div className="flex items-center gap-4">
          <div
            className="flex items-center gap-3 cursor-pointer group"
            onClick={() => navigate('/')}
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#E5E5E4] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-transform duration-300 group-hover:scale-105">
              <img src={brandIcon} alt="N" className="w-[50px] invert-100" />
            </div>
            <span className="text-lg font-semibold tracking-tight text-[#1F1F1F] transition-colors group-hover:text-[#D97757]">
              馆长
            </span>
          </div>

          {!isWorkbenchPage ? (
            <Button
              type="text"
              icon={<HiOutlineHome className="w-5 h-5" />}
              onClick={() => navigate('/')}
              className="ml-1 text-[#666666] hover:bg-black/5 hover:text-[#1F1F1F]"
            />
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          <Dropdown
            trigger={['hover', 'click']}
            placement="bottomRight"
            menu={{
              items: [
                {
                  key: 'settings',
                  label: '设置',
                  icon: <HiOutlineCog6Tooth className="w-4 h-4" />
                },
                {
                  key: 'model-download',
                  label: '向量模型',
                  icon: <HiCloudArrowDown className="w-4 h-4" />
                },
                { key: 'test', label: '实验室', icon: <HiOutlineBeaker className="w-4 h-4" /> }
              ],
              onClick: (info) => {
                if (info.key === 'settings') navigate('/settings')
                if (info.key === 'model-download') navigate('/model-download')
                if (info.key === 'test') navigate('/test')
              }
            }}
          >
            <Button
              icon={<HiOutlineCog6Tooth className="w-5 h-5" />}
              className="!rounded-xl !border-[#E5E5E4] !bg-white !text-[#666666] hover:!border-[#D97757] hover:!text-[#D97757]"
            />
          </Dropdown>
        </div>
      </Header>
      <Content className="bg-[#F5F5F4] overflow-auto">
        <Routes>
          <Route path="/" element={<ConversationWorkbenchPage />} />
          <Route path="/chat" element={<Navigate to="/" replace />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/model-download" element={<ModelDownloadPage />} />
          <Route path="/test" element={<TestPage />} />
        </Routes>
      </Content>
      <NotificationCenter />
    </Layout>
  )
}

export default App
