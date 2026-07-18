import React, { useEffect, useMemo, useState } from 'react'
import { NavLink, Navigate, useLocation, useParams } from 'react-router-dom'
import { HiArrowLeft, HiOutlineQuestionMarkCircle } from 'react-icons/hi2'
import { USER_MANUAL_URL } from '../../../shared/constants'
import ModelSettingsPanel from '../components/settings/ModelSettingsPanel'
import VectorModelSettingsPanel from '../components/settings/VectorModelSettingsPanel'
import WorkspaceSettingsPanel from '../components/settings/WorkspaceSettingsPanel'
import { SETTINGS_SECTION_META, SETTINGS_SECTION_ORDER } from '../components/settings/constants'
import type { SettingsSectionValue } from '../components/settings/types'
import { settingsSelectors } from '../testing/selectors'
import SidebarPanelIcon from '../components/SidebarPanelIcon'
import {
  WORKBENCH_SIDEBAR_DEFAULT_WIDTH,
  WORKBENCH_SIDEBAR_MAX_WIDTH,
  WORKBENCH_SIDEBAR_MIN_WIDTH,
  WORKBENCH_SIDEBAR_WIDTH_STORAGE_KEY
} from '../components/workbench/constants'

const normalizeSettingsSection = (value: string | undefined): SettingsSectionValue | null => {
  if (!value) return null
  if (value === 'web-sources') return 'workspace'
  if (value === 'model-download') return 'vector'
  if (value === 'model' || value === 'workspace' || value === 'vector') {
    return value
  }
  return null
}

const getLegacySection = (search: string): SettingsSectionValue => {
  const params = new URLSearchParams(search)
  const tab = params.get('tab')
  if (tab === 'workspace') return 'workspace'
  return 'model'
}

const clampSettingsSidebarWidth = (width: number): number =>
  Math.min(WORKBENCH_SIDEBAR_MAX_WIDTH, Math.max(WORKBENCH_SIDEBAR_MIN_WIDTH, width))

const detectRendererPlatform = (): string =>
  navigator.platform.toLowerCase().includes('win') ? 'win32' : 'darwin'

const SettingsPage: React.FC = () => {
  const location = useLocation()
  const params = useParams<{ section?: string }>()
  const currentSection = normalizeSettingsSection(params.section)
  const [platform, setPlatform] = useState<string>(() => detectRendererPlatform())
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarWidth] = useState<number>(() => {
    const stored = window.localStorage.getItem(WORKBENCH_SIDEBAR_WIDTH_STORAGE_KEY)
    return clampSettingsSidebarWidth(stored ? Number(stored) : WORKBENCH_SIDEBAR_DEFAULT_WIDTH)
  })
  const sectionMeta = useMemo(
    () => (currentSection ? SETTINGS_SECTION_META[currentSection] : null),
    [currentSection]
  )

  useEffect(() => {
    setPlatform(detectRendererPlatform())
  }, [])

  if (!params.section) {
    return <Navigate to={SETTINGS_SECTION_META[getLegacySection(location.search)].path} replace />
  }

  if (!currentSection || !sectionMeta) {
    return <Navigate to={SETTINGS_SECTION_META.model.path} replace />
  }

  return (
    <div className="nc-app-shell" data-testid={settingsSelectors.page}>
      <div
        className="nc-left-titlebar-chrome nc-settings-left-titlebar-chrome"
        style={{ width: sidebarWidth }}
      >
        {platform === 'darwin' ? <div className="nc-left-titlebar-window-controls" /> : null}
        {platform === 'win32' ? (
          <button
            type="button"
            className="nc-sidebar-titlebar-toggle nc-sidebar-titlebar-toggle-chrome workbench-no-drag"
            onClick={() => setSidebarCollapsed((previous) => !previous)}
            data-testid={settingsSelectors.sidebarToggle}
            aria-label={sidebarCollapsed ? '展开设置侧边栏' : '收起设置侧边栏'}
          >
            <SidebarPanelIcon
              className="h-4 w-4"
              variant={sidebarCollapsed ? 'expand' : 'collapse'}
            />
          </button>
        ) : null}
        <div className="nc-left-titlebar-drag" data-testid={settingsSelectors.sidebarDragRegion} />
      </div>

      <aside
        className={`nc-sidebar nc-settings-sidebar ${platform === 'darwin' ? 'nc-sidebar-mac' : ''} ${sidebarCollapsed ? 'nc-sidebar-hidden' : ''}`}
        style={{
          width: sidebarWidth,
          minWidth: sidebarCollapsed ? 0 : sidebarWidth,
          flexBasis: sidebarWidth
        }}
        data-testid={settingsSelectors.sidebar}
      >
        {platform === 'darwin' ? (
          <div className="nc-sidebar-window-spacer" aria-hidden="true" />
        ) : null}

        <div className="flex-1 overflow-y-auto px-2 py-3">
          <NavLink
            to="/"
            className="nc-settings-back-row workbench-no-drag mb-2 flex min-w-0 items-center gap-2"
            data-testid={settingsSelectors.backRow}
          >
            <HiArrowLeft className="h-[18px] w-[18px] shrink-0 text-[#787774]" />
            <span className="truncate text-[13px] font-medium text-[#37352F]">返回工作台</span>
          </NavLink>
          <div className="px-2 pb-2 text-[12px] font-medium text-[#9B9A97]">设置</div>
          <div className="space-y-1">
            {SETTINGS_SECTION_ORDER.map((section) => {
              const item = SETTINGS_SECTION_META[section]
              return (
                <NavLink
                  key={item.value}
                  to={item.path}
                  className={({ isActive }) =>
                    `nc-sidebar-item flex items-center gap-2.5 px-2.5 py-2 ${
                      isActive ? 'nc-sidebar-item-active' : ''
                    }`
                  }
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[#787774]">
                    {item.icon}
                  </span>
                  <span className="truncate text-[13px] font-medium">{item.label}</span>
                </NavLink>
              )
            })}
            <button
              type="button"
              className="nc-sidebar-item flex items-center gap-2.5 px-2.5 py-2"
              onClick={() => void window.api.openExternal(USER_MANUAL_URL)}
              aria-label="查看使用帮助"
              data-testid={settingsSelectors.helpButton}
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[#787774]">
                <HiOutlineQuestionMarkCircle className="h-5 w-5" />
              </span>
              <span className="truncate text-[13px] font-medium">使用帮助</span>
            </button>
          </div>
        </div>
      </aside>

      <main className="nc-main-pane nc-settings-main-pane min-w-0 flex-1">
        <div
          className="nc-settings-main-titlebar-drag"
          data-testid={settingsSelectors.mainDragRegion}
          aria-hidden="true"
        />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 py-5">
          <header className="nc-settings-header shrink-0 pb-5">
            <div className="flex items-center gap-2 text-[#37352F]">
              <span className="flex h-8 w-8 items-center justify-center rounded-[6px] border border-[#EEEEEC] bg-white text-[#787774]">
                {sectionMeta.icon}
              </span>
              <div className="min-w-0">
                <h1 className="m-0 truncate text-[22px] font-semibold tracking-tight">
                  {sectionMeta.title}
                </h1>
                <div className="mt-0.5 truncate text-[12px] text-[#787774]">
                  {sectionMeta.description}
                </div>
              </div>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-hidden">
            {currentSection === 'workspace' ? <WorkspaceSettingsPanel /> : null}
            {currentSection === 'model' ? <ModelSettingsPanel /> : null}
            {currentSection === 'vector' ? <VectorModelSettingsPanel /> : null}
          </div>
        </div>
      </main>
    </div>
  )
}

export default SettingsPage
