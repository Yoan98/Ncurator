import React from 'react'
import { Navigate, useLocation, useParams } from 'react-router-dom'
import AppPageHeader from '../components/app/AppPageHeader'
import ModelSettingsPanel from '../components/settings/ModelSettingsPanel'
import SettingsFloatingMenu from '../components/settings/SettingsFloatingMenu'
import WorkspaceSettingsPanel from '../components/settings/WorkspaceSettingsPanel'
import { SETTINGS_SECTION_META } from '../components/settings/constants'
import type { SettingsSectionValue } from '../components/settings/types'
import { settingsSelectors } from '../testing/selectors'

const normalizeSettingsSection = (value: string | undefined): SettingsSectionValue | null => {
  if (!value) return null
  if (value === 'web-sources') return 'workspace'
  if (value === 'model' || value === 'workspace') {
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

  if (!params.section) {
    return <Navigate to={SETTINGS_SECTION_META[getLegacySection(location.search)].path} replace />
  }

  if (!currentSection) {
    return <Navigate to={SETTINGS_SECTION_META.model.path} replace />
  }

  const sectionMeta = SETTINGS_SECTION_META[currentSection]

  return (
    <div className="h-screen overflow-hidden bg-[#F6F5F1]" data-testid={settingsSelectors.page}>
      <div className="mx-auto flex h-full w-full max-w-[1320px] flex-col gap-4 px-5 py-5 lg:px-6">
        <AppPageHeader
          icon={sectionMeta.icon}
          title={sectionMeta.title}
          description={sectionMeta.description}
          navigationMode="back"
          backTo="/"
        />

        <div className="min-h-0 flex-1 overflow-hidden pb-4 pr-1">
          {currentSection === 'workspace' ? <WorkspaceSettingsPanel /> : null}
          {currentSection === 'model' ? <ModelSettingsPanel /> : null}
        </div>
      </div>
      <SettingsFloatingMenu />
    </div>
  )
}

export default SettingsPage
