import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  createPartnerThroughWorkbenchUi,
  getWorkbenchLocator,
  getWorkbenchPrefixLocator,
  recordWorkbenchAiEvidence,
  selectWorkbenchModel,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'context-clear-capsule'
const PARTNER_NAME = '清空消息伙伴'
const PROMPT = '请只回复 ok，用于清空消息记录测试。'

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
          '清空消息记录胶囊确认后删除对话消息，取消确认不删，仍停留在同一伙伴。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID,
            createPartner: false
          })
          await createPartnerThroughWorkbenchUi(page, PARTNER_NAME)
          await selectWorkbenchModel(page, setup.env.modelName)

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
            name: 'clear-messages-capsule',
            message: '清空消息记录胶囊出现在 Composer 上方。'
          })
          const clearLabel = ((await clearButton.textContent()) || '').replace(/\s+/g, '')
          await clearButton.hover()
          const tooltipText = await page.locator('.ant-tooltip-inner').first().textContent()
          const inputBeforeClear = (
            (await getWorkbenchLocator(page, workbenchSelectors.input).textContent()) || ''
          ).trim()

          await clearButton.click()
          const confirmCancel = page.locator('.ant-modal-confirm-btns .ant-btn-default')
          await confirmCancel.waitFor({ state: 'visible' })
          await confirmCancel.click()
          await page.locator('.ant-modal-confirm').waitFor({ state: 'hidden' }).catch(() => undefined)
          const userStillVisibleAfterCancel = await getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.userMessagePrefix
          )
            .first()
            .isVisible()

          await clearButton.click()
          const confirmOk = page.locator('.ant-modal-confirm-btns .ant-btn-dangerous')
          await confirmOk.waitFor({ state: 'visible' })
          await confirmOk.click()
          await clearButton.waitFor({ state: 'hidden' })

          const userMessageCount = await getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.userMessagePrefix
          ).count()
          await runtime.captureScreenshot({
            name: 'clear-messages-empty',
            message: '确认清空后消息列表为空，仍在同一伙伴。'
          })

          const partnerId = await page.evaluate(async (name) => {
            const partners = await window.api.partnerList()
            return partners.find((partner) => partner.name === name)?.id || null
          }, PARTNER_NAME)
          if (!partnerId) throw new Error('partner not found after clear')
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

          return {
            clearLabel,
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
                '清空消息记录胶囊文案与确认正确，取消不删、确认后消息为空且仍在同一伙伴，对齐 WB-SESSION-011。',
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
