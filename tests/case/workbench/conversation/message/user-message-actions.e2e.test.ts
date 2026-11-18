import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Locator, Page } from 'playwright'
import { describe, expect, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  WORKBENCH_RESULT_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  getWorkbenchLocator,
  getWorkbenchPrefixLocator,
  getWorkbenchReferenceTokenTexts,
  insertWorkbenchReferenceToken,
  navigateToWorkbench,
  selectWorkbenchAttachmentThroughNativeDialog,
  setWorkbenchInput,
  setupWorkbenchWithTempWorkspace,
  submitWorkbenchCurrentDraft,
  waitForLatestAssistantProcess,
  waitForAntMessageText,
  waitForWorkbenchAiEvent,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'user-message-actions'
const RUNNING_MESSAGE = [
  `请根据我刚附上的文件做一个简短说明。下面的网址仅用于界面换行验证，不需要打开：https://example.com/view/${'a'.repeat(36)}?token=${'b'.repeat(64)}`,
  '',
  '下面几行只用于验证用户消息的折叠高度，不需要逐条处理：',
  '一、背景：这次会话同时包含附件、参考资料和长正文；',
  '二、目标：确认折叠后气泡保持固定高度，展开后能看到完整内容；',
  '三、范围：只检查用户消息气泡，不改变 assistant 的展示；',
  '四、约束：复制仍然复制全文，编辑规则不变；',
  '五、验收：折叠入口在气泡下方操作行，短消息不出现入口；',
  '六、说明：这些行是合成文本，不包含真实业务数据；',
  '七、补充：折叠时底部渐隐，展开后取消渐隐；',
  '八、结束：请仍然只回复一句简短说明。'
].join('\n')
const EDITED_MESSAGE = '这是编辑后的全新任务，请只回复：编辑后新任务。'
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

/** 运行期存活信号：文字尾部黑球、冷启动占位球或 Activity header 流光。 */
const countProcessLiveSignals = (scope: Locator): Promise<number> =>
  scope
    .locator(
      `[data-live-tail="true"], [data-testid="${workbenchSelectors.assistantLiveDot}"], .workbench-thinking-shimmer`
    )
    .count()

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
          '验证用户消息长文本折叠与展开、hover 操作、latest turn 编辑撤回、running 态隐藏编辑，以及用户消息附件独立展示和输入框附件关闭按钮无遮挡。',
        fixtures: ['tests/fixtures/workspace'],
        knowledge: 'cached',
        serviceMode: 'real',
        execution: 'exclusive',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          let setup: Awaited<ReturnType<typeof setupWorkbenchWithTempWorkspace>> | null = null
          const attachments = await createUserMessageAttachmentFixtures()
          runtime.registerResource({
            name: `user-message-attachments:${attachments.rootPath}`,
            phase: 'after-app-close',
            dispose: attachments.cleanup
          })
          await runtime.step({
            name: 'prepare-live-model-and-workspace-through-ui',
            message: '通过 Settings UI 配置 live 模型，并创建真实工作区。',
            run: async () => {
              setup = await setupWorkbenchWithTempWorkspace(page, {
                caseId: CASE_ID,
                workspaceName: 'Workbench User Message Actions Workspace'
              })
            }
          })
          await runtime.step({
            name: 'prepare-composer',
            message: '打开 Workbench、选择工作区并粘贴消息附件',
            run: async () => {
              if (!setup) throw new Error('workspace setup missing')
              await navigateToWorkbench(page)
              await getWorkbenchLocator(page, workbenchSelectors.input).click()
              await setWorkbenchInput(page, RUNNING_MESSAGE)
              await page.keyboard.press('Space')
              await insertWorkbenchReferenceToken(page, 'sample-edit.docx')
              await selectWorkbenchAttachmentThroughNativeDialog(page, attachments.markdownPath)
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

          const originalReferences = await getWorkbenchReferenceTokenTexts(page)
          expect(originalReferences).toEqual([expect.stringContaining('sample-edit.docx')])
          await submitWorkbenchCurrentDraft(page)
          const interruptedRunStarted = await waitForWorkbenchAiEvent(runtime, {
            name: 'user_message_edit_interrupted_run_started',
            matches: (event) =>
              event.type === 'run_started' && event.input.includes(RUNNING_MESSAGE)
          })
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
          const assistantLiveSignalAfterSend = await countProcessLiveSignals(assistantProcess)
          await waitForAssistantProcessWithoutGap(page)
          const assistantProcessTextAfterWait = (await assistantProcess.textContent()) || ''
          const assistantLiveSignalAfterWait = await countProcessLiveSignals(assistantProcess)
          await page.waitForFunction(
            (input: { prefix: string }) =>
              document.querySelectorAll(`[data-testid^="${input.prefix}-"]`).length >= 1,
            { prefix: workbenchSelectors.userMessageAttachmentPrefix },
            { timeout: WORKBENCH_RESULT_E2E_TIMEOUT_MS }
          )
          const runningUser = latestUserMessage(page)
          const runningUserText = runningUser.locator(
            `[data-testid="${workbenchSelectors.userMessageReferences}"]`
          )
          const foldToggle = getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.userMessageFoldTogglePrefix
          ).last()
          await foldToggle.waitFor({ state: 'visible' })
          const foldToggleTestId = await foldToggle.getAttribute('data-testid')
          if (!foldToggleTestId) throw new Error('user message fold toggle missing test id')
          const collapsedBubbleHeight = await runningUserText.evaluate(
            (element) => (element.parentElement as HTMLElement).getBoundingClientRect().height
          )
          const collapsedTextHeight = await runningUserText.evaluate(
            (element) => element.getBoundingClientRect().height
          )
          const collapsedTextScrollHeight = await runningUserText.evaluate(
            (element) => element.scrollHeight
          )
          const collapseToggleLabel = ((await foldToggle.textContent()) || '').trim()
          await foldToggle.click()
          await page.waitForFunction(
            (input: { testId: string; expected: string }) =>
              document
                .querySelector(`[data-testid="${input.testId}"]`)
                ?.textContent?.includes(input.expected) === true,
            { testId: foldToggleTestId, expected: '收起' },
            { timeout: WORKBENCH_RESULT_E2E_TIMEOUT_MS }
          )
          const expandedToggleLabel = ((await foldToggle.textContent()) || '').trim()
          const expandedAria = await foldToggle.getAttribute('aria-expanded')
          const expandedTextHeight = await runningUserText.evaluate(
            (element) => element.getBoundingClientRect().height
          )
          await foldToggle.click()
          await page.waitForFunction(
            (input: { testId: string; expected: string }) =>
              document
                .querySelector(`[data-testid="${input.testId}"]`)
                ?.textContent?.includes(input.expected) === true,
            { testId: foldToggleTestId, expected: '展开全文' },
            { timeout: WORKBENCH_RESULT_E2E_TIMEOUT_MS }
          )
          const restoredTextHeight = await runningUserText.evaluate(
            (element) => element.getBoundingClientRect().height
          )
          const restoredAria = await foldToggle.getAttribute('aria-expanded')
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
          const bubbleGeometry = await runningUser
            .locator(`[data-testid="${workbenchSelectors.userMessageReferences}"]`)
            .evaluate((content) => {
              const bubble = content.parentElement
              const message = content.closest('[data-message-id]')
              if (!(bubble instanceof HTMLElement) || !(message instanceof HTMLElement)) {
                return null
              }
              const bubbleRect = bubble.getBoundingClientRect()
              const messageRect = message.getBoundingClientRect()
              return {
                bubbleWidth: bubbleRect.width,
                messageWidth: messageRect.width,
                bubbleLeft: bubbleRect.left,
                messageLeft: messageRect.left,
                bubbleRight: bubbleRect.right,
                messageRight: messageRect.right,
                scrollWidth: bubble.scrollWidth,
                clientWidth: bubble.clientWidth
              }
            })
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
          const interruptedRunCancelled = await waitForWorkbenchAiEvent(runtime, {
            name: 'user_message_edit_interrupted_run_cancelled',
            matches: (event) =>
              event.type === 'run_cancelled' && event.runId === interruptedRunStarted.runId
          })
          if (interruptedRunCancelled.type !== 'run_cancelled') {
            throw new Error('stopped run did not reach the cancelled state before message edit')
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
          const actionsText = ((await latestUserMessageActions(page).textContent()) || '').trim()
          const timeLabel = getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.userMessageTimePrefix
          ).first()
          const timeLabelVisible = await timeLabel.isVisible().catch(() => false)
          const timeLabelText = ((await timeLabel.textContent().catch(() => '')) || '').trim()
          await copyButton.click()
          await waitForAntMessageText(page, '已复制')

          const composer = getWorkbenchLocator(page, workbenchSelectors.input)
          const otherDraft = '保留当前草稿'
          await setWorkbenchInput(page, otherDraft)
          await runningUser.hover()
          await editButton.click()
          await getWorkbenchLocator(page, workbenchSelectors.editMessageConfirmCancelButton).click()
          await page.locator('.ant-modal-confirm').waitFor({ state: 'hidden' })
          expect(await runningUser.isVisible()).toBe(true)
          expect(await composer.textContent()).toContain(otherDraft)
          expect(await fileComposerCard.count()).toBe(0)

          const confirmRecall = async () => {
            await runningUser.hover()
            await editButton.click()
            await getWorkbenchLocator(page, workbenchSelectors.editMessageConfirmButton).click()
            await page.locator('.ant-modal-confirm').waitFor({ state: 'hidden' })
          }
          const database = new DatabaseSync(path.join(runtime.userDataDir, 'app.sqlite'))
          try {
            database.exec('PRAGMA busy_timeout = 3000')
            database.exec(`CREATE TRIGGER test_recall_write_failure BEFORE DELETE ON chat_session_message_log
              BEGIN SELECT RAISE(ABORT, 'isolated recall write failure'); END`)
            await confirmRecall()
            await waitForAntMessageText(page, 'isolated recall write failure')
            expect(await runningUser.isVisible()).toBe(true)
            expect(await composer.textContent()).toContain(otherDraft)
            expect(await getWorkbenchReferenceTokenTexts(page)).toEqual([])
            expect(await fileComposerCard.count()).toBe(0)
            expect(
              database
                .prepare('SELECT COUNT(*) AS count FROM ai_run WHERE id = ?')
                .get(interruptedRunStarted.runId)?.count
            ).toBe(1)
          } finally {
            try {
              database.exec('DROP TRIGGER IF EXISTS test_recall_write_failure')
            } finally {
              database.close()
            }
          }
          await confirmRecall()
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
          await fileComposerCard.waitFor({ state: 'visible' })
          expect(await getWorkbenchReferenceTokenTexts(page)).toEqual(originalReferences)
          const messageCountAfterEdit = await getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.userMessagePrefix
          ).count()
          await setWorkbenchInput(page, EDITED_MESSAGE)
          const editedRunStartedAt = Date.now()
          await submitWorkbenchCurrentDraft(page)
          await waitForWorkbenchAiEvent(runtime, {
            name: 'edited_message_fresh_run_started',
            matches: (event) => event.type === 'run_started' && event.input === EDITED_MESSAGE
          })
          if (!setup) throw new Error('workspace setup missing before edited run completion')
          await waitForWorkbenchAiRunCompletion(
            runtime,
            editedRunStartedAt,
            setup.env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page }
          )
          const editedUserMessage = latestUserMessage(page)
          const shortMessageFoldToggleCount = await editedUserMessage
            .locator(`[data-testid^="${workbenchSelectors.userMessageFoldTogglePrefix}-"]`)
            .count()
          const shortMessageTextHeight = await editedUserMessage
            .locator(`[data-testid="${workbenchSelectors.userMessageReferences}"]`)
            .evaluate((element) => element.getBoundingClientRect().height)
          return {
            actionButtonsVisible,
            actionsHasHoverTime: /\d{1,2}:\d{2}/.test(actionsText),
            timeLabelVisible,
            timeLabelText,
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
            assistantLiveSignalAfterSend,
            assistantLiveSignalAfterWait,
            interruptedRunCancelled: interruptedRunCancelled.type === 'run_cancelled',
            bubbleGeometry,
            attachmentsAboveBubble: Boolean(
              firstAttachmentBox && bubbleBox && firstAttachmentBox.y < bubbleBox.y
            ),
            collapsedBubbleHeight,
            collapsedTextHeight,
            collapsedTextScrollHeight,
            collapseToggleLabel,
            expandedToggleLabel,
            expandedAria,
            expandedTextHeight,
            restoredTextHeight,
            restoredAria,
            shortMessageFoldToggleCount,
            shortMessageTextHeight
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.actionButtonsVisible &&
              result.actionsHasHoverTime === false &&
              result.timeLabelVisible &&
              /\d{1,2}:\d{2}/.test(result.timeLabelText) &&
              result.messageCountAfterEdit === 0 &&
              result.removeButtonReachable &&
              result.runningEditButtons === 0 &&
              result.messageAttachmentTexts.length > 0 &&
              result.messageAttachmentTexts.every((text) => text === 'message-note.md') &&
              result.assistantProcessTextAfterSend.length > 0 &&
              result.assistantLiveSignalAfterSend > 0 &&
              result.assistantLiveSignalAfterWait > 0 &&
              result.interruptedRunCancelled &&
              result.bubbleGeometry !== null &&
              result.bubbleGeometry.bubbleWidth <= result.bubbleGeometry.messageWidth * 0.66 + 1 &&
              result.bubbleGeometry.bubbleLeft >= result.bubbleGeometry.messageLeft - 1 &&
              result.bubbleGeometry.bubbleRight <= result.bubbleGeometry.messageRight + 1 &&
              result.bubbleGeometry.scrollWidth <= result.bubbleGeometry.clientWidth + 1 &&
              result.attachmentsAboveBubble &&
              Math.abs(result.collapsedBubbleHeight - 188) <= 1 &&
              Math.abs(result.collapsedTextHeight - 168) <= 1 &&
              result.collapsedTextScrollHeight > result.collapsedTextHeight + 1 &&
              result.collapseToggleLabel === '展开全文' &&
              result.expandedToggleLabel === '收起' &&
              result.expandedAria === 'true' &&
              Math.abs(result.expandedTextHeight - result.collapsedTextScrollHeight) <= 2 &&
              Math.abs(result.restoredTextHeight - 168) <= 1 &&
              result.restoredAria === 'false' &&
              result.shortMessageFoldToggleCount === 0 &&
              result.shortMessageTextHeight < 168,
            {
              name: 'workbench-user-message-actions-and-attachments',
              message:
                '用户消息气泡上方应居中展示时间条；长消息默认折叠到正文 168px、气泡 188px，底部渐隐，操作行可见「展开全文」；展开后显示完整文本并变为「收起」，收起后恢复 168px；短消息不出现折叠入口；hover 后应显示复制/编辑且不含时间；编辑会撤回 latest turn 及其消息日志并以新 run 重发；running 中不显示编辑；发送后运行期存活信号不能闪断；文件附件应在用户消息气泡上方独立展示且顶边不被横滑裁切，只显示文件名、不显示副标题，输入框附件关闭按钮无遮挡。',
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
