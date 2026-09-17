import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
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
} from '../../../harness/e2e/workbench'
import {
  PATENT_SEARCH_HOST,
  PATENT_SEARCH_KEYWORD,
  PATENT_SEARCH_PROMPT
} from './createSeeds'
import {
  captureEmbeddedBrowserPng,
  computeShowcaseCost,
  inspectEmbeddedBrowser,
  seedEmptyShowcaseWorkspace,
  type EmbeddedBrowserSnapshot
} from './shared'

const CASE_ID = 'patent-search'
const EXPORT_DIR = path.resolve('tests/logs/workbench/showcase-export/patent-search')

type PatentFrame = 'empty' | 'filled' | 'results'

const classifyPatentFrame = (snapshot: EmbeddedBrowserSnapshot): PatentFrame | null => {
  const typed = snapshot.inputValues.join(' ')
  const hasKeyword = typed.includes(PATENT_SEARCH_KEYWORD)
  const hasResults =
    snapshot.bodyText.includes(PATENT_SEARCH_KEYWORD) &&
    /检索结果|发明公布|实用新型|外观设计|共\s*\d+|条记录|件专利/u.test(snapshot.bodyText)
  if (hasResults) return 'results'
  if (hasKeyword) return 'filled'
  if (snapshot.url.includes(PATENT_SEARCH_HOST)) return 'empty'
  return null
}

describe('workbench showcase e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'showcase',
        groups: ['browser'],
        description: '官网样例：用内置浏览器打开中国专利公布公告，输入智能仓储并提交。',
        fixtures: [],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page, electronApp } = runtime
          const env = loadWorkbenchLiveModelEnv()
          const rootPath = await seedEmptyShowcaseWorkspace('ncurator-showcase-patent-')
          runtime.registerResource({
            name: `showcase-workspace:${rootPath}`,
            phase: 'after-app-close',
            dispose: async () => {
              await fs.rm(rootPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
            }
          })
          await configureLiveModelThroughSettingsUi(page, env)
          await prepareWorkbenchWorkspaceThroughUi(page, {
            workspaceName: '云枢专利检索',
            rootPath
          })
          await createPartnerThroughWorkbenchUi(page, '云枢专利检索')
          await selectWorkbenchModel(page, env.modelName)

          await fs.rm(EXPORT_DIR, { recursive: true, force: true })
          await fs.mkdir(EXPORT_DIR, { recursive: true })
          const captured = new Set<PatentFrame>()
          const frameFiles: Partial<Record<PatentFrame, string>> = {
            empty: 'frame-1.png',
            filled: 'frame-2.png',
            results: 'frame-3.png'
          }
          let stopCapture = false
          const tryCaptureFrames = async (): Promise<void> => {
            if (captured.size >= 3) return
            const snapshot = await inspectEmbeddedBrowser(electronApp, PATENT_SEARCH_HOST)
            if (!snapshot) return
            const frame = classifyPatentFrame(snapshot)
            if (!frame || captured.has(frame)) return
            const fileName = frameFiles[frame]
            if (!fileName) return
            const ok = await captureEmbeddedBrowserPng(
              electronApp,
              PATENT_SEARCH_HOST,
              path.join(EXPORT_DIR, fileName)
            )
            if (!ok) return
            captured.add(frame)
            runtime.signal({
              name: `showcase-patent-frame-${frame}`,
              message: `截到专利检索 ${frame} 帧`,
              data: {
                url: snapshot.url,
                title: snapshot.title,
                inputValues: snapshot.inputValues
              }
            })
          }
          const captureLoop = (async () => {
            while (!stopCapture) {
              await tryCaptureFrames().catch(() => undefined)
              await page.waitForTimeout(700)
            }
          })()

          const startedAtMs = Date.now()
          await sendWorkbenchMessage(page, PATENT_SEARCH_PROMPT)
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAtMs,
            env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page, blockerPolicy: 'auto_approve' }
          )
          stopCapture = true
          await captureLoop
          await tryCaptureFrames().catch(() => undefined)
          recordWorkbenchAiEvidence(runtime, evidence, 0.8)

          const orderedNames = [
            captured.has('empty') ? 'frame-1.png' : null,
            captured.has('filled') ? 'frame-2.png' : null,
            captured.has('results') ? 'frame-3.png' : null
          ].filter((name): name is string => Boolean(name))
          const screenshotStats = await Promise.all(
            orderedNames.map((name) => fs.stat(path.join(EXPORT_DIR, name)))
          )
          const minScreenshotBytes =
            screenshotStats.length > 0 ? Math.min(...screenshotStats.map((stat) => stat.size)) : 0
          const toolNames = evidence.events
            .filter((event) => event.type === 'tool_call_started')
            .map((event) => event.toolName)
          const cost = computeShowcaseCost(evidence.events, {
            modelName: env.modelName,
            prompt: PATENT_SEARCH_PROMPT,
            fileName: '中国专利公布公告',
            screenshotNames: orderedNames,
            capturedFrames: Array.from(captured),
            durationMs: evidence.durationMs,
            finalAnswerText: evidence.finalAnswerText
          })
          await fs.writeFile(path.join(EXPORT_DIR, 'cost.json'), `${JSON.stringify(cost, null, 2)}\n`)
          runtime.signal({
            name: 'showcase-patent-cost',
            message: '官网浏览器专利检索样例实际消耗',
            data: cost
          })

          return {
            screenshotCount: orderedNames.length,
            capturedFrames: Array.from(captured),
            minScreenshotBytes,
            usageCalls: cost.usage.calls,
            cny: cost.cny,
            finalAnswerText: evidence.finalAnswerText,
            toolNames
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.capturedFrames.includes('empty') &&
              result.capturedFrames.includes('filled') &&
              result.capturedFrames.includes('results') &&
              result.screenshotCount >= 3 &&
              result.minScreenshotBytes > 20_000 &&
              result.usageCalls > 0 &&
              result.toolNames.includes('browser_use') &&
              /智能仓储/u.test(result.finalAnswerText),
            {
              name: 'showcase-patent-search-ready',
              message: '应打开中国专利公布公告，完成输入并提交，截到空白检索、已填词、结果三帧。',
              data: {
                screenshotCount: result.screenshotCount,
                capturedFrames: result.capturedFrames,
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
