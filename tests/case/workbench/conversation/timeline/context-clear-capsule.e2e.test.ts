import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  getWorkbenchLocator,
  getWorkbenchPrefixLocator,
  recordWorkbenchAiEvidence,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'context-clear-capsule'
const PROMPT = '请只回复 ok，用于清空记忆测试。'

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['timeline'],
        description: '清空记忆胶囊写入切断点后历史仍在并置灰，悬浮恢复颜色，且仍停留在同一伙伴。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })
          const partnerName = setup.workspaceName
          const startedAtMs = Date.now()
          await sendWorkbenchMessage(page, PROMPT)
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAtMs,
            setup.env.modelName
          )
          recordWorkbenchAiEvidence(runtime, evidence, 0.6)

          const clearButton = getWorkbenchLocator(page, workbenchSelectors.clearContextButton)
          await clearButton.waitFor({ state: 'visible' })
          await runtime.captureScreenshot({
            name: 'clear-memory-capsule',
            message: '清空记忆胶囊出现在 Composer 上方，含火花图标、无问号。'
          })
          const clearLabel = ((await clearButton.textContent()) || '').replace(/\s+/g, '')
          await clearButton.hover()
          const tooltipText = await page.locator('.ant-tooltip-inner').first().textContent()
          const inputBeforeClear = (
            (await getWorkbenchLocator(page, workbenchSelectors.input).textContent()) || ''
          ).trim()
          await clearButton.click()
          await clearButton.waitFor({ state: 'hidden' })

          const userMessage = getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.userMessagePrefix
          ).first()
          await userMessage.waitFor({ state: 'visible' })
          const grayedAfterClear = await userMessage.evaluate((element) =>
            element.classList.contains('nc-message-context-cleared')
          )
          await userMessage.hover()
          const restoredOnHover = await userMessage.evaluate(
            (element) => !element.classList.contains('nc-message-context-cleared')
          )
          await getWorkbenchLocator(page, workbenchSelectors.input).hover()
          const grayedAfterLeave = await userMessage.evaluate((element) =>
            element.classList.contains('nc-message-context-cleared')
          )
          await runtime.captureScreenshot({
            name: 'clear-memory-grayed',
            message: '清空后切断前消息置灰，历史仍在同一伙伴。'
          })
          const partnerId = await page.evaluate(async (name) => {
            const partners = await window.api.partnerList()
            return partners.find((partner) => partner.name === name)?.id || null
          }, partnerName)
          if (!partnerId) throw new Error('partner not found after clear')
          const partnerStillSelected = await getWorkbenchLocator(
            page,
            `${workbenchSelectors.partnerItemPrefix}-${partnerId}`
          ).evaluate((element) => element.classList.contains('nc-sidebar-item-active'))
          const inputAfterClear = (
            (await getWorkbenchLocator(page, workbenchSelectors.input).textContent()) || ''
          ).trim()

          return {
            clearLabel,
            tooltipText: (tooltipText || '').trim(),
            partnerName,
            grayedAfterClear,
            restoredOnHover,
            grayedAfterLeave,
            partnerStillSelected,
            inputUnchanged: inputBeforeClear === inputAfterClear,
            finalAnswerText: evidence.finalAnswerText
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.clearLabel.includes('清空记忆') &&
              !result.clearLabel.includes('临时') &&
              result.tooltipText.includes(`「${result.partnerName}」`) &&
              result.tooltipText.includes('不会删除对话记录') &&
              result.grayedAfterClear &&
              result.restoredOnHover &&
              result.grayedAfterLeave &&
              result.partnerStillSelected &&
              result.inputUnchanged &&
              result.finalAnswerText.trim().length > 0,
            {
              name: 'workbench-context-clear-capsule',
              message: '清空记忆胶囊文案与 tooltip 正确，清空后历史置灰且仍在同一伙伴。',
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
