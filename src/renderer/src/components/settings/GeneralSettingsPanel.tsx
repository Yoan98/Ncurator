import React, { useEffect, useState } from 'react'
import { Switch, message } from 'antd'
import type { AiRuntimeSettings } from '../../../../shared/types'
import { settingsSelectors } from '../../testing/selectors'

const GeneralSettingsPanel: React.FC = () => {
  const [settings, setSettings] = useState<AiRuntimeSettings | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void window.api
      .aiRuntimeSettingsGet()
      .then(setSettings)
      .catch(() => message.error('读取通知设置失败'))
  }, [])

  const updateNotifications = async (enabled: boolean): Promise<void> => {
    if (!settings || saving) return
    const previous = settings
    const next = { ...settings, systemNotificationsEnabled: enabled }
    setSettings(next)
    setSaving(true)
    try {
      const response = await window.api.aiRuntimeSettingsSave(next)
      if (!response.success) throw new Error(response.error || '保存失败')
    } catch (error) {
      setSettings(previous)
      message.error(error instanceof Error ? error.message : '保存通知设置失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section
      className="h-full overflow-y-auto"
      data-testid={settingsSelectors.generalPanel}
      aria-label="通用设置"
    >
      <div className="max-w-3xl border-b border-[#EEEEEC] py-4 first:pt-0">
        <div className="flex items-center justify-between gap-6">
          <div className="min-w-0">
            <div className="text-[14px] font-medium text-[#37352F]">AI 运行完成通知</div>
            <div className="mt-1 text-[12px] leading-5 text-[#787774]">
              AI 运行成功、失败或取消时发送电脑系统通知。
            </div>
          </div>
          <Switch
            checked={settings?.systemNotificationsEnabled ?? true}
            loading={!settings || saving}
            onChange={(enabled) => void updateNotifications(enabled)}
            data-testid={settingsSelectors.systemNotificationsSwitch}
            aria-label="AI 运行完成通知"
          />
        </div>
      </div>
    </section>
  )
}

export default GeneralSettingsPanel
