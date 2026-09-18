import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { runShowcaseCase } from '../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  configureLiveModelThroughSettingsUi,
  createPartnerThroughWorkbenchUi,
  loadWorkbenchLiveModelEnv,
  prepareWorkbenchWorkspaceThroughUi,
  recordWorkbenchAiEvidence,
  selectWorkbenchModel,
  sendWorkbenchMessage,
  waitForWorkbenchAiRunCompletion
} from '../harness/e2e/workbench'
import { WEB_SEARCH_PROMPT } from './createSeeds'
import {
  computeShowcaseCost,
  screenshotAssistantAnswer,
  seedEmptyShowcaseWorkspace
} from './shared'

const CASE_ID = 'chailv-tax-deduction'
const EXPORT_DIR = path.resolve('tests/logs/showcase/export/chailv-tax-deduction')

describe('showcase collection', () => {
  it(
    CASE_ID,
    async () => {
      await runShowcaseCase({
        caseId: CASE_ID,
        groups: ['web-search'],
        description:
          '官网样例：不指定网站，按网页搜索查国内差旅住宿和交通税前扣除口径，截馆长带来源的回答。',
        fixtures: [],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const env = loadWorkbenchLiveModelEnv()
          const rootPath = await seedEmptyShowcaseWorkspace('ncurator-showcase-search-')
          runtime.registerResource({
            name: `showcase-workspace:${rootPath}`,
            phase: 'after-app-close',
            dispose: async () => {
              await fs.rm(rootPath, {
                recursive: true,
                force: true,
                maxRetries: 10,
                retryDelay: 500
              })
            }
          })
          await configureLiveModelThroughSettingsUi(page, env)
          await prepareWorkbenchWorkspaceThroughUi(page, {
            workspaceName: '差旅报销口径',
            rootPath
          })
          await createPartnerThroughWorkbenchUi(page, '差旅报销口径')
          await selectWorkbenchModel(page, env.modelName)

          const startedAtMs = Date.now()
          await sendWorkbenchMessage(page, WEB_SEARCH_PROMPT)
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAtMs,
            env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page, blockerPolicy: 'auto_approve' }
          )
          recordWorkbenchAiEvidence(runtime, evidence, 0.8)

          await fs.rm(EXPORT_DIR, { recursive: true, force: true })
          await fs.mkdir(EXPORT_DIR, { recursive: true })
          const answerName = 'answer/reply.png'
          await screenshotAssistantAnswer(page, path.join(EXPORT_DIR, answerName))
          const screenshotStat = await fs.stat(path.join(EXPORT_DIR, answerName))
          const toolNames = evidence.events
            .filter((event) => event.type === 'tool_call_started')
            .map((event) => event.toolName)
          const cost = computeShowcaseCost(evidence.events, {
            modelName: env.modelName,
            prompt: WEB_SEARCH_PROMPT,
            fileName: '公开网页',
            screenshotNames: [],
            answerScreenshot: answerName,
            durationMs: evidence.durationMs,
            finalAnswerText: evidence.finalAnswerText
          })
          await fs.writeFile(
            path.join(EXPORT_DIR, 'cost.json'),
            `${JSON.stringify(cost, null, 2)}\n`
          )
          runtime.signal({
            name: 'showcase-web-search-cost',
            message: '官网网页搜索样例实际消耗',
            data: cost
          })

          return {
            screenshotBytes: screenshotStat.size,
            usageCalls: cost.usage.calls,
            cny: cost.cny,
            finalAnswerText: evidence.finalAnswerText,
            toolNames
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.screenshotBytes > 20_000 &&
              result.usageCalls > 0 &&
              result.toolNames.includes('web_search') &&
              /住宿|交通/u.test(result.finalAnswerText) &&
              /扣除|税前|企业所得税|个人所得税/u.test(result.finalAnswerText) &&
              /来源|http|gov|税务|财政/u.test(result.finalAnswerText),
            {
              name: 'showcase-chailv-tax-deduction-ready',
              message: '应通过网页搜索给出国内差旅税前扣除口径和来源。',
              data: {
                screenshotBytes: result.screenshotBytes,
                usageCalls: result.usageCalls,
                cny: result.cny,
                toolNames: result.toolNames,
                finalAnswerText: result.finalAnswerText
              }
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    1_800_000
  )
})
