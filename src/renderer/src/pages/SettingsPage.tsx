import React from 'react'
import { Navigate, useLocation, useParams } from 'react-router-dom'
import AppPageHeader from '../components/app/AppPageHeader'
import ModelSettingsPanel from '../components/settings/ModelSettingsPanel'
import SettingsMenuButton from '../components/settings/SettingsMenuButton'
import WebSourcesSettingsPanel from '../components/settings/WebSourcesSettingsPanel'
import WorkspaceSettingsPanel from '../components/settings/WorkspaceSettingsPanel'
import { SETTINGS_SECTION_META } from '../components/settings/constants'
import type { SettingsSectionValue } from '../components/settings/types'
import { settingsSelectors } from '../testing/selectors'

const normalizeSettingsSection = (value: string | undefined): SettingsSectionValue | null => {
  if (!value) return null
  if (value === 'model' || value === 'workspace' || value === 'web-sources') {
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
    <div
      className="h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(251,245,242,0.95),_rgba(245,245,244,0.92)_42%,_#F5F5F4_72%)]"
      data-testid={settingsSelectors.page}
    >
      <div className="mx-auto flex h-full w-full max-w-[1360px] flex-col gap-5 px-5 py-5 lg:px-6">
        <AppPageHeader
          icon={sectionMeta.icon}
          title={sectionMeta.title}
          description={sectionMeta.description}
          navigationMode="back"
          backTo="/"
          actions={<SettingsMenuButton className="!h-10 !w-10 !rounded-xl !px-0" />}
        />

        <div className="min-h-0 flex-1 overflow-hidden pb-4 pr-1">
          {currentSection === 'workspace' ? <WorkspaceSettingsPanel /> : null}
          {currentSection === 'model' ? <ModelSettingsPanel /> : null}
          {currentSection === 'web-sources' ? <WebSourcesSettingsPanel /> : null}
        </div>
      </div>
    </div>
  )
}

export default SettingsPage
