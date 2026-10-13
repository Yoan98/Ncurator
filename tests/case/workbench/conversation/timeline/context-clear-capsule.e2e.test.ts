import fs from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import { describe, it } from 'vitest'
import { resolveRunArtifactsDir } from '../../../../harness/core/write-run-log'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  openNativeConfirmation,
  dismissNativeConfirmation
} from '../../../../harness/e2e/nativeConfirm'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  createPartnerThroughWorkbenchUi,
  getWorkbenchLocator,
  getWorkbenchPrefixLocator,
  recordWorkbenchAiEvidence,
  selectWorkbenchExecutionPermission,
  selectWorkbenchModel,
  selectWorkbenchResourceMenuItem,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  startLocalWorkbenchHttpServer,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'context-clear-capsule'
const PARTNER_NAME = '清空消息伙伴'
const PROMPT = '请只回复 ok，用于清空消息记录测试。'
const exists = async (file: string): Promise<boolean> =>
  fs
    .access(file)
    .then(() => true)
    .catch(() => false)

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['timeline'],
        description:
          '清空消息默认保留修改历史，选项可整行切换，取消后重置，主动勾选后删除备份及审核。',
        fixtures: [],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID,
            workspaceContents: 'empty',
            createPartner: false
          })
          await createPartnerThroughWorkbenchUi(page, PARTNER_NAME)
          await selectWorkbenchModel(page, setup.env.modelName)
          await selectWorkbenchExecutionPermission(page, '完全访问')
          const partnerId = await page.evaluate(async (name) => {
            const partners = await window.api.partnerList()
            return partners.find((partner) => partner.name === name)?.id || null
          }, PARTNER_NAME)
          if (!partnerId) throw new Error('partner not found')
          const source = path.join(setup.workspace.rootPath, 'clear-history.md')
          await fs.writeFile(source, 'before clear\n')

          const startedAtMs = Date.now()
          await sendWorkbenchMessage(
            page,
            `请使用 text_file 工具将 ${source} 的全文替换为 after clear。请实际写入，最后只回复完成。`
          )
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAtMs,
            setup.env.modelName
          )
          recordWorkbenchAiEvidence(runtime, evidence, 0.6)
          const history = await page.evaluate(
            async (id) => (await window.api.aiFileChangeList({ partnerId: id })).items,
            partnerId
          )
          const record = history.find((item) => item.path === source)
          if (!record?.beforeSnapshotPath || !record.previewPath)
            throw new Error('真实文件工具未生成修改备份和审核')
          const historyFiles = [record.beforeSnapshotPath, record.previewPath]

          let heartbeat = 0
          const server = await startLocalWorkbenchHttpServer(
            '<!doctype html><html><head><title>Clear confirmation browser</title></head><body style="background:#e3f0ff">BROWSER REMAINS LIVE<script>setInterval(() => fetch("/heartbeat").catch(() => {}), 50)</script></body></html>',
            {
              onRequest: (url) => {
                if (url !== '/heartbeat') return false
                heartbeat += 1
                return true
              }
            }
          )
          runtime.registerResource({
            name: 'clear-confirmation-browser-server',
            phase: 'before-app-close',
            dispose: server.close
          })
          await selectWorkbenchResourceMenuItem(runtime, 'browser')
          const address = getWorkbenchLocator(page, workbenchSelectors.browserPanel).getByRole(
            'textbox',
            { name: /浏览器地址/u }
          )
          await address.fill(server.url)
          await address.press('Enter')
          const browserTab = page
            .locator(`[data-testid^="${workbenchSelectors.resourceTabPrefix}-browser-"]`)
            .last()
          const browserTabId = (await browserTab.getAttribute('data-testid'))
            ?.split('-browser-')
            .at(-1)
          if (!browserTabId) throw new Error('browser tab id is missing')
          await page.waitForFunction(async (tabId) => {
            const response = await window.api.browserPanelStateGet({ tabId })
            return response.success && response.state?.title === 'Clear confirmation browser'
          }, browserTabId)
          const mainWindow = await runtime.electronApp.browserWindow(page)
          const mainWindowId = await mainWindow.evaluate((window) => window.id)
          const inspectNativeViews = async () =>
            runtime.electronApp.evaluate(
              ({ BrowserWindow, WebContentsView }, { mainWindowId, url }) => {
                const owner = BrowserWindow.fromId(mainWindowId)
                const browser = owner?.contentView.children.find(
                  (view): view is Electron.WebContentsView =>
                    view instanceof WebContentsView && view.webContents.getURL() === url
                )
                return {
                  browserId: browser?.webContents.id || null,
                  browserVisible: browser?.getVisible() || false,
                  browserBounds: browser?.getBounds() || null,
                  ownerBounds: owner?.getContentBounds() || null,
                  popups:
                    owner
                      ?.getChildWindows()
                      .map((popup) => ({
                        parentId: popup.getParentWindow()?.id,
                        visible: popup.isVisible(),
                        bounds: popup.getBounds()
                      })) || []
                }
              },
              { mainWindowId, url: server.url }
            )
          await page.waitForTimeout(300)
          const browserBefore = await inspectNativeViews()
          if (!browserBefore.browserId || !browserBefore.browserVisible)
            throw new Error('browser is not presented')
          const capturePopup = async (
            popup: Page,
            name: string,
            message: string
          ): Promise<void> => {
            const relativePath = `${name}.png`
            await popup.screenshot({
              path: path.join(
                resolveRunArtifactsDir({
                  scope: 'workbench/conversation/timeline',
                  caseId: CASE_ID,
                  runId: runtime.runId
                }),
                relativePath
              )
            })
            await runtime.captureArtifact({ kind: 'screenshot', relativePath, message })
          }

          const clearButton = getWorkbenchLocator(page, workbenchSelectors.clearContextButton)
          await clearButton.waitFor({ state: 'visible' })
          await runtime.captureScreenshot({
            name: 'clear-messages-capsule',
            message: '清空消息记录胶囊出现在 Composer 上方。'
          })
          const clearLabel = ((await clearButton.textContent()) || '').replace(/\s+/g, '')
          await clearButton.hover()
          const tooltipText = await page.locator('.ant-tooltip-inner').first().textContent()
          const inputBeforeClear = (
            (await getWorkbenchLocator(page, workbenchSelectors.input).textContent()) || ''
          ).trim()

          const openConfirmation = () =>
            openNativeConfirmation(runtime, clearButton, '清空消息记录？')
          const confirm = await openConfirmation()
          const deleteHistory = confirm.getByRole('checkbox', {
            name: '同时删除文件修改历史',
            exact: true
          })
          const deleteHistoryDefault = await deleteHistory.isChecked()
          const confirmationText = await confirm.getByRole('dialog').innerText()
          const help = confirm.getByRole('button', { name: '同时删除文件修改历史说明' })
          const helpTooltip = confirm.getByRole('tooltip')
          await help.hover()
          await helpTooltip.waitFor({ state: 'visible' })
          const historyHelpText = await helpTooltip.innerText()
          await confirm.getByText('清空消息记录？', { exact: true }).hover()
          await helpTooltip.waitFor({ state: 'hidden' })
          await help.focus()
          const helpShowsOnFocus = await helpTooltip.isVisible()
          await help.click()
          const helpPreservesSelection = !(await deleteHistory.isChecked())
          await confirm.getByText('同时删除文件修改历史', { exact: true }).click()
          const titleTogglesOption = await deleteHistory.isChecked()
          await deleteHistory.focus()
          await deleteHistory.press('Space')
          const keyboardTogglesOption = !(await deleteHistory.isChecked())
          await confirm.getByText('清空消息记录？', { exact: true }).click()
          await capturePopup(
            confirm,
            'native-clear-confirmation',
            '原生清空确认窗口及默认未勾选的文件历史选项。'
          )
          await help.hover()
          await helpTooltip.waitFor({ state: 'visible' })
          await capturePopup(
            confirm,
            'native-clear-history-help',
            '问号说明修改前源文件备份与删除后无法回退。'
          )
          const during = await inspectNativeViews()
          const heartbeatBefore = heartbeat
          await page.waitForTimeout(250)
          const heartbeatContinues = heartbeat > heartbeatBefore
          const popupCoversBrowser =
            during.popups.length === 1 &&
            during.popups[0].visible &&
            during.popups[0].parentId === mainWindowId &&
            JSON.stringify(during.popups[0].bounds) === JSON.stringify(during.ownerBounds)
          const browserPreservedDuringDialog =
            during.browserId === browserBefore.browserId &&
            during.browserVisible &&
            JSON.stringify(during.browserBounds) === JSON.stringify(browserBefore.browserBounds)
          await confirm.locator('#checkbox-space').click()
          const rowSpaceTogglesOption = await deleteHistory.isChecked()
          await dismissNativeConfirmation(confirm, 'cancel', '清空')
          const userStillVisibleAfterCancel = await getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.userMessagePrefix
          )
            .first()
            .isVisible()
          const historyAfterCancel = await page.evaluate(
            async (id) => (await window.api.aiFileChangeList({ partnerId: id })).items,
            partnerId
          )
          const historyIntactAfterCancel =
            historyAfterCancel.some((item) => item.id === record.id) &&
            (await Promise.all(historyFiles.map(exists))).every(Boolean)

          const cancellations = []
          for (const action of ['close', 'escape', 'mask'] as const) {
            const popup = await openConfirmation()
            const checkbox = popup.getByRole('checkbox', {
              name: '同时删除文件修改历史',
              exact: true
            })
            const defaultUnchecked = !(await checkbox.isChecked())
            await checkbox.check()
            await dismissNativeConfirmation(popup, action, '清空')
            const after = await inspectNativeViews()
            cancellations.push({
              action,
              defaultUnchecked,
              popupDestroyed: after.popups.length === 0,
              browserPreserved:
                after.browserId === browserBefore.browserId &&
                after.browserVisible &&
                JSON.stringify(after.browserBounds) === JSON.stringify(browserBefore.browserBounds),
              historyPreserved: (await Promise.all(historyFiles.map(exists))).every(Boolean),
              messagePreserved: await getWorkbenchPrefixLocator(
                page,
                workbenchSelectors.userMessagePrefix
              )
                .first()
                .isVisible()
            })
          }

          const defaultConfirm = await openConfirmation()
          const defaultResetAfterCancel = !(await defaultConfirm
            .getByRole('checkbox', { name: '同时删除文件修改历史', exact: true })
            .isChecked())
          await dismissNativeConfirmation(defaultConfirm, 'confirm', '清空')
          await clearButton.waitFor({ state: 'hidden' })
          const retainedHistory = await page.evaluate(
            async (id) => (await window.api.aiFileChangeList({ partnerId: id })).items,
            partnerId
          )
          const defaultPreservesHistory =
            retainedHistory.some((item) => item.id === record.id) &&
            (await Promise.all(historyFiles.map(exists))).every(Boolean) &&
            (await fs.readFile(record.beforeSnapshotPath, 'utf8')) === 'before clear\n'

          const userMessageCount = await getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.userMessagePrefix
          ).count()
          await runtime.captureScreenshot({
            name: 'clear-messages-empty',
            message: '确认清空后消息列表为空，仍在同一伙伴。'
          })

          const partnerStillSelected = await getWorkbenchLocator(
            page,
            `${workbenchSelectors.partnerItemPrefix}-${partnerId}`
          ).evaluate((element) => element.classList.contains('nc-sidebar-item-active'))
          const inputAfterClear = (
            (await getWorkbenchLocator(page, workbenchSelectors.input).textContent()) || ''
          ).trim()
          const messageLogEmpty = await page.evaluate(async (id) => {
            const opened = await window.api.partnerOpen({ partnerId: id, limit: 50 })
            return (opened.messages || []).length === 0
          }, partnerId)

          const secondStartedAtMs = Date.now()
          await sendWorkbenchMessage(page, PROMPT)
          const secondEvidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            secondStartedAtMs,
            setup.env.modelName
          )
          recordWorkbenchAiEvidence(runtime, secondEvidence, 0.6)
          const deleteConfirm = await openConfirmation()
          const defaultResetOnNextClear = !(await deleteConfirm
            .getByRole('checkbox', { name: '同时删除文件修改历史', exact: true })
            .isChecked())
          await deleteConfirm.locator('#checkbox-space').click()
          await dismissNativeConfirmation(deleteConfirm, 'confirm', '清空')
          await clearButton.waitFor({ state: 'hidden' })
          const historyAfterDelete = await page.evaluate(
            async (id) => (await window.api.aiFileChangeList({ partnerId: id })).items,
            partnerId
          )
          const selectedDeletesHistory =
            historyAfterDelete.length === 0 &&
            (await Promise.all(historyFiles.map(exists))).every((value) => !value)
          const formalFileUnchanged = (await fs.readFile(source, 'utf8')).trim() === 'after clear'

          return {
            clearLabel,
            deleteHistoryDefault,
            confirmationText,
            historyHelpText,
            helpShowsOnFocus,
            helpPreservesSelection,
            popupCoversBrowser,
            browserPreservedDuringDialog,
            heartbeatContinues,
            cancellations,
            titleTogglesOption,
            keyboardTogglesOption,
            rowSpaceTogglesOption,
            historyIntactAfterCancel,
            defaultResetAfterCancel,
            defaultResetOnNextClear,
            defaultPreservesHistory,
            selectedDeletesHistory,
            formalFileUnchanged,
            tooltipText: (tooltipText || '').trim(),
            partnerName: PARTNER_NAME,
            userStillVisibleAfterCancel,
            userMessageCount,
            messageLogEmpty,
            partnerStillSelected,
            inputUnchanged: inputBeforeClear === inputAfterClear,
            finalAnswerText: evidence.finalAnswerText
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.clearLabel.includes('清空消息记录') &&
              !result.deleteHistoryDefault &&
              result.confirmationText?.includes('全部对话消息及临时缓存。') &&
              !result.confirmationText.includes('伙伴和工作目录') &&
              !result.confirmationText.includes('无法恢复') &&
              !result.confirmationText.includes('（无法回退）') &&
              result.historyHelpText.includes('每次 AI 任务修改前的源文件备份') &&
              result.historyHelpText.includes('无法回退到对应的修改前版本') &&
              result.helpShowsOnFocus &&
              result.helpPreservesSelection &&
              result.popupCoversBrowser &&
              result.browserPreservedDuringDialog &&
              result.heartbeatContinues &&
              result.cancellations.every(
                (item) =>
                  item.defaultUnchecked &&
                  item.popupDestroyed &&
                  item.browserPreserved &&
                  item.historyPreserved &&
                  item.messagePreserved
              ) &&
              result.titleTogglesOption &&
              result.keyboardTogglesOption &&
              result.rowSpaceTogglesOption &&
              result.historyIntactAfterCancel &&
              result.defaultResetAfterCancel &&
              result.defaultResetOnNextClear &&
              result.defaultPreservesHistory &&
              result.selectedDeletesHistory &&
              result.formalFileUnchanged &&
              result.tooltipText.includes(`「${result.partnerName}」`) &&
              result.tooltipText.includes('无法恢复') &&
              result.userStillVisibleAfterCancel &&
              result.userMessageCount === 0 &&
              result.messageLogEmpty &&
              result.partnerStillSelected &&
              result.inputUnchanged &&
              result.finalAnswerText.trim().length > 0,
            {
              name: 'workbench-context-clear-capsule',
              message:
                '清空消息默认保留文件历史，整行和键盘切换有效，取消后重置；主动勾选才删除备份和审核，正式文件保留，对齐 WB-SESSION-011。',
              data: result
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
