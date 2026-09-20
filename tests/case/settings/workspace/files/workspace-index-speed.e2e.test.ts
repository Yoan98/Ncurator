import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'vitest'
import { importSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { resolveOrtThreadBudget } from '../../../../../src/main/services/vector/indexSpeed'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import { measureEmbeddingRuntimeThreadDelta, waitForEmbeddingRuntimeProcessGone } from '../../../../harness/e2e/embeddingRuntimeThreads'
import {
  SETTINGS_REAL_WORKSPACE_LONG_E2E_TIMEOUT_MS,
  addWorkspaceDirectoryThroughNativeDialog,
  getSettingsLocator,
  navigateToSettingsSection,
  selectWorkspaceIndexSpeedThroughSettingsUi,
  waitForFileIndexJobIdle
} from '../../../../harness/e2e/settings'

describe('settings workspace e2e', () => {
  it(
    'workspace-index-speed',
    async () => {
      await runE2ECase({
        caseId: 'workspace-index-speed',
        domain: 'settings',
        suite: 'workspace',
        groups: ['files'],
        description: '独立小目录两次真实更新索引，断言慢/高速嵌入进程的操作系统线程增量。',
        fixtures: [],
        serviceMode: 'real',
        execution: 'exclusive',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'settings-index-speed-'))
          await writeFile(path.join(workspaceRoot, 'slow.txt'), 'slow index speed\n')
          runtime.registerResource({
            name: `settings-index-speed:${workspaceRoot}`,
            phase: 'after-app-close',
            dispose: async () => {
              await rm(workspaceRoot, { recursive: true, force: true })
            }
          })

          const workspaceId = await addWorkspaceDirectoryThroughNativeDialog(page, workspaceRoot)
          await waitForFileIndexJobIdle(page, workspaceId)
          await navigateToSettingsSection(page, 'workspace')
          const slowSpeed = getSettingsLocator(page, importSelectors.workspaceIndexSpeedSlow)
          await slowSpeed.waitFor({ state: 'visible' })
          await page.waitForFunction((testId) => {
            const element = document.querySelector(`[data-testid="${testId}"]`)
            return element instanceof HTMLButtonElement && !element.disabled
          }, importSelectors.workspaceIndexSpeedSlow)
          const defaultSlowSelected = await slowSpeed.evaluate((element) =>
            element.classList.contains('ant-btn-primary')
          )
          await page.waitForFunction((testId) => {
            const element = document.querySelector(`[data-testid="${testId}"]`)
            return element instanceof HTMLButtonElement && !element.disabled
          }, importSelectors.workspaceQuickPrepareButton)

          const electronPid = runtime.electronApp.process()?.pid
          if (!electronPid) throw new Error('electron pid is required to measure embedding threads')
          const slowBudget = resolveOrtThreadBudget('slow')
          const fastBudget = resolveOrtThreadBudget('fast')

          const slowWatch = measureEmbeddingRuntimeThreadDelta({
            page,
            electronPid,
            timeoutMs: SETTINGS_REAL_WORKSPACE_LONG_E2E_TIMEOUT_MS
          })
          await getSettingsLocator(page, importSelectors.workspaceQuickPrepareButton).click()
          await getSettingsLocator(page, importSelectors.workspaceIndexJobProgress).waitFor({
            state: 'visible'
          })
          await page.waitForFunction((ids) => {
            const slow = document.querySelector(`[data-testid="${ids.slow}"]`)
            const fast = document.querySelector(`[data-testid="${ids.fast}"]`)
            return (
              slow instanceof HTMLButtonElement &&
              fast instanceof HTMLButtonElement &&
              slow.disabled &&
              fast.disabled
            )
          }, {
            slow: importSelectors.workspaceIndexSpeedSlow,
            fast: importSelectors.workspaceIndexSpeedFast
          })
          const speedLockedWhileIndexing = true
          const slowThreads = await slowWatch
          await waitForFileIndexJobIdle(page, workspaceId)
          await page.waitForFunction((ids) => {
            const slow = document.querySelector(`[data-testid="${ids.slow}"]`)
            const fast = document.querySelector(`[data-testid="${ids.fast}"]`)
            return (
              slow instanceof HTMLButtonElement &&
              fast instanceof HTMLButtonElement &&
              !slow.disabled &&
              !fast.disabled
            )
          }, {
            slow: importSelectors.workspaceIndexSpeedSlow,
            fast: importSelectors.workspaceIndexSpeedFast
          })
          const speedUnlockedAfterIndex = true

          await writeFile(path.join(workspaceRoot, 'fast.txt'), 'fast index speed\n')
          await getSettingsLocator(page, importSelectors.workspaceQuickScanButton).click()
          await waitForFileIndexJobIdle(page, workspaceId)
          await page.waitForFunction((testId) => {
            const element = document.querySelector(`[data-testid="${testId}"]`)
            return element instanceof HTMLButtonElement && !element.disabled
          }, importSelectors.workspaceQuickPrepareButton)
          await selectWorkspaceIndexSpeedThroughSettingsUi(page, 'fast')
          await waitForEmbeddingRuntimeProcessGone({ pid: slowThreads.pid })
          const knowledgeIndexSpeed = (await page.evaluate(() => window.api.appSettingsGet()))
            .knowledgeIndexSpeed

          const fastWatch = measureEmbeddingRuntimeThreadDelta({
            page,
            electronPid,
            excludePid: slowThreads.pid,
            timeoutMs: SETTINGS_REAL_WORKSPACE_LONG_E2E_TIMEOUT_MS
          })
          await getSettingsLocator(page, importSelectors.workspaceQuickPrepareButton).click()
          const fastThreads = await fastWatch
          const result = await waitForFileIndexJobIdle(page, workspaceId)

          return {
            defaultSlowSelected,
            knowledgeIndexSpeed,
            speedLockedWhileIndexing,
            speedUnlockedAfterIndex,
            slowBudget,
            fastBudget,
            slowThreads,
            fastThreads,
            indexedFileCount: result.tree.summary.indexed_file_count,
            needsIndexCount: result.tree.summary.needs_index_count
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.defaultSlowSelected === true && result.knowledgeIndexSpeed === 'fast',
            {
              name: 'default-slow-then-switch-fast',
              message: '默认选中慢速，第二次更新索引前切换并保存为高速，对齐 SET-WORKSPACE-009-AC1。',
              data: result
            }
          )
          await runtime.assertThat(
            result.speedLockedWhileIndexing === true && result.speedUnlockedAfterIndex === true,
            {
              name: 'speed-locked-while-prepare-running',
              message:
                '更新索引进行中必须禁用慢/高速；任务终态后恢复，对齐 SET-WORKSPACE-009-AC4。',
              data: result
            }
          )
          await runtime.assertThat(
            result.slowThreads.pid !== result.fastThreads.pid &&
              result.slowThreads.intraOpNumThreads === result.slowBudget.intraOpNumThreads &&
              result.fastThreads.intraOpNumThreads === result.fastBudget.intraOpNumThreads &&
              result.slowThreads.delta >= result.slowBudget.intraOpNumThreads &&
              result.fastThreads.delta >= result.fastBudget.intraOpNumThreads &&
              result.fastThreads.delta - result.slowThreads.delta ===
                result.fastBudget.intraOpNumThreads - result.slowBudget.intraOpNumThreads &&
              result.fastThreads.after > result.slowThreads.after,
            {
              name: 'prepare-os-threads-follow-index-speed',
              message:
                '两次真实更新索引必须各自拉起嵌入进程；同一进程 ready 前后的操作系统线程增量不少于该档 intraOp，高速大于慢速且增量之差等于档位差。',
              data: {
                slowBudget: result.slowBudget,
                fastBudget: result.fastBudget,
                slowThreads: result.slowThreads,
                fastThreads: result.fastThreads
              }
            }
          )
          await runtime.assertThat(
            result.indexedFileCount >= 2 && result.needsIndexCount === 0,
            {
              name: 'both-index-runs-completed',
              message: '慢速和高速两次更新索引都应把临时目录里的 txt 索引完成。',
              data: result
            }
          )
        }
      })
    },
    SETTINGS_REAL_WORKSPACE_LONG_E2E_TIMEOUT_MS
  )
})
