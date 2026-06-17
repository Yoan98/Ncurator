import React, { useEffect, useMemo, useState } from 'react'
import { NavLink, Navigate, useLocation, useParams } from 'react-router-dom'
import { HiArrowLeft } from 'react-icons/hi2'
import AppUpdateSettingsPanel from '../components/settings/AppUpdateSettingsPanel'
import ModelSettingsPanel from '../components/settings/ModelSettingsPanel'
import VectorModelSettingsPanel from '../components/settings/VectorModelSettingsPanel'
import WorkspaceSettingsPanel from '../components/settings/WorkspaceSettingsPanel'
import { SETTINGS_SECTION_META, SETTINGS_SECTION_ORDER } from '../components/settings/constants'
import type { SettingsSectionValue } from '../components/settings/types'
import { settingsSelectors } from '../testing/selectors'
import WindowsTitleBar from '../components/WindowsTitleBar'

const normalizeSettingsSection = (value: string | undefined): SettingsSectionValue | null => {
  if (!value) return null
  if (value === 'web-sources') return 'workspace'
  if (value === 'model-download') return 'vector'
  if (value === 'model' || value === 'workspace' || value === 'vector' || value === 'app') {
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

const SettingsPage: React.FC = () => {
  const location = useLocation()
  const params = useParams<{ section?: string }>()
  const currentSection = normalizeSettingsSection(params.section)
  const [platform, setPlatform] = useState<string>('darwin')
  const sectionMeta = useMemo(
    () => (currentSection ? SETTINGS_SECTION_META[currentSection] : null),
    [currentSection]
  )

  useEffect(() => {
    setPlatform(navigator.platform.toLowerCase().includes('win') ? 'win32' : 'darwin')
  }, [])

  if (!params.section) {
    return <Navigate to={SETTINGS_SECTION_META[getLegacySection(location.search)].path} replace />
  }

  if (!currentSection || !sectionMeta) {
    return <Navigate to={SETTINGS_SECTION_META.model.path} replace />
  }

  return (
    <div
      className={`nc-app-shell ${platform === 'win32' ? 'nc-app-shell-windows' : ''}`}
      data-testid={settingsSelectors.page}
    >
      {platform === 'win32' ? <WindowsTitleBar /> : null}

      <aside
        className={`nc-sidebar nc-settings-sidebar ${platform === 'darwin' ? 'nc-sidebar-mac' : ''}`}
      >
        <div
          className={`nc-sidebar-window-spacer ${platform === 'darwin' ? 'nc-sidebar-window-spacer-mac' : ''}`}
          aria-hidden="true"
        />

        <div className="flex-1 overflow-y-auto px-2 py-3">
          <NavLink
            to="/"
            className="nc-settings-back-row workbench-no-drag mb-2 flex min-w-0 items-center gap-2"
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
          </div>
        </div>
      </aside>

      <main className="nc-main-pane nc-settings-main-pane min-w-0 flex-1">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 py-5">
          <header className="shrink-0 pb-5">
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
            {currentSection === 'app' ? <AppUpdateSettingsPanel /> : null}
          </div>
        </div>
      </main>
    </div>
  )
}

export default SettingsPage
