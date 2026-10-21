import { normalizeUserFacingError } from '../../utils/userFacingError'
import React, { useEffect, useState } from 'react'
import { Select, Switch, message } from 'antd'
import { useTranslation } from 'react-i18next'
import { updateRendererRoute, appSettingsErrorText } from '../../i18n'
import FileIcon from '../FileIcon'
import type { AppSettings } from '../../../../shared/types'
import { settingsSelectors } from '../../testing/selectors'
import PartnerCacheCleanupModal from './PartnerCacheCleanupModal'

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
      className="h-full overflow-y-auto"
      data-testid={settingsSelectors.generalPanel}
      aria-label={t(($) => $.settings.generalSettings)}
    >
      <div className="w-full pt-2">
        <div className="flex items-center justify-between gap-6 border-b border-[#EEEEEC] pb-5">
          <div className="min-w-0">
            <div className="text-[14px] font-medium text-[#37352F]">
              {t(($) => $.preferences.language)}
            </div>
            <div className="mt-1 text-[12px] leading-5 text-[#787774]">
              {t(($) => $.preferences.languageDescription)}
            </div>
          </div>
          <Select
            data-testid="settings-language"
            aria-label={t(($) => $.preferences.language)}
            className="min-w-[160px] shrink-0"
            value={settings?.language ?? 'system'}
            disabled={!settings || saving}
            options={[
              { value: 'system', label: t(($) => $.preferences.system) },
              { value: 'zh-CN', label: t(($) => $.preferences.simplifiedChinese) },
              { value: 'en', label: t(($) => $.preferences.english) }
            ]}
            onChange={(language: AppSettings['language']) => void updatePreference({ language })}
          />
        </div>
        <div className="flex items-center justify-between gap-6 border-b border-[#EEEEEC] py-5 mb-5">
          <div className="min-w-0">
            <div className="text-[14px] font-medium text-[#37352F]">
              {t(($) => $.preferences.serviceRoute)}
            </div>
            <div className="mt-1 text-[12px] leading-5 text-[#787774]">
              {t(($) => $.preferences.serviceRouteDescription)}
            </div>
          </div>
          <Select
            data-testid="settings-service-route"
            aria-label={t(($) => $.preferences.serviceRoute)}
            className="min-w-[160px] shrink-0"
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
        </div>
        <div className="flex items-center justify-between gap-6">
          <div className="min-w-0">
            <div className="text-[14px] font-medium text-[#37352F]">
              {t(($) => $.settings.aiTaskNotifications)}
            </div>
            <div className="mt-1 text-[12px] leading-5 text-[#787774]">
              {t(($) => $.settings.sendDesktopNotificationsWhenAiTasksSucceedFailOr)}
            </div>
          </div>
          <Switch
            checked={settings?.systemNotificationsEnabled ?? true}
            loading={!settings || saving}
            onChange={(enabled) => void updateNotifications(enabled)}
            data-testid={settingsSelectors.systemNotificationsSwitch}
            aria-label={t(($) => $.settings.aiTaskNotifications)}
          />
        </div>
        <div className="mt-5 flex items-center justify-between gap-6 border-t border-[#EEEEEC] py-5">
          <div className="min-w-0">
            <div className="text-[14px] font-medium text-[#37352F]">
              {t(($) => $.settings.errorLog)}
            </div>
            <div className="mt-1 text-[12px] leading-5 text-[#787774]">
              {t(($) => $.settings.runtimeAndIndexingErrorsAreLoggedLocallyShareApp)}
            </div>
          </div>
          <button
            type="button"
            className="nc-no-drag inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded border border-[#E6E6E3] px-3 text-[12px] font-medium text-[#5F5F5B] transition-colors hover:border-[#C9C9C5] hover:bg-[#F6F6F4] disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void openErrorLogDirectory()}
            disabled={openingLogDirectory}
            data-testid={settingsSelectors.errorLogOpenDirectoryButton}
            aria-label={t(($) => $.settings.openErrorLogDirectory)}
            title={t(($) => $.settings.openErrorLogDirectory)}
          >
            <FileIcon kind="directory" expanded className="h-4 w-4" />
            <span>{t(($) => $.settings.open)}</span>
          </button>
        </div>
        <div className="flex items-center justify-between gap-6 border-t border-[#EEEEEC] py-5">
          <div>
            <div className="text-[14px] font-medium text-[#37352F]">
              {t(($) => $.settings.cleanUpPartnerCache)}
            </div>
            <div className="mt-1 text-[12px] leading-5 text-[#787774]">
              {t(($) => $.settings.freeDiskSpaceByPartnerContentTypeAndDate)}
            </div>
          </div>
          <button
            type="button"
            data-testid={settingsSelectors.cacheCleanupOpen}
            onClick={() => setCacheCleanupOpen(true)}
            className="nc-no-drag h-8 shrink-0 rounded border border-[#E6E6E3] px-3 text-[12px] font-medium text-[#5F5F5B] hover:bg-[#F6F6F4]"
          >
            {t(($) => $.settings.manage)}
          </button>
        </div>
      </div>
      <PartnerCacheCleanupModal
        open={cacheCleanupOpen}
        onClose={() => setCacheCleanupOpen(false)}
      />
    </section>
  )
}

export default GeneralSettingsPanel
