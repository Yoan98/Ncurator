import { normalizeUserFacingError } from '../../utils/userFacingError'
import React, { useEffect, useState } from 'react'
import { Switch, message } from 'antd'
import { useTranslation } from 'react-i18next'
import { updateRendererRoute, appSettingsErrorText } from '../../i18n'
import FileIcon from '../FileIcon'
import type { AppSettings } from '../../../../shared/types'
import { settingsSelectors } from '../../testing/selectors'
import PartnerCacheCleanupModal from './PartnerCacheCleanupModal'
import SettingsGroup, { SettingsRow } from './SettingsGroup'
import SettingsChoiceCards, { type SettingsChoiceOption } from './SettingsChoiceCards'
import {
  LanguagePreviewChinese,
  LanguagePreviewEnglish,
  LanguagePreviewSystem,
  ThemePreviewDark,
  ThemePreviewLight,
  ThemePreviewSystem
} from './SettingsChoicePreviews'
import { useAppearance } from '../../contexts/AppearanceContext'

const GeneralSettingsPanel: React.FC = () => {
  const { t } = useTranslation()
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [openingLogDirectory, setOpeningLogDirectory] = useState(false)
  const [cacheCleanupOpen, setCacheCleanupOpen] = useState(false)
  const appearance = useAppearance()

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

  const themeOptions: SettingsChoiceOption<AppSettings['theme']>[] = [
    {
      value: 'system',
      label: t(($) => $.preferences.system),
      preview: <ThemePreviewSystem />
    },
    {
      value: 'light',
      label: t(($) => $.preferences.themeLight),
      preview: <ThemePreviewLight />
    },
    {
      value: 'dark',
      label: t(($) => $.preferences.themeDark),
      preview: <ThemePreviewDark />
    }
  ]

  // 说明文案跟着选中项走：用户不必再从三句里猜「现在这句是在说哪个选项」。
  const themeDescription =
    (settings?.theme ?? 'system') === 'light'
      ? t(($) => $.preferences.themeDescriptionLight)
      : (settings?.theme ?? 'system') === 'dark'
        ? t(($) => $.preferences.themeDescriptionDark)
        : t(($) => $.preferences.themeDescriptionSystem)

  const languageOptions: SettingsChoiceOption<AppSettings['language']>[] = [
    {
      value: 'system',
      label: t(($) => $.preferences.system),
      preview: <LanguagePreviewSystem />
    },
    {
      value: 'zh-CN',
      label: t(($) => $.preferences.simplifiedChinese),
      preview: <LanguagePreviewChinese />
    },
    {
      value: 'en',
      label: t(($) => $.preferences.english),
      preview: <LanguagePreviewEnglish />
    }
  ]

  return (
    <section
      className="nc-settings-general h-full overflow-y-auto"
      data-testid={settingsSelectors.generalPanel}
      aria-label={t(($) => $.settings.generalSettings)}
    >
      <SettingsGroup title={t(($) => $.settings.visualStyle)}>
        <SettingsRow title={t(($) => $.preferences.theme)} description={themeDescription}>
          <SettingsChoiceCards
            label={t(($) => $.preferences.theme)}
            value={settings?.theme ?? 'system'}
            disabled={!settings || saving}
            testIdPrefix="settings-theme"
            options={themeOptions}
            onChange={(theme) => {
              appearance.setPreference(theme)
              void updatePreference({ theme })
            }}
          />
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup title={t(($) => $.settings.applicationPreferences)}>
        <SettingsRow
          title={t(($) => $.preferences.language)}
          description={t(($) => $.preferences.languageDescription)}
        >
          <SettingsChoiceCards
            label={t(($) => $.preferences.language)}
            value={settings?.language ?? 'system'}
            disabled={!settings || saving}
            testIdPrefix="settings-language"
            options={languageOptions}
            onChange={(language) => void updatePreference({ language })}
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
        <SettingsRow
          title={t(($) => $.editors.officeDiffWps)}
          description={t(($) => $.editors.officeDiffWpsDescription)}
        >
          <Switch
            checked={settings?.openOfficeDiffInWps ?? false}
            disabled={!settings || saving}
            data-testid="settings-office-diff-wps"
            aria-label={t(($) => $.editors.officeDiffWps)}
            onChange={(enabled) => void updatePreference({ openOfficeDiffInWps: enabled })}
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
