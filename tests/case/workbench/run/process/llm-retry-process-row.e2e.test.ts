import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, it } from 'vitest'
import type { Locator, Page } from 'playwright'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import { createModelConfigThroughSettingsUi } from '../../../../harness/e2e/settings'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  createPartnerThroughWorkbenchUi,
  loadWorkbenchLiveModelEnv,
  navigateToWorkbench,
  recordWorkbenchAiEvidence,
  selectWorkbenchModel,
  sendWorkbenchMessage,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'
import type { AiRunEvent } from '../../../../../src/shared/types'

const CASE_ID = 'llm-retry-process-row'
const PARTNER_NAME = 'LLM Retry Process'
const PROMPT = '不要调用任何工具，只回复“重试成功”。'
const FORCED_429_COUNT = 2
const RETRY_HEADING_RE =
  /正在重试\s*\d+\s*\/\s*\d+|已重试\s*\d+\s*\/\s*\d+|重试失败\s*\d+\s*\/\s*\d+|部分重试失败\s*\d+\s*\/\s*\d+/u
const RETRY_ATTEMPT_RE = /正在重试\s*(\d+)\s*\/\s*5/gu

type RateLimitProxy = {
  baseUrl: string
  getChatRequestCount: () => number
  getRateLimitedChatRequestCount: () => number
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

const startRateLimitProxy = async (upstream: {
  baseUrl: string
  apiKey: string
}): Promise<RateLimitProxy> => {
  let chatRequestCount = 0
  let rateLimitedChatRequestCount = 0
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname
    const isChatRequest = request.method === 'POST' && pathname.endsWith('/chat/completions')
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = Buffer.concat(chunks)

    if (isChatRequest) {
      chatRequestCount += 1
      if (chatRequestCount <= FORCED_429_COUNT) {
        rateLimitedChatRequestCount += 1
        response.writeHead(429, { 'content-type': 'application/json; charset=utf-8' })
        response.end(
          JSON.stringify({
            error: {
              message: 'Rate limit exceeded',
              type: 'rate_limit_exceeded',
              code: 'rate_limit_exceeded'
            }
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
    throw new Error('failed to start rate-limit proxy')
  }

  return {
    baseUrl: `http://127.0.0.1:${String((address as AddressInfo).port)}/v1`,
    getChatRequestCount: () => chatRequestCount,
    getRateLimitedChatRequestCount: () => rateLimitedChatRequestCount,
    close: async () => closeServer(server)
  }
}

const retryRowLocator = (root: Page | Locator): Locator =>
  root
    .locator(`[data-testid^="${workbenchSelectors.assistantProcessItemPrefix}-"]`)
    .filter({ hasText: RETRY_HEADING_RE })

const processRootLocator = (page: Page): Locator =>
  page
    .locator(
      `[data-testid^="${workbenchSelectors.assistantProcessPrefix}-"]:not([data-testid^="${workbenchSelectors.assistantProcessItemPrefix}-"])`
    )
    .last()

const sampleRetryUi = async (
  root: Page | Locator
): Promise<{
  processText: string
  rowCount: number
  attempts: number[]
  retryAndThinkingCoexist: boolean
}> => {
  const processText = ((await root.textContent({ timeout: 2_000 }).catch(() => '')) || '').trim()
  return {
    processText,
    rowCount: await retryRowLocator(root).count(),
    attempts: Array.from(processText.matchAll(RETRY_ATTEMPT_RE), (match) => Number(match[1])).filter(
      (value) => Number.isInteger(value) && value > 0
    ),
    retryAndThinkingCoexist: /正在重试/u.test(processText) && /让俺想想/u.test(processText)
  }
}

describe('workbench run e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'run',
        groups: ['process'],
        description:
          '受控 429 后验证 LLM 自动重试行从 1/5 就地更新、不叠多行，且不与「让俺想想」同时出现。',
        fixtures: [],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const liveEnv = loadWorkbenchLiveModelEnv()
          const proxy = await startRateLimitProxy({
            baseUrl: liveEnv.baseUrl,
            apiKey: liveEnv.apiKey
          })
          runtime.registerResource({
            name: 'llm-retry-rate-limit-proxy',
            phase: 'before-app-close',
            dispose: proxy.close
          })
          await createModelConfigThroughSettingsUi(page, {
            name: liveEnv.modelName,
            baseUrl: proxy.baseUrl,
            apiKey: liveEnv.apiKey
          })
          await navigateToWorkbench(page, { waitForSessionListText: false })
          await createPartnerThroughWorkbenchUi(page, PARTNER_NAME)
          await selectWorkbenchModel(page, liveEnv.modelName, { preferCustom: true })
          const startedAtMs = Date.now()
          await sendWorkbenchMessage(page, PROMPT)
          const processLocator = processRootLocator(page)
          await processLocator.waitFor({ state: 'visible', timeout: 30_000 })
          const retryOne = retryRowLocator(page).filter({ hasText: /正在重试\s*1\s*\/\s*5/u })
          await retryOne.waitFor({ state: 'visible', timeout: 20_000 })
          const firstRetry = await sampleRetryUi(processLocator)
          const retryTwo = retryRowLocator(page).filter({ hasText: /正在重试\s*2\s*\/\s*5/u })
          await retryTwo.waitFor({ state: 'visible', timeout: 20_000 })
          const secondRetry = await sampleRetryUi(processLocator)
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAtMs,
            liveEnv.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page }
          )
          recordWorkbenchAiEvidence(runtime, evidence, 0.9)
          const completedUi = await sampleRetryUi(page)
          const retryGroupIds = [
            ...new Set(
              evidence.events
                .filter(
                  (
                    event
                  ): event is Extract<AiRunEvent, { type: 'assistant_process_group_started' }> =>
                    event.type === 'assistant_process_group_started' &&
                    (event.kind === 'retry' || event.display.kind === 'retry')
                )
                .map((event) => event.groupId)
            )
          ]
          await runtime.captureScreenshot({
            name: 'llm-retry-process-row',
            message: '受控 429 成功后过程区不应再留着重试行。'
          })
          return {
            seenAttempts: [...new Set([...firstRetry.attempts, ...secondRetry.attempts])].sort(
              (left, right) => left - right
            ),
            stackedRetryRows:
              firstRetry.rowCount > 1 || secondRetry.rowCount > 1 || completedUi.rowCount > 0,
            retryAndThinkingCoexist:
              firstRetry.retryAndThinkingCoexist || secondRetry.retryAndThinkingCoexist,
            maxRetryRowCount: Math.max(firstRetry.rowCount, secondRetry.rowCount, completedUi.rowCount),
            firstRetryText: firstRetry.processText,
            secondRetryText: secondRetry.processText,
            completedProcessText: completedUi.processText,
            retryGroupIds,
            thinkingStuckAfterComplete: /让俺想想/u.test(completedUi.processText),
            retryLeftAfterComplete: /正在重试|已重试|重试失败/u.test(completedUi.processText),
            chatRequestCount: proxy.getChatRequestCount(),
            rateLimitedChatRequestCount: proxy.getRateLimitedChatRequestCount(),
            eventTypes: evidence.events.map((event) => event.type),
            finalAnswerText: evidence.finalAnswerText
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.rateLimitedChatRequestCount === FORCED_429_COUNT &&
              result.chatRequestCount > FORCED_429_COUNT &&
              result.seenAttempts.includes(1) &&
              result.seenAttempts.includes(2) &&
              !result.stackedRetryRows &&
              result.maxRetryRowCount === 1 &&
              result.retryGroupIds.length === 1 &&
              result.retryGroupIds[0]?.endsWith(':llm-retry') === true &&
              !result.retryAndThinkingCoexist &&
              !result.thinkingStuckAfterComplete &&
              !result.retryLeftAfterComplete &&
              !/已重试/u.test(result.completedProcessText) &&
              result.eventTypes.includes('answer_completed') &&
              result.eventTypes.includes('run_completed') &&
              result.finalAnswerText.trim().length > 0,
            {
              name: 'workbench-llm-retry-process-row',
              message:
                '受控 429 后过程区必须出现正在重试 1/5 并在同一行更新到 2/5，不得叠多行或与让俺想想同时出现；成功后不得留下已重试，对齐 WB-COMPOSER-015。',
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
