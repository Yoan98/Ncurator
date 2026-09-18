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
import { PPT_EDIT_PROMPT, PPT_FILE_NAME } from './createSeeds'
import {
  computeShowcaseCost,
  ensureDocumentMode,
  readApplyChangeCounts,
  requireShowcaseFixture,
  seedWorkspaceWithFixture
} from './shared'

const CASE_ID = 'ppt-management-briefing-edit'
const EXPORT_DIR = path.resolve('tests/logs/showcase/export/ppt-management-briefing-edit')

describe('showcase collection', () => {
  it(
    CASE_ID,
    async () => {
      await runShowcaseCase({
        caseId: CASE_ID,
        groups: ['ppt'],
        description: '官网样例：改 Q2 经营复盘原件，截左右对照加右侧缩略栏。',
        fixtures: [],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const env = loadWorkbenchLiveModelEnv()
          await requireShowcaseFixture(PPT_FILE_NAME)
          const rootPath = await seedWorkspaceWithFixture(
            'ncurator-showcase-ppt-edit-',
            PPT_FILE_NAME
          )
          await fs.writeFile(
            path.join(rootPath, '工作区说明.txt'),
            '内部通气会用的 Q2 经营复盘原件在工作区里。\n',
            'utf8'
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
            workspaceName: '云枢简报修订',
            rootPath
          })
          await createPartnerThroughWorkbenchUi(page, '云枢简报修订')
          await selectWorkbenchModel(page, env.modelName)

          const startedAtMs = Date.now()
          await sendWorkbenchMessage(page, PPT_EDIT_PROMPT)
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAtMs,
            env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page, blockerPolicy: 'auto_approve' }
          )
          recordWorkbenchAiEvidence(runtime, evidence, 0.8)

          const applyEntry = await waitForApplyEntryByFileName(page, PPT_FILE_NAME)
          await applyEntry.click()
          const viewer = getWorkbenchLocator(page, workbenchSelectors.pptDiffViewer)
          await viewer.waitFor({ state: 'visible', timeout: 30_000 })
          await page.waitForTimeout(800)
          await fs.rm(EXPORT_DIR, { recursive: true, force: true })
          await ensureDocumentMode(page, '审核')
          const changeCounts = await readApplyChangeCounts(page)
          const before = getWorkbenchLocator(page, workbenchSelectors.pptDiffBefore)
          await before.waitFor({ state: 'visible', timeout: 20_000 })
          const thumbs = getWorkbenchLocator(page, workbenchSelectors.pptDiffThumbnails).locator(
            'button'
          )
          const count = Math.max(1, await thumbs.count())
          await fs.mkdir(EXPORT_DIR, { recursive: true })
          const screenshotNames: string[] = []
          for (let index = 0; index < count; index += 1) {
            if ((await thumbs.count()) > index) {
              await thumbs.nth(index).click()
              await page.waitForTimeout(400)
            }
            const fileName = `slide-${index + 1}.png`
            await viewer.screenshot({
              path: path.join(EXPORT_DIR, fileName),
              type: 'png'
            })
            screenshotNames.push(fileName)
          }
          const cost = computeShowcaseCost(evidence.events, {
            modelName: env.modelName,
            prompt: PPT_EDIT_PROMPT,
            fileName: PPT_FILE_NAME,
            screenshotNames,
            durationMs: evidence.durationMs,
            hasBeforeAfter: await before.isVisible(),
            ...changeCounts
          })
          await fs.writeFile(
            path.join(EXPORT_DIR, 'cost.json'),
            `${JSON.stringify(cost, null, 2)}\n`
          )
          runtime.signal({
            name: 'showcase-ppt-edit-cost',
            message: '官网 PPT 审核样例实际消耗',
            data: cost
          })

          return {
            screenshotCount: screenshotNames.length,
            hasBeforeAfter: cost.hasBeforeAfter,
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
              result.hasBeforeAfter === true &&
              result.usageCalls > 0 &&
              result.toolNames.some((name) => name.startsWith('ppt_')),
            {
              name: 'showcase-ppt-management-briefing-edit-ready',
              message: '应改到 Q2 原件，并截到左右对照加右侧栏和真实用量。',
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
