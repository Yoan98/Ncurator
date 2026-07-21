import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Page } from 'playwright'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  WORKBENCH_RESULT_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  createWorkbenchNewSession,
  getWorkbenchLocator,
  getWorkbenchPrefixLocator,
  navigateToWorkbench,
  selectWorkbenchAttachmentThroughInjectedDialog,
  selectWorkbenchWorkspace,
  setupWorkbenchWithTempWorkspace,
  submitWorkbenchCurrentDraft,
  switchWorkbenchMode,
  waitForLatestAssistantProcess,
  waitForAntMessageText,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'user-message-actions'
const RUNNING_MESSAGE = '请根据我刚附上的文件做一个简短说明。'
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=',
  'base64'
)

const latestUserMessage = (page: Page) =>
  getWorkbenchPrefixLocator(page, workbenchSelectors.userMessagePrefix)
    .filter({ has: getWorkbenchLocator(page, workbenchSelectors.userMessageReferences) })
    .last()

const latestUserMessageActions = (page: Page) =>
  getWorkbenchPrefixLocator(page, workbenchSelectors.userMessageActionsPrefix).last()

const waitForAssistantProcessWithoutGap = async (page: Page, durationMs = 700): Promise<void> => {
  await page.waitForFunction(
    ({ prefix, duration }) => {
      const stateKey = '__NCURATOR_E2E_PROCESS_VISIBLE_SINCE__'
      const targetWindow = window as Window & {
        [stateKey]?: number
      }
      const nodes = Array.from(document.querySelectorAll(`[data-testid^="${prefix}-"]`))
      const visible = nodes.some((node) => {
        if (!(node instanceof HTMLElement)) return false
        const style = window.getComputedStyle(node)
        const rect = node.getBoundingClientRect()
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          rect.width > 0 &&
          rect.height > 0
        )
      })
      if (!visible) {
        delete targetWindow[stateKey]
        return false
      }
      if (!targetWindow[stateKey]) {
        targetWindow[stateKey] = performance.now()
      }
      return performance.now() - targetWindow[stateKey]! >= duration
    },
    {
      prefix: workbenchSelectors.assistantProcessPrefix,
      duration: durationMs
    },
    { timeout: WORKBENCH_RESULT_E2E_TIMEOUT_MS }
  )
}

const createUserMessageAttachmentFixtures = async (): Promise<{
  rootPath: string
  imagePath: string
  markdownPath: string
  cleanup: () => Promise<void>
}> => {
  const createdRootPath = await mkdtemp(
    path.join(os.tmpdir(), 'ncurator-user-message-attachments-')
  )
  const rootPath = await realpath(createdRootPath)
  const imagePath = path.join(rootPath, 'message-image.png')
  const markdownPath = path.join(rootPath, 'message-note.md')
  await Promise.all([
    writeFile(imagePath, ONE_PIXEL_PNG),
    writeFile(markdownPath, '# Message Note\n\nmessage attachment facts')
  ])
  return {
    rootPath,
    imagePath,
    markdownPath,
    cleanup: async () => {
      await rm(rootPath, { recursive: true, force: true })
    }
  }
}

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['message'],
        description:
          '验证用户消息 hover 操作、latest turn 编辑撤回、running 态隐藏编辑，以及用户消息附件独立展示和输入框附件关闭按钮无遮挡。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          let setup: Awaited<ReturnType<typeof setupWorkbenchWithTempWorkspace>> | null = null
          const attachments = await createUserMessageAttachmentFixtures()
          try {
            await runtime.step({
              name: 'prepare-live-model-and-workspace-through-ui',
              message: '通过 Settings UI 配置 live 模型，并创建真实工作区。',
              run: async () => {
                setup = await setupWorkbenchWithTempWorkspace(page, {
                  caseId: CASE_ID,
                  workspaceName: 'Workbench User Message Actions Workspace',
                  createSession: false
                })
              }
            })
            await runtime.step({
              name: 'prepare-composer',
              message: '打开 Workbench、选择工作区并粘贴消息附件',
              run: async () => {
                if (!setup) throw new Error('workspace setup missing')
                await navigateToWorkbench(page)
                await createWorkbenchNewSession(page)
                await selectWorkbenchWorkspace(page, setup.workspaceName)
                await switchWorkbenchMode(page, '大聪明')
                await getWorkbenchLocator(page, workbenchSelectors.input).click()
                await page.keyboard.type(RUNNING_MESSAGE)
                await selectWorkbenchAttachmentThroughInjectedDialog(
                  page,
                  attachments.markdownPath,
                  runtime.electronApp
                )
              }
            })
            const fileComposerCard = getWorkbenchPrefixLocator(
              page,
              workbenchSelectors.attachmentCardPrefix
            ).filter({ hasText: 'message-note.md' })
            await fileComposerCard.waitFor({ state: 'visible' })
            const fileRemoveButton = getWorkbenchPrefixLocator(
              page,
              workbenchSelectors.attachmentRemoveButtonPrefix
            ).last()
            await fileComposerCard.hover()
            const removeButtonBox = await fileRemoveButton.boundingBox()
            const fileCardBox = await fileComposerCard.boundingBox()
            const removeButtonVisible = await fileRemoveButton.isVisible().catch(() => false)

            await submitWorkbenchCurrentDraft(page)
            await page.waitForFunction(
              (input: { sendButtonTestId: string }) => {
                const button = document.querySelector(`[data-testid="${input.sendButtonTestId}"]`)
                return (button?.getAttribute('aria-label') || '').includes('停止')
              },
              { sendButtonTestId: workbenchSelectors.sendButton },
              { timeout: WORKBENCH_RESULT_E2E_TIMEOUT_MS }
            )
            const assistantProcess = await waitForLatestAssistantProcess(page)
            const assistantProcessTextAfterSend = (await assistantProcess.textContent()) || ''
            await waitForAssistantProcessWithoutGap(page)
            const assistantProcessTextAfterWait = (await assistantProcess.textContent()) || ''
            await page.waitForFunction(
              (input: { prefix: string }) =>
                document.querySelectorAll(`[data-testid^="${input.prefix}-"]`).length >= 1,
              { prefix: workbenchSelectors.userMessageAttachmentPrefix },
              { timeout: WORKBENCH_RESULT_E2E_TIMEOUT_MS }
            )
            const runningUser = latestUserMessage(page)
            await runningUser.hover()
            const runningEditButtons = await getWorkbenchPrefixLocator(
              page,
              workbenchSelectors.userMessageEditButtonPrefix
            ).count()
            const messageAttachmentTexts = await getWorkbenchPrefixLocator(
              page,
              workbenchSelectors.userMessageAttachmentPrefix
            ).evaluateAll((nodes) => nodes.map((node) => String(node.textContent || '').trim()))
            const bubbleBox = await runningUser
              .locator(`[data-testid="${workbenchSelectors.userMessageReferences}"]`)
              .boundingBox()
            const firstAttachmentBox = await getWorkbenchPrefixLocator(
              page,
              workbenchSelectors.userMessageAttachmentPrefix
            )
              .first()
              .boundingBox()
            const stopButtonLabel =
              (await getWorkbenchLocator(page, workbenchSelectors.sendButton).getAttribute(
                'aria-label'
              )) || ''
            if (stopButtonLabel.includes('停止')) {
              await getWorkbenchLocator(page, workbenchSelectors.sendButton).click()
            }
            await page.waitForFunction(
              (input: { sendButtonTestId: string }) => {
                const button = document.querySelector(`[data-testid="${input.sendButtonTestId}"]`)
                return !(button?.getAttribute('aria-label') || '').includes('停止')
              },
              { sendButtonTestId: workbenchSelectors.sendButton },
              { timeout: WORKBENCH_RESULT_E2E_TIMEOUT_MS }
            )
            await runningUser.hover()
            await latestUserMessageActions(page).waitFor({ state: 'visible' })
            const copyButton = getWorkbenchPrefixLocator(
              page,
              workbenchSelectors.userMessageCopyButtonPrefix
            ).last()
            const editButton = getWorkbenchPrefixLocator(
              page,
              workbenchSelectors.userMessageEditButtonPrefix
            ).last()
            await editButton.waitFor({ state: 'visible' })
            const actionButtonsVisible =
              (await copyButton.isVisible()) && (await editButton.isVisible())
            await copyButton.click()
            await waitForAntMessageText(page, '已复制')
            await editButton.click()
            await page.waitForFunction(
              (input: { testId: string; expected: string }) => {
                const element = document.querySelector(`[data-testid="${input.testId}"]`)
                return Boolean(element?.textContent?.includes(input.expected))
              },
              {
                testId: workbenchSelectors.input,
                expected: RUNNING_MESSAGE
              },
              { timeout: WORKBENCH_RESULT_E2E_TIMEOUT_MS }
            )
            const messageCountAfterEdit = await getWorkbenchPrefixLocator(
              page,
              workbenchSelectors.userMessagePrefix
            ).count()

            return {
              actionButtonsVisible,
              messageCountAfterEdit,
              removeButtonReachable: Boolean(
                removeButtonVisible &&
                removeButtonBox &&
                fileCardBox &&
                removeButtonBox.x < fileCardBox.x + fileCardBox.width &&
                removeButtonBox.x + removeButtonBox.width > fileCardBox.x &&
                removeButtonBox.y < fileCardBox.y + fileCardBox.height &&
                removeButtonBox.y + removeButtonBox.height > fileCardBox.y
              ),
              runningEditButtons,
              messageAttachmentTexts,
              assistantProcessTextAfterSend,
              assistantProcessTextAfterWait,
              attachmentsAboveBubble: Boolean(
                firstAttachmentBox && bubbleBox && firstAttachmentBox.y < bubbleBox.y
              )
            }
          } finally {
            await attachments.cleanup()
            await setup?.workspace.cleanup()
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.actionButtonsVisible &&
              result.messageCountAfterEdit === 0 &&
              result.removeButtonReachable &&
              result.runningEditButtons === 0 &&
              result.messageAttachmentTexts.some((text) => text.includes('message-note.md')) &&
              result.messageAttachmentTexts.some((text) => text.includes('MD')) &&
              result.assistantProcessTextAfterSend.includes('让俺想想') &&
              (result.assistantProcessTextAfterWait.includes('让俺想想') ||
                result.assistantProcessTextAfterWait.includes('处理中')) &&
              result.attachmentsAboveBubble,
            {
              name: 'workbench-user-message-actions-and-attachments',
              message:
                '用户消息 hover 后应显示时间/复制/编辑；编辑会撤回 latest turn 并回填输入框；running 中不显示编辑；发送后 assistant thinking 过程不能闪断；文件附件应在用户消息气泡上方独立展示，文件副标题显示扩展名，输入框附件关闭按钮无遮挡。',
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
