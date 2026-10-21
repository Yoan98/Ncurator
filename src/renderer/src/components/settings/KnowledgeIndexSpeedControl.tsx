import { normalizeUserFacingError } from '../../utils/userFacingError'
import { t } from '../../i18n'
import React, { useEffect, useState } from 'react'
import { Button, Tooltip, message } from 'antd'
import { HiOutlineQuestionMarkCircle } from 'react-icons/hi2'
import { LuRabbit, LuTurtle } from 'react-icons/lu'
import type { AppSettings, KnowledgeIndexSpeed } from '../../../../shared/types'
import { importSelectors } from '../../testing/selectors'

const SPEED_HELP = (
  <div className="w-[260px] text-[12px] leading-5 text-[#5F5F5B]">
    <div>
      <span className="font-medium text-[#37352F]">{t(($) => $.settings.slow)}</span>
      {t(($) => $.settings.usesFewerComputerResourcesToIndexFilesTakingMore)}
    </div>
    <div className="mt-2">
      <span className="font-medium text-[#37352F]">{t(($) => $.settings.fast)}</span>
      {t(($) => $.settings.usesMoreComputerResourcesToFinishIndexingFaster)}
    </div>
  </div>
)

export const KnowledgeIndexSpeedControl: React.FC<{ prepareRunning: boolean }> = ({
  prepareRunning
}) => {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void window.api
      .appSettingsGet()
      .then(setSettings)
      .catch(() => message.error(t(($) => $.settings.couldNotLoadIndexingSpeed)))
  }, [])

  const locked = !settings || saving || prepareRunning

  const updateSpeed = async (knowledgeIndexSpeed: KnowledgeIndexSpeed): Promise<void> => {
    if (!settings || locked || settings.knowledgeIndexSpeed === knowledgeIndexSpeed) return
    const previous = settings
    const next = { ...settings, knowledgeIndexSpeed }
    setSettings(next)
    setSaving(true)
    try {
      const response = await window.api.appSettingsSave({ knowledgeIndexSpeed })
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
          : t(($) => $.settings.couldNotSaveIndexingSpeed)
      )
    } finally {
      setSaving(false)
    }
  }

  const current = settings?.knowledgeIndexSpeed || 'slow'

  return (
    <div className="mt-3">
      <div className="flex items-center gap-1.5">
        <div className="text-[14px] font-semibold text-[#37352F]">
          {t(($) => $.settings.indexingSpeed)}
        </div>
        <Tooltip title={SPEED_HELP}>
          <button
            type="button"
            className="inline-flex items-center text-[#9B9A97] transition-colors hover:text-[#37352F]"
            aria-label={t(($) => $.settings.aboutIndexingSpeed)}
            data-testid={importSelectors.workspaceIndexSpeedHelp}
          >
            <HiOutlineQuestionMarkCircle className="h-4 w-4 cursor-help" />
          </button>
        </Tooltip>
      </div>
      <div className="mt-3 flex overflow-hidden rounded-[6px] border border-[#EEEEEC]">
        <Button
          size="small"
          type={current === 'slow' ? 'primary' : 'text'}
          icon={<LuTurtle className="h-3.5 w-3.5" />}
          onClick={() => void updateSpeed('slow')}
          loading={!settings && saving}
          disabled={locked}
          className="!h-7 flex-1 !rounded-none"
          data-testid={importSelectors.workspaceIndexSpeedSlow}
        >
          {t(($) => $.settings.slow2)}
        </Button>
        <Button
          size="small"
          type={current === 'fast' ? 'primary' : 'text'}
          icon={<LuRabbit className="h-3.5 w-3.5" />}
          onClick={() => void updateSpeed('fast')}
          disabled={locked}
          className="!h-7 flex-1 !rounded-none"
          data-testid={importSelectors.workspaceIndexSpeedFast}
        >
          {t(($) => $.settings.fast2)}
        </Button>
      </div>
    </div>
  )
}
