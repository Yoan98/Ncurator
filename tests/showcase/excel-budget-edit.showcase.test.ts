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
  recordWorkbenchAiEvidence,
  selectWorkbenchModel,
  sendWorkbenchMessage,
  waitForApplyEntryByFileName,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../harness/e2e/workbench'
import { EXCEL_EDIT_PROMPT, EXCEL_FILE_NAME } from './createSeeds'
import {
  computeShowcaseCost,
  ensureDocumentMode,
  inspectExcelEditResult,
  readApplyChangeCounts,
  requireShowcaseFixture,
  screenshotExcelUsedRange,
  seedWorkspaceWithFixture
} from './shared'

const CASE_ID = 'excel-budget-edit'
const EXPORT_DIR = path.resolve('tests/logs/showcase/export/excel-budget-edit')

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

describe('showcase collection', () => {
  it(
    CASE_ID,
    async () => {
      await runShowcaseCase({
        caseId: CASE_ID,
        groups: ['excel'],
        description: '官网样例：改过关预算表同一份文件，截能看出加列和改金额的审核态。',
        fixtures: [],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const env = loadWorkbenchLiveModelEnv()
          await requireShowcaseFixture(EXCEL_FILE_NAME)
          const rootPath = await seedWorkspaceWithFixture(
            'ncurator-showcase-excel-edit-',
            EXCEL_FILE_NAME
          )
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
            workspaceName: '云枢费用修订',
            rootPath
          })
          await createPartnerThroughWorkbenchUi(page, '云枢费用修订')
          await selectWorkbenchModel(page, env.modelName)

          const startedAtMs = Date.now()
          await sendWorkbenchMessage(page, EXCEL_EDIT_PROMPT)
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAtMs,
            env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page, blockerPolicy: 'auto_approve' }
          )
          recordWorkbenchAiEvidence(runtime, evidence, 0.8)

          const inspection = await inspectExcelEditResult(path.join(rootPath, EXCEL_FILE_NAME))
          const applyEntry = await waitForApplyEntryByFileName(page, EXCEL_FILE_NAME)
          await applyEntry.click()
          const viewer = await waitExcelReady(page)
          await fs.rm(EXPORT_DIR, { recursive: true, force: true })
          await ensureDocumentMode(page, '审核')
          const changeCounts = await readApplyChangeCounts(page)
          const grid = getWorkbenchLocator(page, workbenchSelectors.excelGrid)
          const target = (await grid.count()) ? grid : viewer
          const screenshotNames: string[] = []
          await fs.mkdir(EXPORT_DIR, { recursive: true })
          const tabs = inspection.sheetNames.length > 0 ? inspection.sheetNames : ['Sheet1']
          for (const [index, sheetName] of tabs.entries()) {
            const tab = viewer
              .locator('[data-u-comp="slide-tab-item"]')
              .filter({ hasText: sheetName })
              .first()
            if (await tab.count()) {
              await tab.click()
              await page.waitForTimeout(500)
            }
            const fileName = `sheet-${index + 1}.png`
            await screenshotExcelUsedRange(target, path.join(EXPORT_DIR, fileName))
            screenshotNames.push(fileName)
          }
          const cost = computeShowcaseCost(evidence.events, {
            modelName: env.modelName,
            prompt: EXCEL_EDIT_PROMPT,
            fileName: EXCEL_FILE_NAME,
            ...inspection,
            screenshotNames,
            durationMs: evidence.durationMs,
            ...changeCounts
          })
          await fs.writeFile(
            path.join(EXPORT_DIR, 'cost.json'),
            `${JSON.stringify(cost, null, 2)}\n`
          )
          runtime.signal({
            name: 'showcase-excel-edit-cost',
            message: '官网 Excel 审核样例实际消耗',
            data: cost
          })

          return {
            screenshotCount: screenshotNames.length,
            ...inspection,
            insertCount: changeCounts.insertCount,
            deleteCount: changeCounts.deleteCount,
            usageCalls: cost.usage.calls,
            cny: cost.cny,
            toolNames: evidence.events
              .filter((event) => event.type === 'tool_call_started')
              .map((event) => event.toolName)
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.screenshotCount >= 1 &&
              result.hasOccurredColumn === true &&
              result.adAmount !== null &&
              result.adAmount <= 50_000 &&
              (result.insertCount > 0 || result.deleteCount > 0) &&
              result.usageCalls > 0 &&
              result.toolNames.some((name) => name.startsWith('excel_')),
            {
              name: 'showcase-excel-budget-edit-ready',
              message:
                '应改到过关预算表同一份文件，文件里有已发生列和品牌推广 5 万，并截到能看出的审核改动。',
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
