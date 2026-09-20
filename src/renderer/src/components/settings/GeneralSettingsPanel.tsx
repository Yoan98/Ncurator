import React, { useEffect, useState } from 'react'
import { Switch, message } from 'antd'
import { HiFolderOpen } from 'react-icons/hi2'
import type { AppSettings } from '../../../../shared/types'
import { settingsSelectors } from '../../testing/selectors'

const GeneralSettingsPanel: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [openingLogDirectory, setOpeningLogDirectory] = useState(false)

  useEffect(() => {
    void window.api
      .appSettingsGet()
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
      const response = await window.api.appSettingsSave(next)
      if (!response.success) throw new Error(response.error || '保存失败')
      setSettings(response.settings || next)
    } catch (error) {
      setSettings(previous)
      message.error(error instanceof Error ? error.message : '保存通知设置失败')
    } finally {
      setSaving(false)
    }
  }

  const openErrorLogDirectory = async (): Promise<void> => {
    if (openingLogDirectory) return
    setOpeningLogDirectory(true)
    try {
      const response = await window.api.errorLogOpenDirectory()
      if (!response.success) throw new Error(response.error || '打开日志目录失败')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '打开日志目录失败')
    } finally {
      setOpeningLogDirectory(false)
    }
  }

  return (
    <section
      className="h-full overflow-y-auto"
      data-testid={settingsSelectors.generalPanel}
      aria-label="通用设置"
    >
      <div className="w-full pt-2">
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
        <div className="mt-5 flex items-center justify-between gap-6 border-t border-[#EEEEEC] py-5">
          <div className="min-w-0">
            <div className="text-[14px] font-medium text-[#37352F]">错误日志</div>
            <div className="mt-1 text-[12px] leading-5 text-[#787774]">
              遇到运行或索引错误时会记录到本地，请将 app.log 发给作者排查问题。
            </div>
          </div>
          <button
            type="button"
            className="nc-no-drag inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded border border-[#E6E6E3] px-3 text-[12px] font-medium text-[#5F5F5B] transition-colors hover:border-[#C9C9C5] hover:bg-[#F6F6F4] disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void openErrorLogDirectory()}
            disabled={openingLogDirectory}
            data-testid={settingsSelectors.errorLogOpenDirectoryButton}
            aria-label="打开错误日志目录"
            title="打开错误日志目录"
          >
            <HiFolderOpen className="h-4 w-4" />
            <span>打开</span>
          </button>
        </div>
      </div>
    </section>
  )
}

export default GeneralSettingsPanel
