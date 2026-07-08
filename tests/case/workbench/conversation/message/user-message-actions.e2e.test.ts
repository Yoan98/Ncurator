import { createServer, type Server } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import path from 'node:path'
import type { Page } from 'playwright'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import { seedActiveModelConfig, setSettingsE2EApiOverrides } from '../../../../harness/e2e/settings'
import {
  WORKBENCH_RESULT_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  createWorkbenchNewSession,
  getWorkbenchLocator,
  getWorkbenchPrefixLocator,
  navigateToWorkbench,
  selectWorkbenchWorkspace,
  setupWorkbenchWorkspaceOnly,
  submitWorkbenchCurrentDraft,
  switchWorkbenchMode,
  waitForAntMessageText,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'user-message-actions'
const RUNNING_MESSAGE = '请根据我刚附上的图片和文件做一个简短说明。'
const FAKE_MODEL_ID = 'workbench-user-message-actions-model'

type LocalOpenAiServer = {
  baseUrl: string
  close: () => Promise<void>
}

const startHangingOpenAiServer = async (): Promise<LocalOpenAiServer> => {
  const sockets = new Set<Socket>()
  const server = createServer((request, response) => {
    if (request.method === 'POST' && (request.url || '').includes('/chat/completions')) {
      request.resume()
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      })
      response.write(
        `data: ${JSON.stringify({
          id: `chatcmpl-${CASE_ID}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: FAKE_MODEL_ID,
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: '处理中' },
              finish_reason: null
            }
          ]
        })}\n\n`
      )
      const keepAlive = setInterval(() => {
        response.write(': keep-alive\n\n')
      }, 100)
      response.on('close', () => {
        clearInterval(keepAlive)
      })
      return
    }

    response.writeHead(404, {
      'content-type': 'application/json; charset=utf-8'
    })
    response.end(JSON.stringify({ error: { message: 'not found' } }))
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    await closeServerAndSockets(server, sockets)
    throw new Error('failed to start local OpenAI-compatible server')
  }

  return {
    baseUrl: `http://127.0.0.1:${String((address as AddressInfo).port)}/v1`,
    close: async () => {
      await closeServerAndSockets(server, sockets)
    }
  }
}

const closeServerAndSockets = async (server: Server, sockets: Set<Socket>): Promise<void> => {
  for (const socket of sockets) {
    socket.destroy()
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

const latestUserMessage = (page: Page) =>
  getWorkbenchPrefixLocator(page, workbenchSelectors.userMessagePrefix)
    .filter({ has: getWorkbenchLocator(page, workbenchSelectors.userMessageReferences) })
    .last()

const latestUserMessageActions = (page: Page) =>
  getWorkbenchPrefixLocator(page, workbenchSelectors.userMessageActionsPrefix).last()

const setWorkbenchDraftWithAttachments = async (
  page: Page,
  attachmentPath: string
): Promise<void> => {
  await page.evaluate(
    ({ message, filePath }) => {
      const targetWindow = window as Window & {
        __NCURATOR_E2E_SET_WORKBENCH_DRAFT__?: (draft: {
          input: string
          contentNodes: Array<{ kind: 'text'; text: string }>
          selectedReferences: []
          attachments: Array<{
            id: string
            kind: 'image' | 'file'
            name: string
            path: string
            mimeType: string
            size?: number
            status: 'ready'
          }>
        }) => void
      }
      const setDraft = targetWindow.__NCURATOR_E2E_SET_WORKBENCH_DRAFT__
      if (!setDraft) {
        throw new Error('workbench E2E draft hook is not available')
      }
      setDraft({
        input: message,
        contentNodes: [{ kind: 'text', text: message }],
        selectedReferences: [],
        attachments: [
          {
            id: 'picked-message-image',
            kind: 'image',
            name: 'message-image.png',
            path: filePath,
            mimeType: 'image/png',
            status: 'ready'
          },
          {
            id: 'picked-message-file',
            kind: 'file',
            name: 'message-note.txt',
            path: filePath,
            mimeType: 'text/plain',
            size: 24,
            status: 'ready'
          }
        ]
      })
    },
    { message: RUNNING_MESSAGE, filePath: attachmentPath }
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
        launchMode: 'fixture',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          await runtime.step({
            name: 'start-local-openai-server',
            message: '启动本地 OpenAI-compatible fake server',
            run: async () => null
          })
          const openAiServer = await startHangingOpenAiServer()
          let setup: Awaited<ReturnType<typeof setupWorkbenchWorkspaceOnly>> | null = null
          try {
            await runtime.step({
              name: 'seed-settings-and-workspace',
              message: '配置 fake model、附件 override，并创建工作区',
              run: async () => {
                setup = await setupWorkbenchWorkspaceOnly(page, {
                  caseId: CASE_ID,
                  workspaceName: 'Workbench User Message Actions Workspace'
                })
                const attachmentPath = path.join(setup.workspace.rootPath, 'human-input.txt')
                await setSettingsE2EApiOverrides(page, {
                  llmModelListResponseByConfigId: {
                    [FAKE_MODEL_ID]: {
                      success: true,
                      items: [{ id: FAKE_MODEL_ID, label: FAKE_MODEL_ID }]
                    }
                  },
                  attachmentRecognizeImageResponseByName: {
                    'message-image.png': {
                      success: true,
                      attachment: {
                        id: 'override-image',
                        kind: 'image',
                        name: 'message-image.png',
                        path: attachmentPath,
                        mimeType: 'image/png',
                        status: 'ready',
                        contentInfo: '蓝底 DS 测试图片'
                      }
                    }
                  },
                  attachmentParseFileResponseByName: {
                    'message-note.txt': {
                      success: true,
                      attachment: {
                        id: 'override-file',
                        kind: 'file',
                        name: 'message-note.txt',
                        path: attachmentPath,
                        mimeType: 'text/plain',
                        status: 'ready',
                        contentInfo: 'message attachment facts'
                      }
                    }
                  }
                })
                await seedActiveModelConfig(page, {
                  id: FAKE_MODEL_ID,
                  providerKind: 'openai-compatible',
                  base_url: openAiServer.baseUrl,
                  api_key: 'test-key',
                  is_active: true,
                  default_model: FAKE_MODEL_ID
                })
                await page.evaluate(() => {
                  window.dispatchEvent(new Event('check-llm-config'))
                })
              }
            })
            await runtime.step({
              name: 'prepare-composer',
              message: '打开 Workbench、选择工作区并注入带附件 draft',
              run: async () => {
                if (!setup) throw new Error('workspace setup missing')
                await navigateToWorkbench(page)
                await createWorkbenchNewSession(page)
                await selectWorkbenchWorkspace(page, setup.workspaceName)
                await switchWorkbenchMode(page, '大聪明')
                await setWorkbenchDraftWithAttachments(
                  page,
                  path.join(setup.workspace.rootPath, 'human-input.txt')
                )
              }
            })
            const imageComposerCard = getWorkbenchPrefixLocator(
              page,
              workbenchSelectors.attachmentCardPrefix
            ).filter({ has: page.locator('img[alt="message-image.png"]') })
            const fileComposerCard = getWorkbenchPrefixLocator(
              page,
              workbenchSelectors.attachmentCardPrefix
            ).filter({ hasText: 'message-note.txt' })
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
              attachmentsAboveBubble: Boolean(
                firstAttachmentBox && bubbleBox && firstAttachmentBox.y < bubbleBox.y
              )
            }
          } finally {
            await openAiServer.close()
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
              result.messageAttachmentTexts.some((text) => text.includes('message-note.txt')) &&
              result.attachmentsAboveBubble,
            {
              name: 'workbench-user-message-actions-and-attachments',
              message:
                '用户消息 hover 后应显示时间/复制/编辑；编辑会撤回 latest turn 并回填输入框；running 中不显示编辑；图片和文件附件应在用户消息气泡上方独立展示，输入框附件关闭按钮无遮挡。',
              data: result
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    WORKBENCH_RESULT_E2E_TIMEOUT_MS
  )
})
