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
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          colorText: '#1F1F1F',
          colorTextHeading: '#1F1F1F',
          colorBorder: '#E5E5E4',
          colorBgLayout: '#F5F5F4'
        },
        components: {
          Button: {
            primaryShadow: '0 2px 8px rgba(217, 119, 87, 0.2)',
            borderRadius: 8,
            controlHeight: 40
          },
          Card: {
            borderRadiusLG: 12
          },
          Input: {
            controlHeight: 40,
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
      <Header className="!bg-[#F5F5F4]/80 backdrop-blur-md px-6 flex items-center justify-between sticky top-0 z-20 h-16 border-b border-[#E5E5E4] shadow-sm transition-all">
        <div className="flex items-center gap-4">
          <div
            className="flex items-center gap-3 cursor-pointer group"
            onClick={() => navigate('/')}
          >
            <div className="w-9 h-9 rounded-xl flex items-center justify-center  text-lg shadow-md group-hover:scale-105 transition-transform duration-300">
              <img src={brandIcon} alt="N" className="w-[50px] invert-100" />
            </div>
            <span className="font-bold text-xl tracking-tight text-[#1F1F1F] group-hover:text-[#D97757] transition-colors">
              馆长
            </span>
          </div>

          {!isWorkbenchPage ? (
            <Button
              type="text"
              icon={<HiOutlineHome className="w-5 h-5" />}
              onClick={() => navigate('/')}
              className="ml-2 text-[#666666] hover:bg-black/5 hover:text-[#1F1F1F]"
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
              className="!border-[#E5E5E4] !text-[#666666] hover:!border-[#D97757] hover:!text-[#D97757] !rounded-lg"
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
          <Route path="/import" element={<Navigate to="/settings?tab=workspace" replace />} />
          <Route path="/test" element={<TestPage />} />
        </Routes>
      </Content>
      <NotificationCenter />
    </Layout>
  )
}

export default App
