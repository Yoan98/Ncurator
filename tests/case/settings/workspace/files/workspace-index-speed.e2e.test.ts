import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Page } from 'playwright'
import { describe, it } from 'vitest'
import { importSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { resolveOrtThreadBudget } from '../../../../../src/main/services/vector/indexSpeed'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import { osThreadDeltasFollowIndexSpeed } from '../../../../harness/core/indexSpeedThreads'
import {
  measureEmbeddingRuntimeThreadDelta,
  waitForEmbeddingRuntimeProcessGone
} from '../../../../harness/e2e/embeddingRuntimeThreads'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  SETTINGS_REAL_WORKSPACE_LONG_E2E_TIMEOUT_MS,
  addWorkspaceDirectoryThroughNativeDialog,
  getSettingsLocator,
  navigateToSettingsSection,
  selectWorkspaceIndexSpeedThroughSettingsUi,
  waitForFileIndexJobIdle
} from '../../../../harness/e2e/settings'

const UI_WAIT_MS = SETTINGS_E2E_TIMEOUT_MS
const PREPARE_LOCK_WAIT_MS = 30_000

const buildPendingIndexText = (label: string): string => {
  const salt = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const paragraphs = Array.from({ length: 400 }, (_, index) => {
    const n = index + 1
    return `${label} ${n} unique indexing block ${label}-${n} salt=${salt} ${'payload '.repeat(48)}`.trim()
  })
  return `${paragraphs.join('\n\n')}\n`
}

const waitForPrepareEnabled = async (page: Page): Promise<void> => {
  await page.waitForFunction(
    (testId) => {
      const element = document.querySelector(`[data-testid="${testId}"]`)
      return element instanceof HTMLButtonElement && !element.disabled
    },
    importSelectors.workspaceQuickPrepareButton,
    { timeout: UI_WAIT_MS }
  )
}

const waitForActionableIndexCount = async (page: Page, minimum: number): Promise<void> => {
  await page.waitForFunction(
    (input) => {
      const element = document.querySelector(`[data-testid="${input.testId}"]`)
      return Number(element?.textContent || '0') >= input.minimum
    },
    { testId: importSelectors.workspaceActionableIndexCount, minimum },
    { timeout: UI_WAIT_MS }
  )
}

const waitForSpeedButtonsDisabled = async (page: Page, disabled: boolean): Promise<void> => {
  await page.waitForFunction(
    (input) => {
      const slow = document.querySelector(`[data-testid="${input.slow}"]`)
      const fast = document.querySelector(`[data-testid="${input.fast}"]`)
      return (
        slow instanceof HTMLButtonElement &&
        fast instanceof HTMLButtonElement &&
        slow.disabled === input.disabled &&
        fast.disabled === input.disabled
      )
    },
    {
      slow: importSelectors.workspaceIndexSpeedSlow,
      fast: importSelectors.workspaceIndexSpeedFast,
      disabled
    },
    { timeout: UI_WAIT_MS }
  )
}

const dumpPrepareDiagnostics = async (page: Page): Promise<string> => {
  const diagnostics = await page.evaluate(async (selectors) => {
    const actionable = document.querySelector(`[data-testid="${selectors.actionable}"]`)
    const prepare = document.querySelector(`[data-testid="${selectors.prepare}"]`)
    const slow = document.querySelector(`[data-testid="${selectors.slow}"]`)
    const fast = document.querySelector(`[data-testid="${selectors.fast}"]`)
    const progress = document.querySelector(`[data-testid="${selectors.progress}"]`)
    const embedding = await window.api.getEmbeddingStatus()
    const workspaces = await window.api.workspaceList()
    const jobs = await Promise.all(
      workspaces.items.map(async (item) => {
        const response = await window.api.workspaceIndexJobGet({
          workspaceId: item.id,
          sourceKind: 'file'
        })
        return { workspaceId: item.id, job: response.job || null }
      })
    )
    return {
      actionableCount: Number(actionable?.textContent || 0),
      prepareDisabled: prepare instanceof HTMLButtonElement ? prepare.disabled : null,
      prepareLabel: prepare instanceof HTMLElement ? prepare.innerText.trim() : null,
      slowDisabled: slow instanceof HTMLButtonElement ? slow.disabled : null,
      fastDisabled: fast instanceof HTMLButtonElement ? fast.disabled : null,
      progressVisible: progress instanceof HTMLElement,
      embedding,
      jobs
    }
  }, {
    actionable: importSelectors.workspaceActionableIndexCount,
    prepare: importSelectors.workspaceQuickPrepareButton,
    slow: importSelectors.workspaceIndexSpeedSlow,
    fast: importSelectors.workspaceIndexSpeedFast,
    progress: importSelectors.workspaceIndexJobProgress
  })
  return JSON.stringify(diagnostics)
}

const scanPendingFileThenPrepare = async (input: {
  page: Page
  workspaceId: string
  filePath: string
  content: string
}): Promise<void> => {
  await writeFile(input.filePath, input.content)
  await input.page.mouse.move(0, 0)
  await getSettingsLocator(input.page, importSelectors.workspaceQuickScanButton).click()
  await waitForFileIndexJobIdle(input.page, input.workspaceId)
  await waitForActionableIndexCount(input.page, 1)
  await waitForPrepareEnabled(input.page)
}


const waitForEmbeddingRuntimeAlive = async (page: Page, timeoutMs = 60_000): Promise<void> => {
  try {
    await page.waitForFunction(
      async () => {
        const snapshot = await window.api.getEmbeddingStatus()
        return Boolean(snapshot && snapshot.status && snapshot.status !== 'uninitialized' && snapshot.pid)
      },
      undefined,
      { timeout: timeoutMs }
    )
  } catch (error) {
    const snapshot = await page.evaluate(async () => await window.api.getEmbeddingStatus()).catch(() => null)
    throw new Error(
      `embedding runtime did not start after prepare lock: ${JSON.stringify(snapshot)}; ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}

const clickPrepareUntilSpeedLocked = async (page: Page): Promise<void> => {
  await page.mouse.move(0, 0)
  await getSettingsLocator(page, importSelectors.workspaceQuickPrepareButton).click()
  try {
    await page.waitForFunction(
      (input) => {
        const slow = document.querySelector(`[data-testid="${input.slow}"]`)
        const fast = document.querySelector(`[data-testid="${input.fast}"]`)
        const progress = document.querySelector(`[data-testid="${input.progress}"]`)
        const speedLocked =
          slow instanceof HTMLButtonElement &&
          fast instanceof HTMLButtonElement &&
          slow.disabled &&
          fast.disabled
        return speedLocked || progress instanceof HTMLElement
      },
      {
        slow: importSelectors.workspaceIndexSpeedSlow,
        fast: importSelectors.workspaceIndexSpeedFast,
        progress: importSelectors.workspaceIndexJobProgress
      },
      { timeout: PREPARE_LOCK_WAIT_MS }
    )
  } catch (error) {
    throw new Error(
      `prepare did not lock index speed or show progress: ${await dumpPrepareDiagnostics(page)}; ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}

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
        knowledge: 'cold',
        serviceMode: 'real',
        execution: 'exclusive',
        runMode: 'single',
        // This case must exercise a live embedding worker; vector cache hits skip spawning it.
        extraEnv: {
          NCURATOR_WORKSPACE_KNOWLEDGE_CACHE: '0'
        },
        execute: async (runtime) => {
          const { page } = runtime
          const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'settings-index-speed-'))
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
          await slowSpeed.waitFor({ state: 'visible', timeout: UI_WAIT_MS })
          await page.waitForFunction(
            (testId) => {
              const element = document.querySelector(`[data-testid="${testId}"]`)
              return element instanceof HTMLButtonElement && !element.disabled
            },
            importSelectors.workspaceIndexSpeedSlow,
            { timeout: UI_WAIT_MS }
          )
          const defaultSlowSelected = await slowSpeed.evaluate((element) =>
            element.classList.contains('ant-btn-primary')
          )

          const electronPid = await runtime.electronApp.evaluate(() => process.pid)
          if (!electronPid) throw new Error('electron pid is required to measure embedding threads')
          const slowBudget = resolveOrtThreadBudget('slow')
          const fastBudget = resolveOrtThreadBudget('fast')

          await scanPendingFileThenPrepare({
            page,
            workspaceId,
            filePath: path.join(workspaceRoot, 'slow.txt'),
            content: buildPendingIndexText('slow')
          })
          await clickPrepareUntilSpeedLocked(page)
          const speedLockedWhileIndexing = true
          await waitForEmbeddingRuntimeAlive(page, 60_000)
          const slowThreads = await measureEmbeddingRuntimeThreadDelta({
            page,
            electronPid,
            timeoutMs: 60_000
          })
          await waitForFileIndexJobIdle(page, workspaceId)
          await waitForSpeedButtonsDisabled(page, false)
          const speedUnlockedAfterIndex = true

          await scanPendingFileThenPrepare({
            page,
            workspaceId,
            filePath: path.join(workspaceRoot, 'fast.txt'),
            content: buildPendingIndexText('fast')
          })
          await selectWorkspaceIndexSpeedThroughSettingsUi(page, 'fast')
          await waitForEmbeddingRuntimeProcessGone({ pid: slowThreads.pid })
          const knowledgeIndexSpeed = (await page.evaluate(() => window.api.appSettingsGet()))
            .knowledgeIndexSpeed

          await clickPrepareUntilSpeedLocked(page)
          await waitForEmbeddingRuntimeAlive(page, 60_000)
          const fastThreads = await measureEmbeddingRuntimeThreadDelta({
            page,
            electronPid,
            excludePid: slowThreads.pid,
            timeoutMs: 60_000
          })
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
              osThreadDeltasFollowIndexSpeed({
                slowDelta: result.slowThreads.delta,
                fastDelta: result.fastThreads.delta,
                slowAfter: result.slowThreads.after,
                fastAfter: result.fastThreads.after,
                slowIntraOp: result.slowBudget.intraOpNumThreads,
                fastIntraOp: result.fastBudget.intraOpNumThreads
              }),
            {
              name: 'prepare-os-threads-follow-index-speed',
              message:
                '两次真实更新索引必须各自拉起嵌入进程；优先用同一进程 ready 前后的操作系统线程增量跟随档位（Mac ≥ intraOp，Windows ≥ intraOp-1，且增量差等于档位差）；若 worker 已预热抓不到增量，则用两档 ready 稳态 after 之差对齐档位差（Windows 允许差 1）。',
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
