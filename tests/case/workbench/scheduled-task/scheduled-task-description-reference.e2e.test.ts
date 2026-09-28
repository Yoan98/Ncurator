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
  selectScheduledTaskPartner,
  selectWorkbenchModel,
  setWorkbenchInput,
  setupWorkbenchWithTempWorkspace,
  workbenchSelectors,
  waitForScheduledTaskDrawerClosed,
  waitForWorkbenchMentionPanelText
} from '../../../harness/e2e/workbench'

const CASE_ID = 'scheduled-task-description-reference'
const PARTNER_NAME = '定时任务引用伙伴'
const TASK_NAME = '引用资料任务'
const DESCRIPTION_PREFIX = '请阅读资料并总结**要点**，'
const DESCRIPTION_SUFFIX = '并附上来源。'
const DESCRIPTION = `${DESCRIPTION_PREFIX} ${DESCRIPTION_SUFFIX}`

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
        description:
          '验证通用 Composer 输入框中的行内 @ 引用可保存、回填并在立即执行时传给伙伴消息。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        windowMode: 'visible',
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
          await selectScheduledTaskPartner(page, partner.id)
          await getWorkbenchLocator(page, scheduledTaskSelectors.formName).fill(TASK_NAME)
          await setWorkbenchInput(page, '@', scheduledTaskSelectors.formDescriptionInput)
          const mentionPanelText = await waitForWorkbenchMentionPanelText(
            page,
            scheduledTaskSelectors.formDescriptionInput
          )
          const mentionPanel = page.locator(
            `[data-testid="${scheduledTaskSelectors.formDescription}"] [data-testid="${workbenchSelectors.mentionPanel}"]`
          )
          const mentionPanelPlacement = await mentionPanel.evaluate((panel) => {
            const editor = document.querySelector<HTMLElement>(
              '[data-testid="scheduled-task-form-description-input"]'
            )
            const content = editor?.closest<HTMLElement>(
              '[data-testid="scheduled-task-form-content"]'
            )
            if (!editor || !content)
              throw new Error('scheduled-task mention geometry is unavailable')
            const panelRect = panel.getBoundingClientRect()
            const editorRect = editor.getBoundingClientRect()
            const contentRect = content.getBoundingClientRect()
            return {
              placement: panel.getAttribute('data-placement'),
              belowEditor: panelRect.top >= editorRect.bottom,
              insideContent:
                panelRect.top >= contentRect.top && panelRect.bottom <= contentRect.bottom
            }
          })
          await setWorkbenchInput(page, '', scheduledTaskSelectors.formDescriptionInput)
          await setWorkbenchInput(
            page,
            DESCRIPTION_PREFIX,
            scheduledTaskSelectors.formDescriptionInput
          )
          const markdownStayedLiteral =
            (await getWorkbenchLocator(page, scheduledTaskSelectors.formDescriptionInput)
              .locator('strong')
              .count()) === 0 &&
            (
              await getWorkbenchLocator(
                page,
                scheduledTaskSelectors.formDescriptionInput
              ).innerText()
            ).includes(DESCRIPTION_PREFIX)
          await insertWorkbenchReferenceToken(
            page,
            'sample-edit.docx',
            'sample-edit.docx',
            scheduledTaskSelectors.formDescriptionInput
          )
          await page.keyboard.insertText(DESCRIPTION_SUFFIX)
          const editorTokens = await getWorkbenchReferenceTokenTexts(
            page,
            scheduledTaskSelectors.formDescriptionInput
          )
          const tokenInlineWithText = await getWorkbenchLocator(
            page,
            scheduledTaskSelectors.formDescriptionInput
          ).evaluate((editor) => {
            const token = editor.querySelector<HTMLElement>('[data-role="scope-token"]')
            if (!token) return false
            const before = document.createRange()
            before.selectNodeContents(editor)
            before.setEndBefore(token)
            const after = document.createRange()
            after.selectNodeContents(editor)
            after.setStartAfter(token)
            return (
              before.toString().includes('**要点**') && after.toString().includes('并附上来源。')
            )
          })
          await getWorkbenchLocator(page, scheduledTaskSelectors.formSave).click()
          await waitForScheduledTaskDrawerClosed(page)

          const created = (await listTasks(page)).find((task) => task.name === TASK_NAME)
          if (!created) throw new Error('failed to create scheduled task')
          const storedReference = created.selectedReferences.some(
            (reference) => reference.name === 'sample-edit.docx'
          )
          const storedMarkdown = created.description === DESCRIPTION
          const storedContentNode = created.contentNodes.some(
            (node) => node.kind === 'reference' && node.reference.name === 'sample-edit.docx'
          )
          const storedReferenceFollowsText =
            created.contentNodes.findIndex((node) => node.kind === 'reference') >
            created.contentNodes.findIndex((node) => node.kind === 'text')

          await getWorkbenchLocator(
            page,
            `${scheduledTaskSelectors.itemEditPrefix}-${created.id}`
          ).click()
          const descriptionEditor = getWorkbenchLocator(
            page,
            scheduledTaskSelectors.formDescriptionInput
          )
          await descriptionEditor.waitFor({ state: 'visible' })
          const editTextBackfilled = await descriptionEditor.evaluate((editor) => {
            const token = editor.querySelector<HTMLElement>('[data-role="scope-token"]')
            if (!token) return false
            const before = document.createRange()
            before.selectNodeContents(editor)
            before.setEndBefore(token)
            const after = document.createRange()
            after.selectNodeContents(editor)
            after.setStartAfter(token)
            return (
              before.toString().includes('**要点**') && after.toString().includes('并附上来源。')
            )
          })
          const editTokens = await getWorkbenchReferenceTokenTexts(
            page,
            scheduledTaskSelectors.formDescriptionInput
          )
          const referenceTokenBackfilled = editTokens.some((text) =>
            text.includes('sample-edit.docx')
          )
          await getWorkbenchLocator(page, scheduledTaskSelectors.formCancel).click()
          await waitForScheduledTaskDrawerClosed(page)

          await getWorkbenchLocator(
            page,
            `${scheduledTaskSelectors.itemRunNowPrefix}-${created.id}`
          ).click()
          await page.locator('.ant-modal-confirm-btns .ant-btn-primary').click()

          let userMessage: ChatMessage | undefined
          const deadline = Date.now() + 30_000
          while (Date.now() < deadline) {
            userMessage = (await openPartnerMessages(page, partner.id)).find(
              (message) =>
                message.role === 'user' &&
                message.content.includes(DESCRIPTION.trim()) &&
                message.contentNodes?.some(
                  (node) => node.kind === 'reference' && node.reference.name === 'sample-edit.docx'
                )
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
            mentionPanelText,
            mentionPanelPlacement,
            editorTokens,
            markdownStayedLiteral,
            tokenInlineWithText,
            storedReference,
            storedMarkdown,
            storedContentNode,
            storedReferenceFollowsText,
            editTextBackfilled,
            referenceTokenBackfilled,
            messageReference: Boolean(messageReference),
            messageContentNode: Boolean(messageContentNode)
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.mentionPanelText.length > 0 &&
              result.mentionPanelPlacement.placement === 'below' &&
              result.mentionPanelPlacement.belowEditor &&
              result.mentionPanelPlacement.insideContent &&
              result.editorTokens.some((text) => text.includes('sample-edit.docx')) &&
              result.markdownStayedLiteral &&
              result.tokenInlineWithText &&
              result.storedReference &&
              result.storedMarkdown &&
              result.storedContentNode &&
              result.storedReferenceFollowsText &&
              result.editTextBackfilled &&
              result.referenceTokenBackfilled &&
              result.messageReference &&
              result.messageContentNode,
            {
              name: 'scheduled-task-description-reference-roundtrip',
              message:
                '定时任务通用输入框应把 @ 引用以内联 token 呈现并原位保存、回填，立即执行时仍传给绑定伙伴。',
              data: result
            }
          )
        }
      })
    },
    WORKBENCH_RESULT_E2E_TIMEOUT_MS
  )
})
