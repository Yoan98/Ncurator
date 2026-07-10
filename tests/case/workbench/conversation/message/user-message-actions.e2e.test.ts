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
  selectWorkbenchWorkspace,
  setupWorkbenchWithTempWorkspace,
  submitWorkbenchCurrentDraft,
  switchWorkbenchMode,
  waitForLatestAssistantProcess,
  waitForAntMessageText,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'user-message-actions'
const RUNNING_MESSAGE = '请根据我刚附上的图片和文件做一个简短说明。'

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

const pasteClipboardImageAttachment = async (
  page: Page,
  input: {
    name: string
    label: string
  }
): Promise<void> => {
  await page.evaluate(
    async ({ inputTestId, fileName, textLabel }) => {
      const element = document.querySelector(`[data-testid="${inputTestId}"]`)
      if (!(element instanceof HTMLElement)) {
        throw new Error('workbench input is not an HTMLElement')
      }
      element.focus()
      const canvas = document.createElement('canvas')
      canvas.width = 64
      canvas.height = 64
      const context = canvas.getContext('2d')
      if (!context) throw new Error('canvas context not available')
      context.fillStyle = '#2563EB'
      context.fillRect(0, 0, 64, 64)
      context.fillStyle = '#FFFFFF'
      context.font = 'bold 22px sans-serif'
      context.fillText(textLabel, 10, 40)
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((value) => {
          if (value) {
            resolve(value)
            return
          }
          reject(new Error('failed to create png blob'))
        }, 'image/png')
      })
      const file = new File([blob], fileName, { type: 'image/png' })
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(file)
      element.dispatchEvent(
        new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dataTransfer
        })
      )
    },
    {
      inputTestId: workbenchSelectors.input,
      fileName: input.name,
      textLabel: input.label
    }
  )
}

const pasteClipboardFileAttachment = async (
  page: Page,
  input: {
    name: string
    mimeType: string
    text: string
  }
): Promise<void> => {
  await page.evaluate(
    ({ inputTestId, fileName, mimeType, fileText }) => {
      const element = document.querySelector(`[data-testid="${inputTestId}"]`)
      if (!(element instanceof HTMLElement)) {
        throw new Error('workbench input is not an HTMLElement')
      }
      element.focus()
      const file = new File([fileText], fileName, { type: mimeType })
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(file)
      element.dispatchEvent(
        new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dataTransfer
        })
      )
    },
    {
      inputTestId: workbenchSelectors.input,
      fileName: input.name,
      mimeType: input.mimeType,
      fileText: input.text
    }
  )
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
        launchMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          let setup: Awaited<ReturnType<typeof setupWorkbenchWithTempWorkspace>> | null = null
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
                await pasteClipboardImageAttachment(page, {
                  name: 'message-image.png',
                  label: 'DS'
                })
                await pasteClipboardFileAttachment(page, {
                  name: 'message-note.md',
                  mimeType: 'text/markdown',
                  text: '# Message Note\n\nmessage attachment facts'
                })
              }
            })
            const imageComposerCard = getWorkbenchPrefixLocator(
              page,
              workbenchSelectors.attachmentCardPrefix
            ).filter({ has: page.locator('img[alt="message-image.png"]') })
            const fileComposerCard = getWorkbenchPrefixLocator(
              page,
              workbenchSelectors.attachmentCardPrefix
            ).filter({ hasText: 'message-note.md' })
            await imageComposerCard.waitFor({ state: 'visible' })
            await fileComposerCard.waitFor({ state: 'visible' })
            const fileRemoveButton = getWorkbenchPrefixLocator(
              page,
              workbenchSelectors.attachmentRemoveButtonPrefix
            ).last()
            await fileComposerCard.hover()
            const removeButtonBox = await fileRemoveButton.boundingBox()
            const fileCardBox = await fileComposerCard.boundingBox()

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
                document.querySelectorAll(`[data-testid^="${input.prefix}-"]`).length >= 2,
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
            const messageImageVisible = await getWorkbenchPrefixLocator(
              page,
              workbenchSelectors.userMessageAttachmentPrefix
            )
              .filter({ has: page.locator('img[alt="message-image.png"]') })
              .first()
              .isVisible()
              .catch(() => false)
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
              removeButtonInsideCard: Boolean(
                removeButtonBox &&
                fileCardBox &&
                removeButtonBox.x >= fileCardBox.x &&
                removeButtonBox.y >= fileCardBox.y &&
                removeButtonBox.x + removeButtonBox.width <= fileCardBox.x + fileCardBox.width &&
                removeButtonBox.y + removeButtonBox.height <= fileCardBox.y + fileCardBox.height
              ),
              runningEditButtons,
              messageAttachmentTexts,
              messageImageVisible,
              assistantProcessTextAfterSend,
              assistantProcessTextAfterWait,
              attachmentsAboveBubble: Boolean(
                firstAttachmentBox && bubbleBox && firstAttachmentBox.y < bubbleBox.y
              )
            }
          } finally {
            await setup?.workspace.cleanup()
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.actionButtonsVisible &&
              result.messageCountAfterEdit === 0 &&
              result.removeButtonInsideCard &&
              result.runningEditButtons === 0 &&
              result.messageImageVisible &&
              result.messageAttachmentTexts.some((text) => text.includes('message-note.md')) &&
              result.messageAttachmentTexts.some((text) => text.includes('MD')) &&
              result.assistantProcessTextAfterSend.includes('让俺想想') &&
              (result.assistantProcessTextAfterWait.includes('让俺想想') ||
                result.assistantProcessTextAfterWait.includes('处理中')) &&
              result.attachmentsAboveBubble,
            {
              name: 'workbench-user-message-actions-and-attachments',
              message:
                '用户消息 hover 后应显示时间/复制/编辑；编辑会撤回 latest turn 并回填输入框；running 中不显示编辑；发送后 assistant thinking 过程不能闪断；图片和文件附件应在用户消息气泡上方独立展示，文件副标题显示扩展名，输入框附件关闭按钮无遮挡。',
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
