import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, it } from 'vitest'
import type { AiRunEvent } from '../../../../../src/shared/types'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_E2E_TIMEOUT_MS,
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  configureLiveModelThroughSettingsUi,
  createTemporaryWorkbenchWorkspace,
  getWorkbenchLocator,
  loadWorkbenchLiveModelEnv,
  navigateToWorkbench,
  prepareWorkbenchWorkspaceThroughUi,
  sendWorkbenchMessage,
  switchWorkbenchMode,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'model-selector-and-provider-error'
const MISSING_MODEL_NAME = 'missing-model-must-not-be-created'
const UNAVAILABLE_MODEL_NAME = 'missing-provider-model-must-fail'
const WORKSPACE_NAME = 'Model Provider Error Workspace'

type ProviderServer = {
  baseUrl: string
  enableUnavailableModel: () => void
  getSuccessfulChatRequestCount: () => number
  getChatRequestCount: () => number
  close: () => Promise<void>
}

const closeServer = async (server: Server): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

const startProviderServer = async (upstream: {
  baseUrl: string
  apiKey: string
}): Promise<ProviderServer> => {
  let chatRequestCount = 0
  let successfulChatRequestCount = 0
  let unavailableModelEnabled = false
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname
    const isChatRequest = request.method === 'POST' && pathname.endsWith('/chat/completions')
    if (isChatRequest) {
      if (unavailableModelEnabled) chatRequestCount += 1
      else successfulChatRequestCount += 1
    }
    try {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      let body = Buffer.concat(chunks)
      if (isChatRequest && unavailableModelEnabled) {
        const payload = JSON.parse(body.toString('utf8')) as Record<string, unknown>
        body = Buffer.from(JSON.stringify({ ...payload, model: UNAVAILABLE_MODEL_NAME }))
      }
      const upstreamResponse = await fetch(
        `${upstream.baseUrl.replace(/\/$/u, '')}${pathname.replace(/^\/v1/u, '')}`,
        {
          method: request.method,
          headers: {
            Authorization: `Bearer ${upstream.apiKey}`,
            Accept: request.headers.accept || 'application/json',
            'Content-Type': request.headers['content-type'] || 'application/json'
          },
          body: body.length > 0 ? body : undefined
        }
      )
      const responseBody = Buffer.from(await upstreamResponse.arrayBuffer())
      response.writeHead(upstreamResponse.status, {
        'content-type': upstreamResponse.headers.get('content-type') || 'application/json'
      })
      response.end(responseBody)
    } catch (error) {
      response.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
      response.end(
        JSON.stringify({
          error: { message: error instanceof Error ? error.message : 'provider proxy failed' }
        })
      )
    }
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
    await closeServer(server)
    throw new Error('failed to start provider server')
  }

  return {
    baseUrl: `http://127.0.0.1:${String((address as AddressInfo).port)}/v1`,
    enableUnavailableModel: () => {
      unavailableModelEnabled = true
      chatRequestCount = 0
    },
    getSuccessfulChatRequestCount: () => successfulChatRequestCount,
    getChatRequestCount: () => chatRequestCount,
    close: async () => closeServer(server)
  }
}

const waitForRunFailed = async (
  collectEvents: () => Promise<AiRunEvent[]>
): Promise<Extract<AiRunEvent, { type: 'run_failed' }>> => {
  const deadline = Date.now() + WORKBENCH_E2E_TIMEOUT_MS
  while (Date.now() < deadline) {
    const event = (await collectEvents()).find(
      (item): item is Extract<AiRunEvent, { type: 'run_failed' }> => item.type === 'run_failed'
    )
    if (event) return event
    await new Promise<void>((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('run_failed event timed out')
}

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['composer'],
        description: '验证模型搜索空状态、配置分组折叠，以及模型服务 404 的统一错误处理。',
        fixtures: [],
        serviceMode: 'real',
        windowMode: 'background',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const liveEnv = loadWorkbenchLiveModelEnv()
          const provider = await startProviderServer(liveEnv)
          runtime.registerResource({
            name: 'model-provider-server',
            phase: 'before-app-close',
            dispose: provider.close
          })
          const workspace = await createTemporaryWorkbenchWorkspace(CASE_ID)
          await configureLiveModelThroughSettingsUi(page, {
            baseUrl: provider.baseUrl,
            apiKey: liveEnv.apiKey,
            modelName: liveEnv.modelName,
            visualModelName: liveEnv.modelName
          })
          await navigateToWorkbench(page, { waitForSessionListText: false })

          const modelSelect = getWorkbenchLocator(page, workbenchSelectors.modelSelect)
          await modelSelect.click()
          await page
            .locator('.workbench-select-menu.workbench-composer-menu')
            .last()
            .getByRole('button', { name: /^主模型/u })
            .click()
          const dropdown = page.locator('.workbench-select-menu.workbench-composer-menu').last()
          const searchInput = dropdown.locator('input[placeholder="搜索模型"]')
          await searchInput.waitFor({ state: 'visible' })

          const configButton = dropdown
            .getByRole('button', { name: /Live Model/u })
            .filter({ has: page.locator('svg') })
            .first()
          await configButton.waitFor({ state: 'visible' })
          const iconIsRightOfText = await configButton.evaluate((button) => {
            const content = button.firstElementChild
            return (
              content?.children.item(0)?.tagName.toLowerCase() === 'span' &&
              content?.children.item(1)?.tagName.toLowerCase() === 'svg'
            )
          })
          await configButton.click()
          const collapsed =
            (await configButton.getAttribute('aria-expanded')) === 'false' &&
            !(await dropdown
              .getByRole('option', { name: liveEnv.modelName })
              .isVisible()
              .catch(() => false))
          await configButton.click()
          const expanded =
            (await configButton.getAttribute('aria-expanded')) === 'true' &&
            (await dropdown.getByRole('option', { name: liveEnv.modelName }).isVisible())

          await searchInput.fill(MISSING_MODEL_NAME)
          await dropdown.getByText('暂无匹配模型', { exact: true }).waitFor({ state: 'visible' })
          const missingOptionCount = await dropdown
            .getByRole('option')
            .filter({
              hasText: MISSING_MODEL_NAME
            })
            .count()
          await runtime.captureScreenshot({
            name: 'model-selector-empty-search',
            message: '模型搜索无结果时显示空状态，不把搜索词创建成模型。'
          })

          await searchInput.fill('')
          await dropdown.getByRole('option', { name: liveEnv.modelName }).click()

          await prepareWorkbenchWorkspaceThroughUi(page, {
            workspaceName: WORKSPACE_NAME,
            rootPath: workspace.rootPath
          })
          await switchWorkbenchMode(page, '大聪明')
          const successStartedAt = Date.now()
          await sendWorkbenchMessage(page, '不要调用任何工具，只回复“测试成功”。')
          const successEvidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            successStartedAt,
            liveEnv.modelName,
            240_000,
            { page }
          )

          provider.enableUnavailableModel()
          await sendWorkbenchMessage(page, '不要调用任何工具，只回复“测试失败”。')

          const runFailed = await waitForRunFailed(async () => {
            const signals = await runtime.collectSignals()
            return signals.aiRunEventEntries.map((entry) => entry.event)
          })
          await page
            .getByText(new RegExp(`HTTP ${String(runFailed.httpStatus || '')}`, 'u'))
            .waitFor({ state: 'visible' })
          await page.getByText(runFailed.message, { exact: false }).waitFor({ state: 'visible' })
          const pageText = (await page.locator('body').innerText()).trim()
          await runtime.captureScreenshot({
            name: 'provider-error-visible',
            message: '模型服务错误在页面中显示，内部实现信息不对用户暴露。'
          })

          return {
            iconIsRightOfText,
            collapsed,
            expanded,
            missingOptionCount,
            successfulChatRequestCount: provider.getSuccessfulChatRequestCount(),
            successFinalAnswer: successEvidence.finalAnswerText,
            chatRequestCount: provider.getChatRequestCount(),
            modelName: liveEnv.modelName,
            runFailed,
            pageText
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.iconIsRightOfText &&
              result.collapsed &&
              result.expanded &&
              result.missingOptionCount === 0,
            {
              name: 'model-selector-search-and-collapse',
              message: '模型选择器应支持配置分组折叠，图标在文字右侧，搜索无结果时只显示空状态。',
              data: {
                iconIsRightOfText: result.iconIsRightOfText,
                collapsed: result.collapsed,
                expanded: result.expanded,
                missingOptionCount: result.missingOptionCount
              }
            }
          )
          await runtime.assertThat(
            result.successfulChatRequestCount > 0 && result.successFinalAnswer.includes('测试成功'),
            {
              name: 'configured-real-model-is-called',
              message: '环境变量配置的真实主模型应被调用并返回回答。',
              data: {
                modelName: result.modelName,
                successfulChatRequestCount: result.successfulChatRequestCount,
                successFinalAnswer: result.successFinalAnswer
              }
            }
          )
          await runtime.assertThat(
            result.chatRequestCount === 1 &&
              result.runFailed.source === 'provider' &&
              Number(result.runFailed.httpStatus || 0) >= 400 &&
              result.runFailed.message.trim().length > 0 &&
              result.pageText.includes(`HTTP ${String(result.runFailed.httpStatus || '')}`) &&
              result.pageText.includes(result.runFailed.message) &&
              !/LangGraph|LangChain|Troubleshooting URL|structured_output_|recursionLimit/iu.test(
                result.pageText
              ),
            {
              name: 'provider-error-is-not-reentered-into-graph',
              message: '模型服务错误应只请求一次并原样展示，不得泄露内部实现信息。',
              data: {
                chatRequestCount: result.chatRequestCount,
                runFailed: result.runFailed,
                leaksInternalDetails:
                  /LangGraph|LangChain|Troubleshooting URL|structured_output_|recursionLimit/iu.test(
                    result.pageText
                  )
              }
            }
          )
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
