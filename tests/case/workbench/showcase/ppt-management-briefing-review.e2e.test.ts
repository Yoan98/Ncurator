import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  configureLiveModelThroughSettingsUi,
  createPartnerThroughWorkbenchUi,
  getWorkbenchLocator,
  loadWorkbenchLiveModelEnv,
  prepareWorkbenchWorkspaceThroughUi,
  recordWorkbenchAiEvidence,
  selectWorkbenchModel,
  sendWorkbenchMessage,
  waitForApplyEntryByFileName,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../harness/e2e/workbench'
import {
  computeShowcaseCost,
  copyShowcaseFixture,
  ensureDocumentMode,
  readApplyChangeCounts,
  seedEmptyShowcaseWorkspace
} from './shared'

const CASE_ID = 'ppt-management-briefing-review'
const FILE_NAME = '管理层季度经营简报.pptx'
const EXPORT_DIR = path.resolve(
  'tests/logs/workbench/showcase-export/ppt-management-briefing'
)
const PROMPT = [
  '做一份可给管理层开会用的 16:9 汇报，约 5–6 页：封面、执行摘要、关键 KPI、交付或业务趋势图、风险与负责人、下一步。',
  `写到工作区，文件名用「${FILE_NAME}」。`
].join('')

const screenshotPptSlides = async (
  page: Parameters<typeof getWorkbenchLocator>[0],
  outputDir: string,
  prefix: string
): Promise<string[]> => {
  await fs.mkdir(outputDir, { recursive: true })
  const thumbs = getWorkbenchLocator(page, workbenchSelectors.pptDiffThumbnails).locator('button')
  const count = Math.max(1, await thumbs.count())
  const after = getWorkbenchLocator(page, workbenchSelectors.pptDiffAfter)
  const names: string[] = []
  for (let index = 0; index < count; index += 1) {
    if ((await thumbs.count()) > index) {
      await thumbs.nth(index).click()
      await page.waitForTimeout(350)
    }
    const fileName = `${prefix}-${index + 1}.png`
    const target = (await after.isVisible().catch(() => false))
      ? after
      : getWorkbenchLocator(page, workbenchSelectors.pptDiffViewer)
    await target.screenshot({
      path: path.join(outputDir, fileName),
      type: 'png'
    })
    names.push(fileName)
  }
  return names
}

describe('workbench showcase e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'showcase',
        groups: ['ppt'],
        description: '官网样例：补拍新建管理层简报的审核态（交付 6 页不替换）。',
        fixtures: [],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const env = loadWorkbenchLiveModelEnv()
          const rootPath = await seedEmptyShowcaseWorkspace('ncurator-showcase-ppt-')
          runtime.registerResource({
            name: `showcase-workspace:${rootPath}`,
            phase: 'after-app-close',
            dispose: async () => {
              await fs.rm(rootPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
            }
          })
          await configureLiveModelThroughSettingsUi(page, env)
          await prepareWorkbenchWorkspaceThroughUi(page, {
            workspaceName: '云枢经营简报',
            rootPath
          })
          await createPartnerThroughWorkbenchUi(page, '云枢经营简报')
          await selectWorkbenchModel(page, env.modelName)

          const startedAtMs = Date.now()
          await sendWorkbenchMessage(page, PROMPT)
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAtMs,
            env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page, blockerPolicy: 'auto_approve' }
          )
          recordWorkbenchAiEvidence(runtime, evidence, 0.8)

          const filePath = path.join(rootPath, FILE_NAME)
          const fileExists = await fs
            .access(filePath)
            .then(() => true)
            .catch(() => false)
          if (fileExists) await copyShowcaseFixture(filePath, FILE_NAME)

          const applyEntry = await waitForApplyEntryByFileName(page, FILE_NAME)
          await applyEntry.click()
          const viewer = getWorkbenchLocator(page, workbenchSelectors.pptDiffViewer)
          await viewer.waitFor({ state: 'visible', timeout: 30_000 })
          await page.waitForTimeout(800)
          const reviewDir = path.join(EXPORT_DIR, 'review')
          await fs.rm(reviewDir, { recursive: true, force: true })

          await ensureDocumentMode(page, '审核')
          const changeCounts = await readApplyChangeCounts(page)
          const reviewNames = await screenshotPptSlides(
            page,
            path.join(EXPORT_DIR, 'review'),
            'slide'
          )

          const cost = computeShowcaseCost(evidence.events, {
            modelName: env.modelName,
            prompt: PROMPT,
            fileName: FILE_NAME,
            reviewScreenshotNames: reviewNames.map((name) => `review/${name}`),
            durationMs: evidence.durationMs,
            ...changeCounts
          })
          await fs.writeFile(
            path.join(EXPORT_DIR, 'review-cost.json'),
            `${JSON.stringify(cost, null, 2)}\n`
          )
          runtime.signal({
            name: 'showcase-ppt-review-cost',
            message: '官网 PPT 审核样例采集',
            data: cost
          })

          return {
            fileExists,
            reviewCount: reviewNames.length,
            usageCalls: cost.usage.calls,
            insertCount: changeCounts.insertCount,
            toolNames: evidence.events
              .filter((event) => event.type === 'tool_call_started')
              .map((event) => event.toolName)
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.fileExists &&
              result.reviewCount >= 1 &&
              result.usageCalls > 0 &&
              result.toolNames.some((name) => name.startsWith('ppt_')),
            {
              name: 'showcase-ppt-review-ready',
              message: '应生成管理层简报 PPT，并截到至少 1 页审核图和真实用量。',
              data: result
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    1_800_000
  )
})
