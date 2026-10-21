import { normalizeUserFacingError } from '../../utils/userFacingError'
import React, { useEffect, useState } from 'react'
import { Select, Switch, message } from 'antd'
import { useTranslation } from 'react-i18next'
import { updateRendererRoute, appSettingsErrorText } from '../../i18n'
import FileIcon from '../FileIcon'
import type { AppSettings } from '../../../../shared/types'
import { settingsSelectors } from '../../testing/selectors'
import PartnerCacheCleanupModal from './PartnerCacheCleanupModal'
import SettingsGroup, { SettingsRow } from './SettingsGroup'

const GeneralSettingsPanel: React.FC = () => {
  const { t } = useTranslation()
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [openingLogDirectory, setOpeningLogDirectory] = useState(false)
  const [cacheCleanupOpen, setCacheCleanupOpen] = useState(false)

  useEffect(() => {
    void window.api
      .appSettingsGet()
      .then(setSettings)
      .catch(() => message.error(t(($) => $.settings.couldNotLoadNotificationSettings)))
  }, [t])

  const updateNotifications = async (enabled: boolean): Promise<void> => {
    if (!settings || saving) return
    const previous = settings
    const next = { ...settings, systemNotificationsEnabled: enabled }
    setSettings(next)
    setSaving(true)
    try {
      const response = await window.api.appSettingsSave({ systemNotificationsEnabled: enabled })
      if (!response.success)
        throw new Error(
          normalizeUserFacingError(response.error, '') || t(($) => $.common.couldNotSave)
        )
      setSettings(response.settings || next)
    } catch (error) {
      setSettings(previous)
      message.error(
        error instanceof Error
          ? normalizeUserFacingError(error.message)
          : t(($) => $.settings.couldNotSaveNotificationSettings)
      )
    } finally {
      setSaving(false)
    }
  }

  const updatePreference = async (patch: Partial<AppSettings>): Promise<void> => {
    if (!settings || saving) return
    setSaving(true)
    try {
      const response = await window.api.appSettingsSave(patch)
      if (!response.success || !response.settings)
        throw new Error(
          response.errorCode
            ? appSettingsErrorText(response.errorCode)
            : normalizeUserFacingError(response.error, '') || t(($) => $.preferences.saveFailed)
        )
      setSettings(response.settings)
      updateRendererRoute(response.settings.serviceRoute)
      if (patch.language) message.info(t(($) => $.preferences.restartRequired))
    } catch (error) {
      message.error(
        error instanceof Error
          ? normalizeUserFacingError(error.message)
          : t(($) => $.preferences.saveFailed)
      )
    } finally {
      setSaving(false)
    }
  }

  const openErrorLogDirectory = async (): Promise<void> => {
    if (openingLogDirectory) return
    setOpeningLogDirectory(true)
    try {
      const response = await window.api.errorLogOpenDirectory()
      if (!response.success)
        throw new Error(
          normalizeUserFacingError(response.error, '') ||
            t(($) => $.settings.couldNotOpenTheLogDirectory)
        )
    } catch (error) {
      message.error(
        error instanceof Error
          ? normalizeUserFacingError(error.message)
          : t(($) => $.settings.couldNotOpenTheLogDirectory)
      )
    } finally {
      setOpeningLogDirectory(false)
    }
  }

  return (
    <section
      className="nc-settings-general h-full overflow-y-auto"
      data-testid={settingsSelectors.generalPanel}
      aria-label={t(($) => $.settings.generalSettings)}
    >
      <SettingsGroup title={t(($) => $.settings.applicationPreferences)}>
        <SettingsRow
          title={t(($) => $.preferences.language)}
          description={t(($) => $.preferences.languageDescription)}
        >
          <Select
            data-testid="settings-language"
            aria-label={t(($) => $.preferences.language)}
            className="nc-settings-preference-select"
            value={settings?.language ?? 'system'}
            disabled={!settings || saving}
            options={[
              { value: 'system', label: t(($) => $.preferences.system) },
              { value: 'zh-CN', label: t(($) => $.preferences.simplifiedChinese) },
              { value: 'en', label: t(($) => $.preferences.english) }
            ]}
            onChange={(language: AppSettings['language']) => void updatePreference({ language })}
          />
        </SettingsRow>
        <SettingsRow
          title={t(($) => $.preferences.serviceRoute)}
          description={t(($) => $.preferences.serviceRouteDescription)}
        >
          <Select
            data-testid="settings-service-route"
            aria-label={t(($) => $.preferences.serviceRoute)}
            className="nc-settings-preference-select"
            value={settings?.serviceRoute ?? 'domestic'}
            disabled={!settings || saving}
            options={[
              { value: 'domestic', label: t(($) => $.preferences.domestic) },
              { value: 'international', label: t(($) => $.preferences.international) }
            ]}
            onChange={(serviceRoute: AppSettings['serviceRoute']) =>
              void updatePreference({ serviceRoute })
            }
          />
        </SettingsRow>
        <SettingsRow
          title={t(($) => $.settings.aiTaskNotifications)}
          description={t(($) => $.settings.sendDesktopNotificationsWhenAiTasksSucceedFailOr)}
        >
          <Switch
            checked={settings?.systemNotificationsEnabled ?? true}
            loading={!settings || saving}
            onChange={(enabled) => void updateNotifications(enabled)}
            data-testid={settingsSelectors.systemNotificationsSwitch}
            aria-label={t(($) => $.settings.aiTaskNotifications)}
          />
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup title={t(($) => $.settings.dataAndDiagnostics)}>
        <SettingsRow
          title={t(($) => $.settings.errorLog)}
          description={t(($) => $.settings.runtimeAndIndexingErrorsAreLoggedLocallyShareApp)}
        >
          <button
            type="button"
            className="nc-no-drag nc-settings-action"
            onClick={() => void openErrorLogDirectory()}
            disabled={openingLogDirectory}
            data-testid={settingsSelectors.errorLogOpenDirectoryButton}
            aria-label={t(($) => $.settings.openErrorLogDirectory)}
            title={t(($) => $.settings.openErrorLogDirectory)}
          >
            <FileIcon kind="directory" expanded className="h-4 w-4" />
            <span>{t(($) => $.settings.open)}</span>
          </button>
        </SettingsRow>
        <SettingsRow
          title={t(($) => $.settings.partnerCache)}
          description={t(($) => $.settings.freeDiskSpaceByPartnerContentTypeAndDate)}
        >
          <button
            type="button"
            data-testid={settingsSelectors.cacheCleanupOpen}
            onClick={() => setCacheCleanupOpen(true)}
            className="nc-no-drag nc-settings-action"
          >
            {t(($) => $.settings.manageCache)}
          </button>
        </SettingsRow>
      </SettingsGroup>
      <PartnerCacheCleanupModal
        open={cacheCleanupOpen}
        onClose={() => setCacheCleanupOpen(false)}
      />
    </section>
  )
}

export default GeneralSettingsPanel
