import { createElement, useCallback, useEffect } from 'react'
import { App } from 'antd'
import { WPS_INTEGRATION_MANUAL_URL } from '../../../../shared/constants'
import {
  WPS_HOST_LABELS,
  type WpsHost,
  type WpsIntegrationIssue
} from '../../../../shared/wpsIntegration'

const shownIssues = new Set<string>()
type IntegrationDialog = {
  append: (issue: WpsIntegrationIssue, description: string) => void
  recover: (host: WpsHost) => void
}
let activeDialog: IntegrationDialog | undefined

const reminderKey = (host: WpsHost): string => `wps-integration-reminder:${host}`

export const resetWpsIntegrationFeedback = (host: WpsHost): void => {
  for (const key of shownIssues) {
    if (key.startsWith(`${host}:`)) shownIssues.delete(key)
  }
  activeDialog?.recover(host)
}

export function useWpsIntegrationFeedback() {
  const { modal, message } = App.useApp()
  return useCallback(
    (issue: WpsIntegrationIssue, interactive = false) => {
      const key = `${issue.host}:${issue.state}`
      if (shownIssues.has(key)) {
        if (interactive)
          message.info({
            key: reminderKey(issue.host),
            content:
              issue.state === 'not-enabled'
                ? '馆长 WPS 加载项未启用，无法定位'
                : issue.state === 'not-connected'
                  ? '馆长 WPS 加载项未连接，无法定位'
                  : '暂时无法确认馆长 WPS 加载项状态，无法定位'
          })
        return
      }
      shownIssues.add(key)
      const label = WPS_HOST_LABELS[issue.host]
      const description =
        issue.state === 'not-enabled'
          ? `${label}的馆长加载项未启用。请在 WPS 的加载项管理中启用馆长，并允许 WPS 显示的授权请求。`
          : issue.state === 'not-connected'
            ? `${label}的馆长加载项已启用，但尚未连接。请检查 WPS 提示；如刚启用或更新，请保存文档后正常退出并重新打开 WPS。`
            : `暂时无法确认${label}的加载项状态。请在 WPS 的加载项管理中检查馆长是否启用，并处理 WPS 显示的提示。`
      if (activeDialog) {
        activeDialog.append(issue, description)
        return
      }
      const descriptions = new Map([[key, { host: issue.host, text: description }]])
      const content = () =>
        createElement(
          'div',
          { className: 'space-y-3 text-sm leading-6' },
          ...Array.from(descriptions, ([id, value]) => createElement('p', { key: id }, value.text))
        )
      const dialog = modal.confirm({
        title: 'WPS 联动暂不可用',
        content: content(),
        centered: true,
        icon: null,
        okText: '查看使用手册',
        cancelText: '稍后',
        onOk: async () => {
          const result = await window.api.openExternal(WPS_INTEGRATION_MANUAL_URL)
          if (!result.success) message.error(result.error || '无法打开使用手册')
        },
        afterClose: () => {
          if (activeDialog === currentDialog) activeDialog = undefined
        }
      })
      const currentDialog: IntegrationDialog = {
        append: (nextIssue, text) => {
          descriptions.set(`${nextIssue.host}:${nextIssue.state}`, { host: nextIssue.host, text })
          dialog.update({ content: content() })
        },
        recover: (host) => {
          for (const [id, value] of descriptions) {
            if (value.host === host) descriptions.delete(id)
          }
          if (descriptions.size) dialog.update({ content: content() })
          else {
            if (activeDialog === currentDialog) activeDialog = undefined
            dialog.destroy()
          }
        }
      }
      activeDialog = currentDialog
    },
    [modal, message]
  )
}

export function useWpsIntegrationNotices(): void {
  const showIssue = useWpsIntegrationFeedback()
  const { message } = App.useApp()
  useEffect(
    () =>
      window.api.onWpsIntegrationNotice((notice) => {
        if (notice.kind === 'integration') showIssue(notice.issue)
        else if (notice.kind === 'ready') {
          resetWpsIntegrationFeedback(notice.host)
          message.destroy(reminderKey(notice.host))
        } else message.warning({ key: 'wps-refresh-failure', content: notice.reason, duration: 6 })
      }),
    [showIssue, message]
  )
}
