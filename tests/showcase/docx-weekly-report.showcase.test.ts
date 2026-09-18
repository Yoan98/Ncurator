import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { runShowcaseCase } from '../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  configureLiveModelThroughSettingsUi,
  createPartnerThroughWorkbenchUi,
  getWorkbenchLocator,
  loadWorkbenchLiveModelEnv,
  prepareWorkbenchWorkspaceThroughUi,
  readDocxPlainText,
  recordWorkbenchAiEvidence,
  selectWorkbenchModel,
  sendWorkbenchMessage,
  waitForApplyEntryByFileName,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../harness/e2e/workbench'
import {
  computeShowcaseCost,
  copyShowcaseFixture,
  ensureDocumentMode,
  readApplyChangeCounts,
  screenshotScrollerPages
} from './shared'
import { DOCX_CREATE_PROMPT, DOCX_FILE_NAME, seedWordCreateWorkspace } from './createSeeds'

const CASE_ID = 'docx-weekly-report'
const FILE_NAME = DOCX_FILE_NAME
const EXPORT_DIR = path.resolve('tests/logs/showcase/export/docx-weekly-report')

describe('showcase collection', () => {
  it(
    CASE_ID,
    async () => {
      await runShowcaseCase({
        caseId: CASE_ID,
        groups: ['docx'],
        description: '官网样例：根据零散材料生成可发给管理层的 Word 周报，并截取预览页与审核页。',
        fixtures: [],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const env = loadWorkbenchLiveModelEnv()
          const rootPath = await seedWordCreateWorkspace()
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
            workspaceName: '云枢周报资料',
            rootPath
          })
          await createPartnerThroughWorkbenchUi(page, '云枢周报资料')
          await selectWorkbenchModel(page, env.modelName)

          const startedAtMs = Date.now()
          await sendWorkbenchMessage(page, DOCX_CREATE_PROMPT)
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
          const docxText = fileExists ? await readDocxPlainText(filePath) : ''

          const applyEntry = await waitForApplyEntryByFileName(page, FILE_NAME)
          await applyEntry.click()
          const viewer = getWorkbenchLocator(page, workbenchSelectors.docxViewer)
          await viewer.waitFor({ state: 'visible', timeout: 30_000 })
          const scroller = viewer.locator('.docx-content')
          await scroller.locator('p, table, section, ins, del').first().waitFor({
            state: 'visible',
            timeout: 30_000
          })
          await page.waitForTimeout(1200)

          await fs.rm(EXPORT_DIR, { recursive: true, force: true })
          await ensureDocumentMode(page, '审核')
          const changeCounts = await readApplyChangeCounts(page)
          const reviewNames = await screenshotScrollerPages(
            scroller,
            path.join(EXPORT_DIR, 'review'),
            'page'
          )

          await ensureDocumentMode(page, '预览')
          await scroller.locator('p, table, section').first().waitFor({
            state: 'visible',
            timeout: 30_000
          })
          await page.waitForTimeout(800)
          const screenshotNames = await screenshotScrollerPages(scroller, EXPORT_DIR, 'page')

          const cost = computeShowcaseCost(evidence.events, {
            modelName: env.modelName,
            prompt: DOCX_CREATE_PROMPT,
            fileName: FILE_NAME,
            pageCount: screenshotNames.length,
            reviewPageCount: reviewNames.length,
            screenshotNames,
            reviewScreenshotNames: reviewNames.map((name) => `review/${name}`),
            durationMs: evidence.durationMs,
            ...changeCounts
          })
          await fs.writeFile(
            path.join(EXPORT_DIR, 'cost.json'),
            `${JSON.stringify(cost, null, 2)}\n`
          )
          runtime.signal({
            name: 'showcase-docx-cost',
            message: '官网 Word 样例实际消耗',
            data: cost
          })

          return {
            fileExists,
            docxText,
            screenshotCount: screenshotNames.length,
            reviewCount: reviewNames.length,
            insertCount: changeCounts.insertCount,
            usageCalls: cost.usage.calls,
            cny: cost.cny,
            toolNames: evidence.events
              .filter((event) => event.type === 'tool_call_started')
              .map((event) => event.toolName)
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.fileExists &&
              result.screenshotCount >= 1 &&
              result.reviewCount >= 1 &&
              result.usageCalls > 0 &&
              /周报|进展|风险|下周/u.test(result.docxText) &&
              result.toolNames.some((name) => name.startsWith('docx_')),
            {
              name: 'showcase-docx-weekly-report-ready',
              message: '应生成可预览的管理层周报 Word，并截到预览页、审核页和真实用量。',
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
