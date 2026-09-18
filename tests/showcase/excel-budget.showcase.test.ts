import fs from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
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
  recordWorkbenchAiEvidence,
  selectWorkbenchModel,
  sendWorkbenchMessage,
  waitForApplyEntryByFileName,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../harness/e2e/workbench'
import { EXCEL_CREATE_PROMPT, EXCEL_FILE_NAME } from './createSeeds'
import {
  computeShowcaseCost,
  copyShowcaseFixture,
  ensureDocumentMode,
  readApplyChangeCounts,
  screenshotExcelUsedRange,
  seedEmptyShowcaseWorkspace
} from './shared'

const CASE_ID = 'excel-budget'
const FILE_NAME = EXCEL_FILE_NAME
const EXPORT_DIR = path.resolve('tests/logs/showcase/export/excel-budget')

const waitExcelReady = async (page: Parameters<typeof getWorkbenchLocator>[0]) => {
  const viewer = getWorkbenchLocator(page, workbenchSelectors.excelViewer)
  await viewer.waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForFunction(
    (testId) =>
      document.querySelector(`[data-testid="${testId}"]`)?.getAttribute('data-excel-ready') ===
      'true',
    workbenchSelectors.excelViewer,
    { timeout: 30_000 }
  )
  return viewer
}

const screenshotSheets = async (
  page: Parameters<typeof getWorkbenchLocator>[0],
  viewer: ReturnType<typeof getWorkbenchLocator>,
  outputDir: string,
  prefix: string,
  sheetNames: string[]
): Promise<string[]> => {
  await fs.mkdir(outputDir, { recursive: true })
  const names: string[] = []
  for (const [index, sheetName] of sheetNames.entries()) {
    const tab = viewer
      .locator('[data-u-comp="slide-tab-item"]')
      .filter({ hasText: sheetName })
      .first()
    if (await tab.count()) {
      await tab.click()
      await page.waitForTimeout(500)
    }
    const fileName = `${prefix}-${index + 1}.png`
    await screenshotExcelUsedRange(viewer, path.join(outputDir, fileName))
    names.push(fileName)
  }
  return names
}

describe('showcase collection', () => {
  it(
    CASE_ID,
    async () => {
      await runShowcaseCase({
        caseId: CASE_ID,
        groups: ['excel'],
        description: '官网样例：从零生成可拿去部门对齐的 9 月费用预算表，并截取预览与审核。',
        fixtures: [],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const env = loadWorkbenchLiveModelEnv()
          const rootPath = await seedEmptyShowcaseWorkspace('ncurator-showcase-excel-')
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
            workspaceName: '云枢费用预算',
            rootPath
          })
          await createPartnerThroughWorkbenchUi(page, '云枢费用预算')
          await selectWorkbenchModel(page, env.modelName)

          const startedAtMs = Date.now()
          await sendWorkbenchMessage(page, EXCEL_CREATE_PROMPT)
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
          const workbook = new ExcelJS.Workbook()
          if (fileExists) {
            await workbook.xlsx.load((await fs.readFile(filePath)) as never)
          }
          const sheetNames = workbook.worksheets.map((sheet) => sheet.name)

          const applyEntry = await waitForApplyEntryByFileName(page, FILE_NAME)
          await applyEntry.click()
          const viewer = await waitExcelReady(page)
          await fs.rm(EXPORT_DIR, { recursive: true, force: true })

          await ensureDocumentMode(page, '审核')
          const changeCounts = await readApplyChangeCounts(page)
          const targets = sheetNames.length > 0 ? sheetNames : ['Sheet1']
          const reviewNames = await screenshotSheets(
            page,
            viewer,
            path.join(EXPORT_DIR, 'review'),
            'sheet',
            targets
          )

          await ensureDocumentMode(page, '预览')
          await waitExcelReady(page)
          const screenshotNames = await screenshotSheets(page, viewer, EXPORT_DIR, 'sheet', targets)

          const cost = computeShowcaseCost(evidence.events, {
            modelName: env.modelName,
            prompt: EXCEL_CREATE_PROMPT,
            fileName: FILE_NAME,
            sheetNames,
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
            name: 'showcase-excel-cost',
            message: '官网 Excel 样例实际消耗',
            data: cost
          })

          return {
            fileExists,
            sheetNames,
            screenshotCount: screenshotNames.length,
            reviewCount: reviewNames.length,
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
              result.sheetNames.length >= 2 &&
              result.screenshotCount >= 1 &&
              result.reviewCount >= 1 &&
              result.usageCalls > 0 &&
              result.toolNames.some((name) => name.startsWith('excel_')),
            {
              name: 'showcase-excel-budget-ready',
              message: '应生成含至少两张表的费用预算 Excel，并截到预览、审核和真实用量。',
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
