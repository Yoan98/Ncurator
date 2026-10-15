import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, it } from 'vitest'
import type { AiRunEvent } from '../../../../../src/shared/types'
import type { DesktopApi } from '../../../../../src/preload/api'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import { createModelConfigThroughSettingsUi } from '../../../../harness/e2e/settings'
import {
  WORKBENCH_E2E_TIMEOUT_MS,
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  createTemporaryWorkbenchWorkspace,
  createPartnerThroughWorkbenchUi,
  collectWorkbenchAiRunEvents,
  getWorkbenchLocator,
  loadWorkbenchLiveModelEnv,
  navigateToWorkbench,
  prepareWorkbenchWorkspaceThroughUi,
  selectWorkbenchModel,
  sendWorkbenchMessage,
  waitForWorkbenchAiRunCompletion,
  waitForWorkbenchAiEvent,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'model-selector-and-provider-error'
const MISSING_MODEL_NAME = 'missing-model-must-not-be-created'
const UNAVAILABLE_MODEL_NAME = 'missing-provider-model-must-fail'
const WORKSPACE_NAME = 'Model Provider Error Workspace'
const CANCEL_PROMPT =
  '请先调用 terminal_run 执行 pwd，成功后连续撰写一篇不少于三千字的科普文章，介绍海洋生态。'
const FAILURE_PROMPT = '请先调用 terminal_run 执行 pwd，成功后只回复“测试失败”。'

const verifyContextUsageForRun = async (
  runtime: Parameters<typeof collectWorkbenchAiRunEvents>[0],
  runId: string
): Promise<number> => {
  const started = (await collectWorkbenchAiRunEvents(runtime)).find(
    (event) => event.type === 'run_started' && event.runId === runId
  )
  if (started?.type !== 'run_started') throw new Error('run_started event is missing')
  const expected = await runtime.page.evaluate(async (partnerId) => {
    const currentWindow = window as Window & { api?: Pick<DesktopApi, 'aiContextUsageGet'> }
    if (!currentWindow.api) throw new Error('desktop API is unavailable')
    const usage = await currentWindow.api.aiContextUsageGet({ partnerId })
    if (!usage.success) throw new Error(usage.error || 'context usage query failed')
    const used = usage.usedContextTokens || 0
    const total = usage.contextWindowTokens || 0
    return { used, text: `${used.toLocaleString()} / ${total.toLocaleString()} tokens` }
  }, started.partnerId)
  await getWorkbenchLocator(runtime.page, workbenchSelectors.contextRing).hover()
  await runtime.page.getByRole('tooltip').getByText(expected.text, { exact: true }).waitFor({
    state: 'visible',
    timeout: 10_000
  })
  await runtime.page.mouse.move(0, 0)
  return expected.used
}

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
    try {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      let body = Buffer.concat(chunks)
      if (isChatRequest) {
        const payload = JSON.parse(body.toString('utf8')) as {
          model: string
          messages: Array<{ role: string }>
        }
        if (unavailableModelEnabled && payload.messages.at(-1)?.role === 'tool') {
          chatRequestCount += 1
          body = Buffer.from(JSON.stringify({ ...payload, model: UNAVAILABLE_MODEL_NAME }))
        } else {
          successfulChatRequestCount += 1
        }
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
        description:
          '验证未配置预设隐藏、统一目录 UI（右上角刷新/无分区标题/悬浮信息侧栏）、免费行或空态、搜索空状态，以及模型服务错误处理。',
        fixtures: [],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'background',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const liveEnv = loadWorkbenchLiveModelEnv()
          const provider = await startProviderServer({
            baseUrl: liveEnv.baseUrl,
            apiKey: liveEnv.apiKey
          })
          runtime.registerResource({
            name: 'model-provider-server',
            phase: 'before-app-close',
            dispose: provider.close
          })
          const workspace = await createTemporaryWorkbenchWorkspace(CASE_ID)
          await createModelConfigThroughSettingsUi(page, {
            name: liveEnv.modelName,
            baseUrl: provider.baseUrl,
            apiKey: liveEnv.apiKey
          })
          await navigateToWorkbench(page, { waitForSessionListText: false })
          await createPartnerThroughWorkbenchUi(page, WORKSPACE_NAME)
          const modelSelect = getWorkbenchLocator(page, workbenchSelectors.modelSelect)
          await modelSelect.click()
          const menu = page.locator('.workbench-select-menu.workbench-composer-menu').last()
          await menu.waitFor({ state: 'visible' })
          await menu
            .getByText('正在加载模型目录…', { exact: true })
            .waitFor({ state: 'hidden', timeout: 20_000 })
            .catch(() => undefined)
          const customEntry = menu.locator(
            `[data-testid="${workbenchSelectors.modelSelectCustomEntry}"]`
          )
          await customEntry.waitFor({ state: 'visible' })
          const catalogRefresh = menu.getByTestId(workbenchSelectors.modelSelectCatalogRefresh)
          const catalogRefreshVisible = await catalogRefresh.isVisible()
          const freeSectionTitleAbsent = !(await menu
            .getByText('免费模型', { exact: true })
            .isVisible()
            .catch(() => false))
          const presetOptions = menu.locator(
            `[data-testid^="${workbenchSelectors.modelSelectPresetOptionPrefix}-"]`
          )
          const freeOptions = menu.locator(
            `[data-testid^="${workbenchSelectors.modelSelectFreeOptionPrefix}-"]`
          )
          const presetOptionCount = await presetOptions.count()
          const freeOptionCount = await freeOptions.count()
          let inspectorVisibleOnHover = false
          let inspectorHasFreeNotice = false
          if (freeOptionCount > 0) {
            await freeOptions.first().hover()
            const inspector = page.getByTestId(workbenchSelectors.inspector)
            await inspector.waitFor({ state: 'visible' })
            inspectorVisibleOnHover = true
            inspectorHasFreeNotice = ((await inspector.innerText()) || '').includes(
              '不保证稳定和隐私性'
            )
          }
          const presetEmptyStateVisible = await menu
            .getByText('暂无已配置的预设模型', { exact: true })
            .isVisible()
            .catch(() => false)
          const catalogErrorVisible = await menu
            .getByText('模型目录加载失败', { exact: true })
            .isVisible()
            .catch(() => false)
          const freeRowHasBadge =
            freeOptionCount === 0
              ? true
              : ((await freeOptions.first().innerText()) || '').includes('免费')
          const freeRowHasIcon =
            freeOptionCount === 0 ? true : (await freeOptions.first().locator('img').count()) > 0
          const visionUiTextAbsent = !/(视觉模型|跟随主模型|图片能力)/u.test(
            (await menu.textContent()) || ''
          )
          await customEntry.click()
          const inspectorHiddenInCustom = !(await page
            .getByTestId(workbenchSelectors.inspector)
            .isVisible()
            .catch(() => false))
          const searchInput = menu.locator('input[placeholder="搜索模型"]')
          await searchInput.waitFor({ state: 'visible' })

          const providerGroupVisible = await menu
            .locator('button[aria-expanded]')
            .filter({ hasText: liveEnv.modelName })
            .first()
            .isVisible()

          await searchInput.fill(MISSING_MODEL_NAME)
          await menu.getByText('暂无匹配模型', { exact: true }).waitFor({ state: 'visible' })
          const missingOptionCount = await menu
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
          await menu.getByRole('option', { name: liveEnv.modelName, exact: true }).click()

          await prepareWorkbenchWorkspaceThroughUi(page, {
            workspaceName: WORKSPACE_NAME,
            rootPath: workspace.rootPath
          })
          await selectWorkbenchModel(page, liveEnv.modelName, { preferCustom: true })
          const customSelectedLabel = (
            await getWorkbenchLocator(page, workbenchSelectors.modelSelect).innerText()
          ).trim()
          const successStartedAt = Date.now()
          await sendWorkbenchMessage(page, '不要调用任何工具，只回复“测试成功”。')
          const successEvidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            successStartedAt,
            liveEnv.modelName,
            240_000,
            { page }
          )
          const successRun = successEvidence.events.find((event) => event.type === 'run_completed')
          if (!successRun) throw new Error('successful run completion event is missing')
          const successContextTokens = await verifyContextUsageForRun(runtime, successRun.runId)

          await sendWorkbenchMessage(page, CANCEL_PROMPT)
          const cancelStarted = await waitForWorkbenchAiEvent(runtime, {
            name: 'context-usage-cancel-started',
            matches: (event) => event.type === 'run_started' && event.input === CANCEL_PROMPT
          })
          const firstCancelRequest = await waitForWorkbenchAiEvent(runtime, {
            name: 'context-usage-cancel-requesting',
            matches: (event) =>
              event.type === 'llm_request_state' &&
              event.runId === cancelStarted.runId &&
              event.requesting
          })
          if (firstCancelRequest.type !== 'llm_request_state') {
            throw new Error('cancel request state event is missing')
          }
          await waitForWorkbenchAiEvent(runtime, {
            name: 'context-usage-cancel-tool-result',
            matches: (event) =>
              event.type === 'tool_call_result' &&
              event.runId === cancelStarted.runId &&
              event.toolName === 'terminal_run' &&
              event.result?.ok === true
          })
          await waitForWorkbenchAiEvent(runtime, {
            name: 'context-usage-cancel-followup-request',
            matches: (event) =>
              event.type === 'llm_request_state' &&
              event.runId === cancelStarted.runId &&
              event.callId !== firstCancelRequest.callId &&
              event.requesting
          })
          await getWorkbenchLocator(page, workbenchSelectors.sendButton).click()
          await waitForWorkbenchAiEvent(runtime, {
            name: 'context-usage-run-cancelled',
            matches: (event) =>
              event.type === 'run_cancelled' && event.runId === cancelStarted.runId
          })
          const cancelledContextTokens = await verifyContextUsageForRun(
            runtime,
            cancelStarted.runId
          )

          provider.enableUnavailableModel()
          await sendWorkbenchMessage(page, FAILURE_PROMPT)

          const runFailed = await waitForRunFailed(async () => {
            const signals = await runtime.collectSignals()
            return signals.aiRunEventEntries.map((entry) => entry.event)
          })
          const failedContextTokens = await verifyContextUsageForRun(runtime, runFailed.runId)
          const failureCard = page
            .getByTestId(new RegExp(`^${workbenchSelectors.assistantRunFailurePrefix}-`, 'u'))
            .last()
          await failureCard.waitFor({ state: 'visible' })
          await failureCard.getByText(`失败：${runFailed.message}`, { exact: false }).waitFor({
            state: 'visible'
          })
          const detailToggle = failureCard.getByTestId(
            new RegExp(`^${workbenchSelectors.assistantRunFailureDetailTogglePrefix}-`, 'u')
          )
          await detailToggle.click()
          const detail = failureCard.getByTestId(
            new RegExp(`^${workbenchSelectors.assistantRunFailureDetailPrefix}-`, 'u')
          )
          await detail.waitFor({ state: 'visible' })
          const detailText = (await detail.innerText()).trim()
          const pageText = (await page.locator('body').innerText()).trim()
          await runtime.captureScreenshot({
            name: 'provider-error-visible',
            message: '模型服务错误以短标题展示，详情中保留原文，内部实现信息不对用户暴露。'
          })

          return {
            presetOptionCount,
            freeOptionCount,
            presetEmptyStateVisible,
            catalogErrorVisible,
            catalogRefreshVisible,
            freeSectionTitleAbsent,
            inspectorVisibleOnHover,
            inspectorHasFreeNotice,
            inspectorHiddenInCustom,
            freeRowHasBadge,
            freeRowHasIcon,
            visionUiTextAbsent,
            providerGroupVisible,
            missingOptionCount,
            customSelectedLabel,
            successfulChatRequestCount: provider.getSuccessfulChatRequestCount(),
            successFinalAnswer: successEvidence.finalAnswerText,
            chatRequestCount: provider.getChatRequestCount(),
            modelName: liveEnv.modelName,
            runFailed,
            successContextTokens,
            cancelledContextTokens,
            failedContextTokens,
            detailText,
            pageText
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.successContextTokens > 0 &&
              result.cancelledContextTokens > result.successContextTokens &&
              result.failedContextTokens > result.cancelledContextTokens,
            {
              name: 'context-usage-refreshes-after-all-terminal-states',
              message: '成功、取消和失败后用量均应即时对齐上下文记录，无需切换伙伴。',
              data: {
                success: result.successContextTokens,
                cancelled: result.cancelledContextTokens,
                failed: result.failedContextTokens
              }
            }
          )
          const catalogSettled =
            result.freeOptionCount > 0 ||
            result.presetEmptyStateVisible ||
            result.catalogErrorVisible
          const inspectorOk =
            result.freeOptionCount === 0
              ? result.inspectorHiddenInCustom
              : result.inspectorVisibleOnHover &&
                result.inspectorHasFreeNotice &&
                result.inspectorHiddenInCustom
          await runtime.assertThat(
            result.presetOptionCount === 0 &&
              catalogSettled &&
              result.catalogRefreshVisible &&
              result.freeSectionTitleAbsent &&
              inspectorOk &&
              result.freeRowHasBadge &&
              result.freeRowHasIcon &&
              result.visionUiTextAbsent &&
              result.providerGroupVisible &&
              result.missingOptionCount === 0,
            {
              name: 'main-model-selector-search',
              message:
                '未配置预设服务商时不展示付费预设行；统一列表无「免费模型」标题；右上角刷新可见；有免费行时悬浮显示信息侧栏（含稳定性提示），自定义视图侧栏关闭；免费目录或空/失败态之一成立；自定义搜索无结果只显示空状态。',
              data: {
                presetOptionCount: result.presetOptionCount,
                freeOptionCount: result.freeOptionCount,
                presetEmptyStateVisible: result.presetEmptyStateVisible,
                catalogErrorVisible: result.catalogErrorVisible,
                catalogRefreshVisible: result.catalogRefreshVisible,
                freeSectionTitleAbsent: result.freeSectionTitleAbsent,
                inspectorVisibleOnHover: result.inspectorVisibleOnHover,
                inspectorHasFreeNotice: result.inspectorHasFreeNotice,
                inspectorHiddenInCustom: result.inspectorHiddenInCustom,
                freeRowHasBadge: result.freeRowHasBadge,
                freeRowHasIcon: result.freeRowHasIcon,
                visionUiTextAbsent: result.visionUiTextAbsent,
                providerGroupVisible: result.providerGroupVisible,
                missingOptionCount: result.missingOptionCount
              }
            }
          )
          await runtime.assertThat(result.customSelectedLabel.includes(result.modelName), {
            name: 'custom-model-selection-retained',
            message: '从自定义视图选中的模型名应保留在 Composer pill 上，不得被强制改回预设。',
            data: {
              customSelectedLabel: result.customSelectedLabel,
              modelName: result.modelName
            }
          })
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
              result.runFailed.code === 'llm_request_failed' &&
              Number(result.runFailed.httpStatus || 0) >= 400 &&
              result.runFailed.message.trim() === '模型请求失败' &&
              Boolean(result.runFailed.rawMessage?.trim()) &&
              result.pageText.includes(`失败：${result.runFailed.message}`) &&
              result.detailText.includes(String(result.runFailed.httpStatus)) &&
              result.detailText.includes(String(result.runFailed.rawMessage || '')) &&
              !/LangGraph|LangChain|Troubleshooting URL|structured_output_|recursionLimit/iu.test(
                result.pageText
              ),
            {
              name: 'provider-error-is-not-reentered-into-graph',
              message:
                '模型服务错误应只请求一次；气泡短标题为「模型请求失败」，详情保留 HTTP/原文，不得泄露内部实现信息。',
              data: {
                chatRequestCount: result.chatRequestCount,
                runFailed: result.runFailed,
                detailText: result.detailText,
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
