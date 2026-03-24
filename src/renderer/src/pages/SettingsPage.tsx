import React, { useMemo } from 'react'
import { Segmented } from 'antd'
import { HiCog6Tooth, HiOutlineRectangleStack } from 'react-icons/hi2'
import ModelSettingsPanel from '../components/settings/ModelSettingsPanel'
import WorkspaceSettingsPanel from '../components/settings/WorkspaceSettingsPanel'
import { SETTINGS_TABS } from '../components/settings/constants'
import type { SettingsTabValue } from '../components/settings/types'
import { settingsSelectors } from '../testing/selectors'

const getInitialTab = (): SettingsTabValue => {
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '')
  const tab = params.get('tab')
  return tab === 'workspace' ? 'workspace' : 'model'
}

const SettingsPage: React.FC = () => {
  const [activeTab, setActiveTab] = React.useState<SettingsTabValue>(getInitialTab)

  const activeMeta = useMemo(
    () =>
      activeTab === 'workspace'
        ? {
            icon: <HiOutlineRectangleStack className="h-5 w-5" />,
            title: 'Workspace 设置',
            description: '管理工作空间、网页资料和本地优先上下文。'
          }
        : {
            icon: <HiCog6Tooth className="h-5 w-5" />,
            title: '模型设置',
            description: '配置模型服务、API Key 和当前默认执行入口。'
          },
    [activeTab]
  )

  const handleTabChange = (value: string): void => {
    const nextTab = value === 'workspace' ? 'workspace' : 'model'
    setActiveTab(nextTab)
    const url = new URL(window.location.href)
    url.hash = `#/settings?tab=${nextTab}`
    window.history.replaceState(null, '', url.toString())
  }

  return (
    <div className="min-h-full bg-[#F5F5F4] px-6 py-8" data-testid={settingsSelectors.page}>
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <section className="flex flex-col gap-5 rounded-[28px] border border-[#E5E5E4] bg-white/70 px-7 py-6 shadow-[0_2px_8px_rgba(0,0,0,0.04)] backdrop-blur-sm lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#F4E5DF] bg-[#FBF5F2] px-3 py-1 text-[12px] font-medium text-[#D97757]">
              {activeMeta.icon}
              Settings
            </div>
            <h1 className="text-[30px] font-semibold tracking-tight text-[#1F1F1F]">{activeMeta.title}</h1>
            <p className="mt-3 text-base leading-relaxed text-[#666666]">{activeMeta.description}</p>
          </div>

          <Segmented
            value={activeTab}
            onChange={(value) => handleTabChange(String(value))}
            options={SETTINGS_TABS.map((item) => ({
              label: item.label,
              value: item.value
            }))}
            className="bg-[#F5F5F4]"
            size="large"
            data-testid={settingsSelectors.tabSwitch}
          />
        </section>

        <div>
          {activeTab === 'workspace' ? <WorkspaceSettingsPanel /> : <ModelSettingsPanel />}
        </div>
      </div>
    </div>
  )
}

export default SettingsPage
