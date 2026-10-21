import { t, getManualUrl } from '../i18n'
import React, { useEffect, useMemo, useState } from 'react'
import { ConfigProvider, Modal, message } from 'antd'
import { NavLink, Navigate, useLocation, useParams } from 'react-router-dom'
import { HiArrowLeft, HiOutlineQuestionMarkCircle } from 'react-icons/hi2'

import ModelSettingsPanel from '../components/settings/ModelSettingsPanel'
import VectorModelSettingsPanel from '../components/settings/VectorModelSettingsPanel'
import WorkspaceSettingsPanel from '../components/settings/WorkspaceSettingsPanel'
import GeneralSettingsPanel from '../components/settings/GeneralSettingsPanel'
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
  if (value === 'general' || value === 'model' || value === 'workspace' || value === 'vector') {
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
  const [helpUrl, setHelpUrl] = useState<string | null>(null)
  const [openingHelp, setOpeningHelp] = useState(false)
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

  const openHelpWebsite = async (): Promise<void> => {
    if (!helpUrl || openingHelp) return
    setOpeningHelp(true)
    try {
      const result = await window.api.openExternal(helpUrl)
      if (!result.success) throw new Error('open_external_failed')
      setHelpUrl(null)
    } catch {
      message.error(t(($) => $.settings.couldNotOpenHelpWebsite))
    } finally {
      setOpeningHelp(false)
    }
  }

  if (!params.section) {
    return <Navigate to={SETTINGS_SECTION_META[getLegacySection(location.search)].path} replace />
  }

  if (!currentSection || !sectionMeta) {
    return <Navigate to={SETTINGS_SECTION_META.model.path} replace />
  }

  return (
    <ConfigProvider
      theme={{
        token: { controlHeight: 32 },
        components: { Button: { controlHeight: 32 }, Input: { controlHeight: 32 } }
      }}
    >
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
              aria-label={
                sidebarCollapsed
                  ? t(($) => $.settings.expandSettingsSidebar)
                  : t(($) => $.settings.collapseSettingsSidebar)
              }
            >
              <SidebarPanelIcon
                className="h-4 w-4"
                variant={sidebarCollapsed ? 'expand' : 'collapse'}
              />
            </button>
          ) : null}
          <div
            className="nc-left-titlebar-drag"
            data-testid={settingsSelectors.sidebarDragRegion}
          />
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
              <span className="truncate text-[13px] font-medium text-[#37352F]">
                {t(($) => $.settings.backToWorkbench)}
              </span>
            </NavLink>
            <div className="px-2 pb-2 text-[12px] font-medium text-[#9B9A97]">
              {t(($) => $.common.settings)}
            </div>
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
                onClick={() => setHelpUrl(getManualUrl())}
                aria-label={t(($) => $.common.viewHelp)}
                data-testid={settingsSelectors.helpButton}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[#787774]">
                  <HiOutlineQuestionMarkCircle className="h-5 w-5" />
                </span>
                <span className="truncate text-[13px] font-medium">
                  {t(($) => $.settings.userHelp)}
                </span>
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
          <div className="nc-settings-content-frame">
            <div className="nc-settings-content">
              <header className="nc-settings-header">
                <h1>{sectionMeta.title}</h1>
                <p>{sectionMeta.description}</p>
              </header>

              <div className="min-h-0 flex-1 overflow-hidden">
                {currentSection === 'general' ? <GeneralSettingsPanel /> : null}
                {currentSection === 'workspace' ? <WorkspaceSettingsPanel /> : null}
                {currentSection === 'model' ? <ModelSettingsPanel /> : null}
                {currentSection === 'vector' ? <VectorModelSettingsPanel /> : null}
              </div>
            </div>
          </div>
        </main>
        <Modal
          title={t(($) => $.settings.openHelpWebsiteTitle)}
          open={helpUrl !== null}
          onOk={() => void openHelpWebsite()}
          onCancel={() => setHelpUrl(null)}
          okText={t(($) => $.settings.openHelpWebsite)}
          cancelText={t(($) => $.common.cancel)}
          confirmLoading={openingHelp}
          cancelButtonProps={{ disabled: openingHelp }}
          closable={!openingHelp}
          maskClosable={!openingHelp}
          keyboard={!openingHelp}
          width={460}
        >
          <p className="text-[14px] leading-6 text-[#787774]">
            {t(($) => $.settings.openHelpWebsiteDescription)}
          </p>
          <div className="break-all rounded-[6px] bg-[#F4F4F2] px-3 py-2 text-[13px] text-[#37352F]">
            {helpUrl}
          </div>
        </Modal>
      </div>
    </ConfigProvider>
  )
}

export default SettingsPage
