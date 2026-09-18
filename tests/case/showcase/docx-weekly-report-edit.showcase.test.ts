import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { runShowcaseCase } from '../../harness/e2e/run-e2e-case'
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
} from '../../harness/e2e/workbench'
import { DOCX_EDIT_PROMPT, DOCX_FILE_NAME } from './createSeeds'
import {
  computeShowcaseCost,
  ensureDocumentMode,
  readApplyChangeCounts,
  requireShowcaseFixture,
  screenshotScrollerPages,
  seedWorkspaceWithFixture
} from './shared'

const CASE_ID = 'docx-weekly-report-edit'
const EXPORT_DIR = path.resolve('tests/logs/showcase/export/docx-weekly-report-edit')

describe('showcase collection', () => {
  it(
    CASE_ID,
    async () => {
      await runShowcaseCase({
        caseId: CASE_ID,
        groups: ['docx'],
        description: '官网样例：改过关周报同一份文件，只截审核态绿增红删。',
        fixtures: [],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const env = loadWorkbenchLiveModelEnv()
          await requireShowcaseFixture(DOCX_FILE_NAME)
          const rootPath = await seedWorkspaceWithFixture(
            'ncurator-showcase-docx-edit-',
            DOCX_FILE_NAME
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
            workspaceName: '云枢周报修订',
            rootPath
          })
          await createPartnerThroughWorkbenchUi(page, '云枢周报修订')
          await selectWorkbenchModel(page, env.modelName)

          const startedAtMs = Date.now()
          await sendWorkbenchMessage(page, DOCX_EDIT_PROMPT)
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAtMs,
            env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page, blockerPolicy: 'auto_approve' }
          )
          recordWorkbenchAiEvidence(runtime, evidence, 0.8)

          const applyEntry = await waitForApplyEntryByFileName(page, DOCX_FILE_NAME)
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
          const screenshotNames = await screenshotScrollerPages(scroller, EXPORT_DIR, 'page')
          const cost = computeShowcaseCost(evidence.events, {
            modelName: env.modelName,
            prompt: DOCX_EDIT_PROMPT,
            fileName: DOCX_FILE_NAME,
            screenshotNames,
            durationMs: evidence.durationMs,
            ...changeCounts
          })
          await fs.writeFile(
            path.join(EXPORT_DIR, 'cost.json'),
            `${JSON.stringify(cost, null, 2)}\n`
          )
          runtime.signal({
            name: 'showcase-docx-edit-cost',
            message: '官网 Word 审核样例实际消耗',
            data: cost
          })

          return {
            screenshotCount: screenshotNames.length,
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
              (result.insertCount > 0 || result.deleteCount > 0) &&
              result.usageCalls > 0 &&
              result.toolNames.some((name) => name.startsWith('docx_')),
            {
              name: 'showcase-docx-weekly-report-edit-ready',
              message: '应改到过关周报同一份文件，并截到能看出的审核红绿和真实用量。',
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
