import { createElement, useCallback, useEffect } from 'react'
import { App } from 'antd'
import { WPS_INTEGRATION_MANUAL_URL } from '../../../../shared/constants'
import { WPS_HOST_LABELS, type WpsIntegrationIssue } from '../../../../shared/wpsIntegration'

const shownIssues = new Set<string>()
let activeDialog: { append: (description: string) => void } | undefined

export function useWpsIntegrationFeedback() {
  const { modal, message } = App.useApp()
  return useCallback(
    (issue: WpsIntegrationIssue, interactive = false) => {
      const key = `${issue.host}:${issue.state}`
      if (shownIssues.has(key)) {
        if (interactive)
          message.info({
            key: 'wps-integration-reminder',
            content: 'WPS 联动暂不可用，请通过右上角问号查看启用方法'
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
        activeDialog.append(description)
        return
      }
      const descriptions = [description]
      const content = () =>
        createElement(
          'div',
          { className: 'space-y-3 text-sm leading-6' },
          ...descriptions.map((text) => createElement('p', { key: text }, text))
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
          activeDialog = undefined
        }
      })
      activeDialog = {
        append: (text) => {
          descriptions.push(text)
          dialog.update({ content: content() })
        }
      }
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
        else message.warning({ key: 'wps-refresh-failure', content: notice.reason, duration: 6 })
      }),
    [showIssue, message]
  )
}
