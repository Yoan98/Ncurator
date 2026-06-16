import React from 'react'
import { Navigate, useLocation, useParams } from 'react-router-dom'
import AppPageHeader from '../components/app/AppPageHeader'
import AppUpdateSettingsPanel from '../components/settings/AppUpdateSettingsPanel'
import ModelSettingsPanel from '../components/settings/ModelSettingsPanel'
import SettingsFloatingMenu from '../components/settings/SettingsFloatingMenu'
import WorkspaceSettingsPanel from '../components/settings/WorkspaceSettingsPanel'
import { SETTINGS_SECTION_META } from '../components/settings/constants'
import type { SettingsSectionValue } from '../components/settings/types'
import { settingsSelectors } from '../testing/selectors'

const normalizeSettingsSection = (value: string | undefined): SettingsSectionValue | null => {
  if (!value) return null
  if (value === 'web-sources') return 'workspace'
  if (value === 'model' || value === 'workspace' || value === 'app') {
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
    <div className="nc-page" data-testid={settingsSelectors.page}>
      <div className="nc-page-inner gap-4">
        <AppPageHeader
          icon={sectionMeta.icon}
          title={sectionMeta.title}
          description={sectionMeta.description}
          navigationMode="back"
          backTo="/"
        />

        <div className="nc-page-body">
          {currentSection === 'workspace' ? <WorkspaceSettingsPanel /> : null}
          {currentSection === 'model' ? <ModelSettingsPanel /> : null}
          {currentSection === 'app' ? <AppUpdateSettingsPanel /> : null}
        </div>
      </div>
      <SettingsFloatingMenu />
    </div>
  )
}

export default SettingsPage
