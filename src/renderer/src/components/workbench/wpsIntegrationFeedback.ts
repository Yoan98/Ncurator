import { t, getManualUrl, getRendererRuntime } from '../../i18n'
import { createElement, useCallback, useEffect } from 'react'
import { App } from 'antd'

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
                ? t(($) => $.workbench.theNcuratorWpsAddInIsDisabledNavigationIs)
                : issue.state === 'not-connected'
                  ? t(($) => $.workbench.theNcuratorWpsAddInIsDisconnectedNavigationIs)
                  : t(($) => $.workbench.couldNotConfirmTheNcuratorWpsAddInStatus)
          })
        return
      }
      shownIssues.add(key)
      const label =
        getRendererRuntime().locale === 'en'
          ? ({ wps: 'Word', et: 'Excel', wpp: 'PowerPoint' } as const)[issue.host]
          : WPS_HOST_LABELS[issue.host]
      const description =
        issue.state === 'not-enabled'
          ? t(($) => $.workbench.theNcuratorAddInForIsDisabledEnableIt, { value1: label })
          : issue.state === 'not-connected'
            ? t(($) => $.workbench.theNcuratorAddInForIsEnabledButNot, { value1: label })
            : t(($) => $.workbench.couldNotConfirmTheAddInStatusForCheck, { value1: label })
      if (activeDialog) {
        activeDialog.append(issue, description)
        return
      }
      const descriptions = new Map<string, { host: WpsHost; text: string }>([
        [key, { host: issue.host, text: description }]
      ])
      const content = () =>
        createElement(
          'div',
          { className: 'space-y-3 text-sm leading-6' },
          ...Array.from(descriptions, ([id, value]) => createElement('p', { key: id }, value.text))
        )
      const dialog = modal.confirm({
        title: t(($) => $.workbench.wpsIntegrationUnavailable),
        content: content(),
        centered: true,
        icon: null,
        okText: t(($) => $.workbench.viewUserManual),
        cancelText: t(($) => $.common.later),
        onOk: async () => {
          const result = await window.api.openExternal(getManualUrl('#wps-integration'))
          if (!result.success)
            message.error(result.error || t(($) => $.workbench.couldNotOpenTheUserManual))
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
