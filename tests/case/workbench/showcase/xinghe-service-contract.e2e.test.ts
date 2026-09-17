import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  appendWorkbenchInputText,
  assertNoWorkbenchFakeSignals,
  configureLiveModelThroughSettingsUi,
  createPartnerThroughWorkbenchUi,
  insertWorkbenchReferenceToken,
  loadWorkbenchLiveModelEnv,
  prepareWorkbenchWorkspaceThroughUi,
  recordWorkbenchAiEvidence,
  selectWorkbenchModel,
  submitWorkbenchCurrentDraft,
  waitForWorkbenchAiRunCompletion
} from '../../../harness/e2e/workbench'
import { PDF_FILE_NAME, PDF_PROMPT, seedPdfContractWorkspace } from './createSeeds'
import { computeShowcaseCost, copyShowcaseFixture, rasterizePdfPages, screenshotAssistantAnswer } from './shared'

const CASE_ID = 'xinghe-service-contract'
const EXPORT_DIR = path.resolve('tests/logs/workbench/showcase-export/xinghe-service-contract')
const QUESTION = '尾款什么时候付？'

describe('workbench showcase e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'showcase',
        groups: ['pdf'],
        description: '官网样例：@星河项目服务合同.pdf 追问尾款，截原文页和馆长回答对照。',
        fixtures: [],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const env = loadWorkbenchLiveModelEnv()
          const rootPath = await seedPdfContractWorkspace()
          const filePath = path.join(rootPath, PDF_FILE_NAME)
          const beforeBuffer = await fs.readFile(filePath)
          runtime.registerResource({
            name: `showcase-workspace:${rootPath}`,
            phase: 'after-app-close',
            dispose: async () => {
              await fs.rm(rootPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
            }
          })
          await configureLiveModelThroughSettingsUi(page, env)
          await prepareWorkbenchWorkspaceThroughUi(page, {
            workspaceName: '云枢合同资料',
            rootPath
          })
          await createPartnerThroughWorkbenchUi(page, '云枢合同资料')
          await selectWorkbenchModel(page, env.modelName)

          const startedAtMs = Date.now()
          await insertWorkbenchReferenceToken(page, PDF_FILE_NAME)
          await appendWorkbenchInputText(page, ` ${QUESTION}`)
          await submitWorkbenchCurrentDraft(page)
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAtMs,
            env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page, blockerPolicy: 'auto_approve' }
          )
          recordWorkbenchAiEvidence(runtime, evidence, 0.8)

          const afterBuffer = await fs.readFile(filePath)
          await copyShowcaseFixture(filePath, PDF_FILE_NAME)
          await fs.rm(EXPORT_DIR, { recursive: true, force: true })
          const screenshotNames = await rasterizePdfPages(filePath, EXPORT_DIR)
          const answerName = 'answer/reply.png'
          await screenshotAssistantAnswer(page, path.join(EXPORT_DIR, answerName))
          const screenshotStats = await Promise.all(
            [...screenshotNames, answerName].map((name) => fs.stat(path.join(EXPORT_DIR, name)))
          )
          const minScreenshotBytes = Math.min(...screenshotStats.map((stat) => stat.size))

          const toolNames = evidence.events
            .filter((event) => event.type === 'tool_call_started')
            .map((event) => event.toolName)
          const cost = computeShowcaseCost(evidence.events, {
            modelName: env.modelName,
            prompt: PDF_PROMPT,
            fileName: PDF_FILE_NAME,
            pageCount: screenshotNames.length,
            screenshotNames,
            answerScreenshot: answerName,
            durationMs: evidence.durationMs,
            finalAnswerText: evidence.finalAnswerText,
            sourceUnchanged: Buffer.compare(beforeBuffer, afterBuffer) === 0
          })
          await fs.writeFile(path.join(EXPORT_DIR, 'cost.json'), `${JSON.stringify(cost, null, 2)}\n`)
          runtime.signal({
            name: 'showcase-pdf-cost',
            message: '官网 PDF 样例实际消耗',
            data: cost
          })

          return {
            screenshotCount: screenshotNames.length,
            hasAnswerScreenshot: true,
            minScreenshotBytes,
            sourceUnchanged: Buffer.compare(beforeBuffer, afterBuffer) === 0,
            usageCalls: cost.usage.calls,
            cny: cost.cny,
            finalAnswerText: evidence.finalAnswerText,
            toolNames
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.sourceUnchanged &&
              result.screenshotCount >= 2 &&
              result.hasAnswerScreenshot &&
              result.minScreenshotBytes > 40_000 &&
              result.usageCalls > 0 &&
              result.toolNames.some(
                (name) => name.startsWith('pdf_') || name === 'kb_search' || name === 'terminal_run'
              ) &&
              /终验|验收/u.test(result.finalAnswerText) &&
              /10|十/u.test(result.finalAnswerText),
            {
              name: 'showcase-xinghe-service-contract-ready',
              message: '应读取合同 PDF 回答尾款时间，原件不变，并截到原文页、回答和真实用量。',
              data: {
                screenshotCount: result.screenshotCount,
                minScreenshotBytes: result.minScreenshotBytes,
                sourceUnchanged: result.sourceUnchanged,
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
