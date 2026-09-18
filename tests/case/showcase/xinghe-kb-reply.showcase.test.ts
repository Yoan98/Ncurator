import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { runShowcaseCase } from '../../harness/e2e/run-e2e-case'
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
} from '../../harness/e2e/workbench'
import { KB_PROMPT, KB_SOURCE_PAGES, seedKnowledgeWorkspace } from './createSeeds'
import { computeShowcaseCost, rasterizeNotePage, screenshotAssistantAnswer } from './shared'

const CASE_ID = 'xinghe-kb-reply'
const EXPORT_DIR = path.resolve('tests/logs/showcase/export/xinghe-kb-reply')

describe('showcase collection', () => {
  it(
    CASE_ID,
    async () => {
      await runShowcaseCase({
        caseId: CASE_ID,
        groups: ['knowledge'],
        description:
          '官网样例：不点名文件，按本地知识库对星河交付承诺和验收口径，截资料页和馆长回复。',
        fixtures: [],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const env = loadWorkbenchLiveModelEnv()
          const rootPath = await seedKnowledgeWorkspace()
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
            workspaceName: '星河客户资料',
            rootPath
          })
          await createPartnerThroughWorkbenchUi(page, '星河客户资料')
          await selectWorkbenchModel(page, env.modelName)

          const startedAtMs = Date.now()
          await sendWorkbenchMessage(page, KB_PROMPT)
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
          const screenshotNames: string[] = []
          for (const [index, source] of KB_SOURCE_PAGES.entries()) {
            const body = await fs.readFile(path.join(rootPath, source.fileName), 'utf8')
            const fileName = `page-${index + 1}.png`
            await rasterizeNotePage(source.title, body, path.join(EXPORT_DIR, fileName))
            screenshotNames.push(fileName)
          }
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
            prompt: KB_PROMPT,
            fileName: '本地知识库',
            screenshotNames,
            answerScreenshot: answerName,
            durationMs: evidence.durationMs,
            finalAnswerText: evidence.finalAnswerText
          })
          await fs.writeFile(
            path.join(EXPORT_DIR, 'cost.json'),
            `${JSON.stringify(cost, null, 2)}\n`
          )
          runtime.signal({
            name: 'showcase-kb-cost',
            message: '官网知识库样例实际消耗',
            data: cost
          })

          return {
            screenshotCount: screenshotNames.length + 1,
            minScreenshotBytes,
            usageCalls: cost.usage.calls,
            cny: cost.cny,
            finalAnswerText: evidence.finalAnswerText,
            toolNames
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.screenshotCount >= 3 &&
              result.minScreenshotBytes > 20_000 &&
              result.usageCalls > 0 &&
              result.toolNames.some(
                (name) => name === 'kb_search' || name === 'kb_list_documents'
              ) &&
              !result.toolNames.includes('browser_use') &&
              !result.toolNames.includes('web_search') &&
              /95\s*%|百分之九十五/u.test(result.finalAnswerText) &&
              /验收|P1|7\s*天/u.test(result.finalAnswerText),
            {
              name: 'showcase-xinghe-kb-reply-ready',
              message:
                '应从本地知识库对上星河交付承诺和验收口径，截到资料页和回复，且未改走浏览器。',
              data: {
                screenshotCount: result.screenshotCount,
                minScreenshotBytes: result.minScreenshotBytes,
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
