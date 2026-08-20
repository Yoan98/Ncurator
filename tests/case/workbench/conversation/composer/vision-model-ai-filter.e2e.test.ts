import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, it } from 'vitest'
import type { Locator } from 'playwright'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import { createModelConfigThroughSettingsUi } from '../../../../harness/e2e/settings'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  getWorkbenchLocator,
  loadWorkbenchLiveModelEnv,
  navigateToWorkbench,
  selectWorkbenchModel,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'vision-model-ai-filter'
const MODEL_CONFIG_NAME = 'Live Model'

type Candidate = {
  configId: string
  modelId: string
}

type VisionAnalysisProxy = {
  baseUrl: string
  getAnalysisRequestCount: () => number
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

const isVisionAnalysisRequest = (body: Record<string, unknown>): boolean => {
  const messages = body.messages
  if (!Array.isArray(messages)) return false
  return messages.some((message) => {
    const content = (message as { content?: unknown }).content
    return typeof content === 'string' && content.includes('模型选型助手')
  })
}

const readCandidates = (body: Record<string, unknown>): Candidate[] => {
  const messages = body.messages
  if (!Array.isArray(messages)) return []
  for (const message of messages) {
    const content = (message as { content?: unknown }).content
    if (typeof content !== 'string' || !content.includes('"candidates"')) continue
    try {
      const parsed = JSON.parse(content) as { candidates?: Candidate[] }
      if (Array.isArray(parsed.candidates)) return parsed.candidates
    } catch {
      return []
    }
  }
  return []
}

const startVisionAnalysisProxy = async (upstream: {
  baseUrl: string
  apiKey: string
  modelName: string
  visualModelName: string
}): Promise<VisionAnalysisProxy> => {
  let analysisRequestCount = 0
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname

    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = Buffer.concat(chunks)

    const isChatRequest = request.method === 'POST' && pathname.endsWith('/chat/completions')
    if (isChatRequest && body.length > 0) {
      let parsed: Record<string, unknown> | null = null
      try {
        parsed = JSON.parse(body.toString('utf8')) as Record<string, unknown>
      } catch {
        parsed = null
      }
      if (parsed && isVisionAnalysisRequest(parsed)) {
        analysisRequestCount += 1
        const candidates = readCandidates(parsed)
        const models = candidates.map((candidate) => {
          let isVision = false
          let costTier = 2
          if (candidate.modelId === upstream.visualModelName) {
            isVision = true
            costTier = 1
          }
          if (candidate.modelId === upstream.modelName) {
            isVision = true
            costTier = 3
          }
          return { configId: candidate.configId, modelId: candidate.modelId, isVision, costTier }
        })
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            id: 'chatcmpl-vision-analysis-e2e',
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: 'vision-analysis-mock',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: JSON.stringify({ models }) },
                finish_reason: 'stop'
              }
            ],
            usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 }
          })
        )
        return
      }
    }

    try {
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
    throw new Error('failed to start vision analysis proxy server')
  }

  return {
    baseUrl: `http://127.0.0.1:${String((address as AddressInfo).port)}/v1`,
    getAnalysisRequestCount: () => analysisRequestCount,
    close: async () => closeServer(server)
  }
}

const readVisionResultRows = async (
  dropdown: Locator
): Promise<Array<{ text: string; cost: string }>> => {
  const options = dropdown.locator('[role="option"]')
  const count = await options.count()
  const rows: Array<{ text: string; cost: string }> = []
  for (let index = 0; index < count; index += 1) {
    const option = options.nth(index)
    const text = ((await option.innerText()) || '').trim()
    const cost = ((await option.locator('.workbench-select-cost').textContent()) || '').trim()
    rows.push({ text, cost })
  }
  return rows
}

const waitForVisionResultRows = async (dropdown: Locator, expectedCount: number): Promise<void> => {
  const deadline = Date.now() + WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  while (Date.now() < deadline) {
    const count = await dropdown.locator('[role="option"]').count()
    if (count >= expectedCount) return
    await new Promise<void>((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('vision analysis result options did not appear')
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
        description: '验证视觉模型 AI 筛选的分段切换、价格档位排序、刷新与独立请求副作用。',
        fixtures: [],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'background',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const liveEnv = loadWorkbenchLiveModelEnv()
          const provider = await startVisionAnalysisProxy(liveEnv)
          runtime.registerResource({
            name: 'vision-analysis-provider-server',
            phase: 'before-app-close',
            dispose: provider.close
          })

          await createModelConfigThroughSettingsUi(page, {
            name: MODEL_CONFIG_NAME,
            baseUrl: provider.baseUrl,
            apiKey: liveEnv.apiKey
          })
          await navigateToWorkbench(page, { waitForSessionListText: false })
          await selectWorkbenchModel(page, liveEnv.modelName)

          const modelSelect = getWorkbenchLocator(page, workbenchSelectors.modelSelect)
          await modelSelect.click()
          await page
            .locator('.workbench-select-menu.workbench-composer-menu')
            .last()
            .getByRole('button', { name: /^视觉模型/u })
            .click()
          const dropdown = page.locator('.workbench-select-menu.workbench-composer-menu').last()

          const manualTab = dropdown.getByTestId(workbenchSelectors.modelSelectVisionManualTab)
          const aiTab = dropdown.getByTestId(workbenchSelectors.modelSelectVisionAiTab)
          await manualTab.waitFor({ state: 'visible' })
          const manualSelectedByDefault =
            (await manualTab.getAttribute('aria-selected')) === 'true' &&
            (await dropdown
              .getByRole('option', { name: /跟随主模型/u })
              .isVisible()
              .catch(() => false))

          await aiTab.click()
          const runButton = dropdown.getByTestId(workbenchSelectors.modelSelectVisionAiRun)
          await runButton.waitFor({ state: 'visible' })
          await runtime.captureScreenshot({
            name: 'vision-ai-filter-idle',
            message: '切到 AI 筛选后先展示分析入口，不自动请求。'
          })

          await runButton.click()
          await waitForVisionResultRows(dropdown, 1)
          const firstRows = await readVisionResultRows(dropdown)
          const analysisRequestCountAfterFirst = provider.getAnalysisRequestCount()
          await runtime.captureScreenshot({
            name: 'vision-ai-filter-results',
            message: 'AI 筛选结果按价格从低到高排序并展示 $ 档位。'
          })

          const refreshButton = dropdown.getByTestId(workbenchSelectors.modelSelectVisionAiRefresh)
          await refreshButton.click()
          await waitForVisionResultRows(dropdown, 1)
          const secondRows = await readVisionResultRows(dropdown)
          const analysisRequestCountAfterRefresh = provider.getAnalysisRequestCount()

          const distinctNames =
            liveEnv.modelName === liveEnv.visualModelName
              ? [{ name: liveEnv.modelName, dollars: '$$$' }]
              : [
                  { name: liveEnv.visualModelName, dollars: '$' },
                  { name: liveEnv.modelName, dollars: '$$$' }
                ]

          const signals = await runtime.collectSignals()
          const runEventCount = signals.aiRunEventEntries.length

          let selectionClosed = false
          const firstOption = dropdown.locator('[role="option"]').first()
          await firstOption.click()
          selectionClosed = await dropdown.isHidden().catch(() => false)
          await runtime.captureScreenshot({
            name: 'vision-ai-filter-selected',
            message: '点击 AI 筛选结果后选中视觉模型并关闭弹层。'
          })

          return {
            manualSelectedByDefault,
            firstRows,
            secondRows,
            distinctNames,
            analysisRequestCountAfterFirst,
            analysisRequestCountAfterRefresh,
            runEventCount,
            selectionClosed,
            modelName: liveEnv.modelName,
            visualModelName: liveEnv.visualModelName
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(result.manualSelectedByDefault, {
            name: 'vision-ai-filter-defaults-to-manual',
            message: '视觉模型面板默认选中手动选择，且保留跟随主模型入口。',
            data: { manualSelectedByDefault: result.manualSelectedByDefault }
          })

          const assertRowsMatch = (rows: Array<{ text: string; cost: string }>): boolean => {
            if (rows.length !== result.distinctNames.length) return false
            return result.distinctNames.every((expected, index) => {
              return (
                rows[index]?.text.includes(expected.name) && rows[index]?.cost === expected.dollars
              )
            })
          }

          await runtime.assertThat(assertRowsMatch(result.firstRows), {
            name: 'vision-ai-filter-sorts-by-cost',
            message: 'AI 筛选结果仅展示视觉模型，按价格从低到高排序，$ 数量与档位一致。',
            data: { firstRows: result.firstRows, distinctNames: result.distinctNames }
          })
          await runtime.assertThat(assertRowsMatch(result.secondRows), {
            name: 'vision-ai-filter-refresh-updates',
            message: '点击刷新后重新分析并得到一致的结果。',
            data: { secondRows: result.secondRows }
          })
          await runtime.assertThat(
            result.analysisRequestCountAfterFirst === 1 &&
              result.analysisRequestCountAfterRefresh === 2,
            {
              name: 'vision-ai-filter-request-count',
              message: '分析只发起一次请求，刷新后追加一次请求。',
              data: {
                analysisRequestCountAfterFirst: result.analysisRequestCountAfterFirst,
                analysisRequestCountAfterRefresh: result.analysisRequestCountAfterRefresh
              }
            }
          )
          await runtime.assertThat(result.runEventCount === 0, {
            name: 'vision-ai-filter-is-standalone',
            message: 'AI 筛选请求独立于 human run，不产生任何 AI run 事件。',
            data: { runEventCount: result.runEventCount }
          })
          await runtime.assertThat(result.selectionClosed, {
            name: 'vision-ai-filter-selects-model',
            message: '点击结果项后选中视觉模型并关闭弹层。',
            data: { selectionClosed: result.selectionClosed }
          })
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
