import { describe, it } from 'vitest'
import type { ChatMessage, PartnerListItem, ScheduledTask } from '../../../../src/shared/types'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_RESULT_E2E_TIMEOUT_MS,
  createPartnerThroughWorkbenchUi,
  getWorkbenchLocator,
  getWorkbenchReferenceTokenTexts,
  insertWorkbenchReferenceToken,
  openScheduledTasksView,
  scheduledTaskSelectors,
  selectWorkbenchModel,
  setWorkbenchInput,
  setupWorkbenchWithTempWorkspace
} from '../../../harness/e2e/workbench'

const CASE_ID = 'scheduled-task-description-reference'
const PARTNER_NAME = '定时任务引用伙伴'
const TASK_NAME = '引用资料任务'
const DESCRIPTION = '请阅读资料并总结要点'

const listTasks = async (page: import('playwright').Page): Promise<ScheduledTask[]> =>
  (await page.evaluate(async () => await window.api.scheduledTaskList())) as ScheduledTask[]

const listPartners = async (page: import('playwright').Page): Promise<PartnerListItem[]> =>
  (await page.evaluate(async () => await window.api.partnerList())) as PartnerListItem[]

const openPartnerMessages = async (
  page: import('playwright').Page,
  partnerId: string
): Promise<ChatMessage[]> =>
  page.evaluate(
    async (id) => (await window.api.partnerOpen({ partnerId: id, limit: 50 })).messages || [],
    partnerId
  )

describe('workbench scheduled-task e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'scheduled-task',
        groups: [],
        description: '验证定时任务描述编辑器支持 @ 引用，并在立即执行时把引用传给伙伴消息。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'live',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID,
            workspaceName: `Workbench ${CASE_ID}`,
            createPartner: false
          })
          await createPartnerThroughWorkbenchUi(page, PARTNER_NAME)
          await selectWorkbenchModel(page, setup.env.modelName)
          const partner = (await listPartners(page)).find((item) => item.name === PARTNER_NAME)
          if (!partner) throw new Error('failed to locate scheduled-task partner')

          await openScheduledTasksView(page)
          await getWorkbenchLocator(page, scheduledTaskSelectors.addButton).click()
          await getWorkbenchLocator(page, scheduledTaskSelectors.formPartner).click()
          await page.getByRole('option', { name: PARTNER_NAME, exact: true }).click()
          await getWorkbenchLocator(page, scheduledTaskSelectors.formName).fill(TASK_NAME)
          await setWorkbenchInput(page, DESCRIPTION, scheduledTaskSelectors.formDescription)
          await insertWorkbenchReferenceToken(
            page,
            'sample-edit.docx',
            'sample-edit.docx',
            scheduledTaskSelectors.formDescription
          )
          const editorTokens = await getWorkbenchReferenceTokenTexts(
            page,
            scheduledTaskSelectors.formDescription
          )
          await getWorkbenchLocator(page, scheduledTaskSelectors.formSave).click()

          const created = (await listTasks(page)).find((task) => task.name === TASK_NAME)
          if (!created) throw new Error('failed to create scheduled task')
          const storedReference = created.selectedReferences.some(
            (reference) => reference.name === 'sample-edit.docx'
          )
          const storedContentNode = created.contentNodes.some(
            (node) => node.kind === 'reference' && node.reference.name === 'sample-edit.docx'
          )

          await getWorkbenchLocator(
            page,
            `${scheduledTaskSelectors.itemRunNowPrefix}-${created.id}`
          ).click()
          await page.locator('.ant-modal-confirm-btns .ant-btn-primary').click()

          let userMessage: ChatMessage | undefined
          const deadline = Date.now() + 30_000
          while (Date.now() < deadline) {
            userMessage = (await openPartnerMessages(page, partner.id)).find(
              (message) => message.role === 'user' && message.content.includes(DESCRIPTION)
            )
            if (userMessage) break
            await page.waitForTimeout(500)
          }
          const messageReference = userMessage?.selectedReferences?.some(
            (reference) => reference.name === 'sample-edit.docx'
          )
          const messageContentNode = userMessage?.contentNodes?.some(
            (node) => node.kind === 'reference' && node.reference.name === 'sample-edit.docx'
          )

          return {
            editorTokens,
            storedReference,
            storedContentNode,
            messageReference: Boolean(messageReference),
            messageContentNode: Boolean(messageContentNode)
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.editorTokens.some((text) => text.includes('sample-edit.docx')) &&
              result.storedReference &&
              result.storedContentNode &&
              result.messageReference &&
              result.messageContentNode,
            {
              name: 'scheduled-task-description-reference-roundtrip',
              message: '定时任务描述中的引用应保存，并在立即执行提交给绑定伙伴。',
              data: result
            }
          )
        }
      })
    },
    WORKBENCH_RESULT_E2E_TIMEOUT_MS
  )
})
