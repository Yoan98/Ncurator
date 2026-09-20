import React, { useEffect, useState } from 'react'
import { Segmented, Tooltip, message } from 'antd'
import { HiOutlineQuestionMarkCircle } from 'react-icons/hi2'
import { LuRabbit, LuTurtle } from 'react-icons/lu'
import type { AppSettings, KnowledgeIndexSpeed } from '../../../../shared/types'
import { importSelectors } from '../../testing/selectors'

const SPEED_HELP = (
  <div className="w-[260px] text-[12px] leading-5 text-[#5F5F5B]">
    <div>
      <span className="font-medium text-[#37352F]">慢速：</span>
      占用电脑较少的资源来完成索引，完成速度会比较慢
    </div>
    <div className="mt-2">
      <span className="font-medium text-[#37352F]">高速：</span>
      全力使用电脑资源来完成索引，完成速度会比较快
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
    <div className="mt-3">
      <div className="flex items-center gap-1.5">
        <div className="text-[14px] font-semibold text-[#37352F]">索引速度</div>
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
      <div className="mt-3">
        <Segmented
          block
          size="small"
          value={current}
          disabled={!settings || saving}
          onChange={(value) => void updateSpeed(value as KnowledgeIndexSpeed)}
          options={[
            {
              value: 'slow',
              icon: <LuTurtle className="h-3.5 w-3.5" />,
              label: <span data-testid={importSelectors.workspaceIndexSpeedSlow}>慢速</span>
            },
            {
              value: 'fast',
              icon: <LuRabbit className="h-3.5 w-3.5" />,
              label: <span data-testid={importSelectors.workspaceIndexSpeedFast}>高速</span>
            }
          ]}
        />
      </div>
    </div>
  )
}
