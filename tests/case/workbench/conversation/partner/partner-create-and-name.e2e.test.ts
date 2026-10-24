import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  getWorkbenchLocator,
  sendWorkbenchMessage,
  selectWorkbenchModel,
  setupWorkbenchWithTempWorkspace,
  waitForWorkbenchAiRunCompletion,
  waitForVisiblePartnerRow,
  workbenchSelectors,
  recordWorkbenchAiEvidence
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'partner-create-and-name'
const PARTNER_NAME = '档案整理伙伴'
const FIRST_PROMPT =
  '请基于当前工作区的 human-input.txt，用一句话告诉我里面用于 workspace read validation 的事实。'
const SECOND_PROMPT = '再用一句话说明这条事实为什么适合做 Workbench 读文件验证。'

const readPartnerListText = async (page: import('playwright').Page): Promise<string> =>
  ((await getWorkbenchLocator(page, workbenchSelectors.partnersList).textContent()) || '').trim()

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['partner'],
        description:
          '真实 UI 无伙伴时展示空态；通过创建弹窗填写名称和形象后，侧栏标题就是名称，发消息不改名。',
        fixtures: ['tests/fixtures/workspace'],
        knowledge: 'cached',
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
          const emptyListText = await readPartnerListText(page)
          const emptyHintVisible = await page
            .getByText('还没有伙伴。从左侧创建一个开始对话。')
            .isVisible()
          const autoCreatedPartnerCount = await page.evaluate(
            async () => (await window.api.partnerList()).length
          )

          await getWorkbenchLocator(page, workbenchSelectors.newPartnerButton).click()
          const nameInput = getWorkbenchLocator(page, workbenchSelectors.createPartnerNameInput)
          await nameInput.waitFor({ state: 'visible' })
          await nameInput.fill(PARTNER_NAME)
          const modal = page.getByRole('dialog').filter({ has: nameInput })
          await modal.getByRole('button', { name: 'hexagon' }).click()
          await modal.getByRole('button', { name: 'teal' }).click()
          await modal.locator('.nc-config-footer .ant-btn-primary').click()
          await waitForVisiblePartnerRow(page, PARTNER_NAME)
          await getWorkbenchLocator(page, workbenchSelectors.input).waitFor({ state: 'visible' })
          await selectWorkbenchModel(page, setup.env.modelName)
          const afterCreateListText = await readPartnerListText(page)

          const createdPartner = await page.evaluate(async (name) => {
            const partners = await window.api.partnerList()
            return partners.find((partner) => partner.name === name) || null
          }, PARTNER_NAME)

          const firstStartedAtMs = Date.now()
          await sendWorkbenchMessage(page, FIRST_PROMPT)
          const firstEvidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            firstStartedAtMs,
            setup.env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page, blockerPolicy: 'auto_approve' }
          )
          recordWorkbenchAiEvidence(runtime, firstEvidence, 0.8)
          const afterFirstListText = await readPartnerListText(page)

          const secondStartedAtMs = Date.now()
          await sendWorkbenchMessage(page, SECOND_PROMPT)
          const secondEvidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            secondStartedAtMs,
            setup.env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page, blockerPolicy: 'auto_approve' }
          )
          recordWorkbenchAiEvidence(runtime, secondEvidence, 0.8)
          const afterSecondListText = await readPartnerListText(page)

          return {
            emptyListText,
            emptyHintVisible,
            autoCreatedPartnerCount,
            createdPartner,
            afterCreateListText,
            afterFirstListText,
            afterSecondListText,
            firstTitlePrefix: FIRST_PROMPT.slice(0, 20),
            secondTitlePrefix: SECOND_PROMPT.slice(0, 20),
            firstFinalAnswer: firstEvidence.finalAnswerText,
            secondFinalAnswer: secondEvidence.finalAnswerText
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.emptyHintVisible &&
              !result.emptyListText.includes('还没有伙伴') &&
              result.autoCreatedPartnerCount === 0 &&
              result.createdPartner?.name === PARTNER_NAME &&
              result.createdPartner.avatar_shape === 'hexagon' &&
              result.createdPartner.avatar_color === 'teal' &&
              result.afterCreateListText.includes(PARTNER_NAME) &&
              result.afterCreateListText.includes('做点啥呢？') &&
              result.afterFirstListText.includes(PARTNER_NAME) &&
              result.afterFirstListText.includes(result.firstTitlePrefix) &&
              !result.afterFirstListText.includes('做点啥呢？') &&
              result.afterSecondListText.includes(PARTNER_NAME) &&
              result.afterSecondListText.includes(result.secondTitlePrefix) &&
              !result.afterSecondListText.includes(result.firstTitlePrefix) &&
              result.firstFinalAnswer.trim().length > 0 &&
              result.secondFinalAnswer.trim().length > 0,
            {
              name: 'workbench-partner-create-and-name',
              message:
                '无伙伴时侧栏不展示空态文案、主区为空态；通过创建弹窗指定名称和形象后，侧栏标题保持为该名称，无消息时副文案为「做点啥呢？」，发送后更新为最新用户语句，发消息不得改名。',
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
