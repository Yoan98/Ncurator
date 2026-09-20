import React, { useEffect, useState } from 'react'
import { Button, Tooltip, message } from 'antd'
import { HiOutlineBolt, HiOutlineClock, HiOutlineQuestionMarkCircle } from 'react-icons/hi2'
import type { AppSettings, KnowledgeIndexSpeed } from '../../../../shared/types'
import { importSelectors } from '../../testing/selectors'

const SPEED_HELP = (
  <div className="w-[260px] text-[12px] leading-5 text-[#5F5F5B]">
    <div>
      <span className="font-medium text-[#37352F]">慢速：</span>
      优先保证其它工作流畅，按电脑核数大约占用一半算力，后台继续建索引。
    </div>
    <div className="mt-2">
      <span className="font-medium text-[#37352F]">高速：</span>
      尽量占满算力加快建索引，只留少量核给系统操作；适合暂时不用电脑时。
    </div>
  </div>
)

export const KnowledgeIndexSpeedControl: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void window.api
      .appSettingsGet()
      .then(setSettings)
      .catch(() => message.error('读取索引速度失败'))
  }, [])

  const updateSpeed = async (knowledgeIndexSpeed: KnowledgeIndexSpeed): Promise<void> => {
    if (!settings || saving || settings.knowledgeIndexSpeed === knowledgeIndexSpeed) return
    const previous = settings
    const next = { ...settings, knowledgeIndexSpeed }
    setSettings(next)
    setSaving(true)
    try {
      const response = await window.api.appSettingsSave(next)
      if (!response.success) throw new Error(response.error || '保存失败')
      setSettings(response.settings || next)
    } catch (error) {
      setSettings(previous)
      message.error(error instanceof Error ? error.message : '保存索引速度失败')
    } finally {
      setSaving(false)
    }
  }

  const current = settings?.knowledgeIndexSpeed || 'slow'

  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <div className="inline-flex items-center gap-1">
        <span className="text-[12px] text-[#787774]">索引速度</span>
        <Tooltip title={SPEED_HELP}>
          <button
            type="button"
            className="inline-flex items-center text-[#9B9A97] transition-colors hover:text-[#37352F]"
            aria-label="索引速度说明"
            data-testid={importSelectors.workspaceIndexSpeedHelp}
          >
            <HiOutlineQuestionMarkCircle className="h-4 w-4 cursor-help" />
          </button>
        </Tooltip>
      </div>
      <div className="inline-flex overflow-hidden rounded-[6px] border border-[#EEEEEC]">
        <Button
          size="small"
          type={current === 'slow' ? 'primary' : 'text'}
          icon={<HiOutlineClock className="h-3.5 w-3.5" />}
          onClick={() => void updateSpeed('slow')}
          loading={!settings && saving}
          disabled={!settings || saving}
          className="!h-7 !rounded-none !px-2"
          data-testid={importSelectors.workspaceIndexSpeedSlow}
        >
          慢速
        </Button>
        <Button
          size="small"
          type={current === 'fast' ? 'primary' : 'text'}
          icon={<HiOutlineBolt className="h-3.5 w-3.5" />}
          onClick={() => void updateSpeed('fast')}
          disabled={!settings || saving}
          className="!h-7 !rounded-none !px-2"
          data-testid={importSelectors.workspaceIndexSpeedFast}
        >
          高速
        </Button>
      </div>
    </div>
  )
}
