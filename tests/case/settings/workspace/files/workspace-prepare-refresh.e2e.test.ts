import { describe, it } from 'vitest'
import { importSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { resolveOrtThreadBudget } from '../../../../../src/main/services/vector/indexSpeed'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import { measureEmbeddingRuntimeThreads } from '../../../../harness/e2e/embeddingRuntimeThreads'
import {
  SETTINGS_REAL_WORKSPACE_LONG_E2E_TIMEOUT_MS,
  createRealWorkspaceWithRoot,
  getSettingsLocator,
  navigateToSettingsSection,
  selectWorkspaceIndexSpeedThroughSettingsUi,
  waitForFileIndexJobIdle
} from '../../../../harness/e2e/settings'
import { copySharedWorkspaceFixture, toSupportedFileStatuses } from './realWorkspaceHelpers'

const LEGACY_DOC_NAME = '风险等级判断标准-图案设计【2026.2.10更新】.doc'

describe('settings workspace e2e', () => {
  it(
    'workspace-prepare-refresh',
    async () => {
      await runE2ECase({
        caseId: 'workspace-prepare-refresh',
        domain: 'settings',
        suite: 'workspace',
        groups: ['files'],
        description: '点击更新索引后，页面按增量策略执行，并在完成后刷新文件索引状态。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'warmup',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          let workspaceRoot = ''

          workspaceRoot = await copySharedWorkspaceFixture('workspace-prepare-refresh')
          const workspace = await createRealWorkspaceWithRoot(page, {
            name: '索引工作区',
            rootPath: workspaceRoot
          })
          const workspaceId = workspace.workspace!.id
          let prepareProgressVisible = false
          let buttonsDisabled = false
          let defaultSlowSelected = false
          let knowledgeIndexSpeed = ''
          let directoryCallBaseline = 0
          let directoryCallsWhileRunning = -1
          let directoryCallsAfterCompletion = -1
          const slowBudget = resolveOrtThreadBudget('slow')
          const fastBudget = resolveOrtThreadBudget('fast')
          let slowThreads = { pid: 0, threads: 0 }
          let fastThreads = { pid: 0, threads: 0 }
          const electronPid = runtime.electronApp.process()?.pid
          if (!electronPid) throw new Error('electron pid is required to measure embedding threads')

          await runtime.step({
            name: 'prepare-workspace-through-ui',
            message: '通过 UI 先切换索引速度，再点击更新索引，并确认执行中进度块和按钮状态。',
            run: async () => {
              await navigateToSettingsSection(page, 'workspace')
              await getSettingsLocator(page, importSelectors.workspaceQuickPrepareButton).waitFor({
                state: 'visible'
              })
              await getSettingsLocator(page, importSelectors.workspaceTree).waitFor({
                state: 'visible'
              })
              const slowSpeed = getSettingsLocator(page, importSelectors.workspaceIndexSpeedSlow)
              await slowSpeed.waitFor({ state: 'visible' })
              await page.waitForFunction(
                (testId) => {
                  const element = document.querySelector(`[data-testid="${testId}"]`)
                  return element instanceof HTMLButtonElement && !element.disabled
                },
                importSelectors.workspaceIndexSpeedSlow
              )
              defaultSlowSelected = await slowSpeed.evaluate((element) =>
                element.classList.contains('ant-btn-primary')
              )
              slowThreads = await measureEmbeddingRuntimeThreads({ page, electronPid })
              await selectWorkspaceIndexSpeedThroughSettingsUi(page, 'fast')
              knowledgeIndexSpeed = (await page.evaluate(() => window.api.appSettingsGet()))
                .knowledgeIndexSpeed
              directoryCallBaseline = await page.evaluate(
                () =>
                  (window as typeof window & {
                    __NCURATOR_E2E_OBSERVER__?: { ipcInvokeEntries: Array<{ name: string }> }
                  }).__NCURATOR_E2E_OBSERVER__?.ipcInvokeEntries.filter(
                    (entry) => entry.name === 'workspaceDirectoryList'
                  ).length || 0
              )
              await getSettingsLocator(page, importSelectors.workspaceQuickPrepareButton).click()
              await getSettingsLocator(page, importSelectors.workspaceIndexJobProgress).waitFor({
                state: 'visible'
              })
              prepareProgressVisible = true
              buttonsDisabled =
                (await getSettingsLocator(
                  page,
                  importSelectors.workspaceQuickScanButton
                ).isDisabled()) &&
                (await getSettingsLocator(
                  page,
                  importSelectors.workspaceQuickPrepareButton
                  ).isDisabled())
              directoryCallsWhileRunning = await page.evaluate(
                () =>
                  (window as typeof window & {
                    __NCURATOR_E2E_OBSERVER__?: { ipcInvokeEntries: Array<{ name: string }> }
                  }).__NCURATOR_E2E_OBSERVER__?.ipcInvokeEntries.filter(
                    (entry) => entry.name === 'workspaceDirectoryList'
                  ).length || 0
              )
              directoryCallsWhileRunning -= directoryCallBaseline
              fastThreads = await measureEmbeddingRuntimeThreads({
                page,
                electronPid,
                excludePid: slowThreads.pid
              })
            }
          })

          const result = await waitForFileIndexJobIdle(page, workspaceId)
          directoryCallsAfterCompletion = await page.evaluate(
            () =>
              (window as typeof window & {
                __NCURATOR_E2E_OBSERVER__?: { ipcInvokeEntries: Array<{ name: string }> }
              }).__NCURATOR_E2E_OBSERVER__?.ipcInvokeEntries.filter(
                (entry) => entry.name === 'workspaceDirectoryList'
              ).length || 0
          )
          directoryCallsAfterCompletion -= directoryCallBaseline
          const supportedStatuses = toSupportedFileStatuses(result.tree)

          return {
            prepareProgressVisible,
            buttonsDisabled,
            defaultSlowSelected,
            knowledgeIndexSpeed,
            slowBudget,
            fastBudget,
            slowThreads,
            fastThreads,
            directoryCallsWhileRunning,
            directoryCallsAfterCompletion,
            summary: result.tree.summary,
            supportedStatuses
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.defaultSlowSelected === true && result.knowledgeIndexSpeed === 'fast',
            {
              name: 'prepare-runs-after-switching-index-speed',
              message:
                '默认慢速，切换高速并保存后再更新索引，对齐 SET-WORKSPACE-009-AC1；本次索引走切换后的档位。',
              data: result
            }
          )
          await runtime.assertThat(
            result.slowThreads.pid !== result.fastThreads.pid &&
              result.slowThreads.intraOpNumThreads === result.slowBudget.intraOpNumThreads &&
              result.fastThreads.intraOpNumThreads === result.fastBudget.intraOpNumThreads &&
              (result.fastThreads.intraOpNumThreads || 0) >
                (result.slowThreads.intraOpNumThreads || 0),
            {
              name: 'embedding-utility-threads-follow-index-speed',
              message:
                '真实更新索引用的 Electron 嵌入子进程必须重启，且进程名中的 intraOp 等于当前慢/高速档位。',
              data: {
                slowBudget: result.slowBudget,
                fastBudget: result.fastBudget,
                slowThreads: result.slowThreads,
                fastThreads: result.fastThreads
              }
            }
          )

          await runtime.assertThat(result.prepareProgressVisible && !result.buttonsDisabled, {
            name: 'prepare-progress-is-visible',
            message:
              '更新索引执行中，界面应展示持久化总进度且两个索引操作按钮保持可用，对齐 SET-WORKSPACE-004-AC3。',
            data: result
          })

          await runtime.assertThat(
            result.directoryCallsWhileRunning === 0 && result.directoryCallsAfterCompletion === 1,
            {
              name: 'prepare-refreshes-directory-once-at-terminal-state',
              message:
                '更新索引执行期间不应反复读取目录，任务结束后当前目录树只应刷新一次，避免 loading 与空态闪烁，对齐 SET-WORKSPACE-004-AC7。',
              data: result
            }
          )

          await runtime.assertThat(
            result.supportedStatuses.length >= 12 &&
              result.summary.needs_index_count === 0 &&
              result.summary.indexed_file_count + result.summary.failed_file_count ===
                result.supportedStatuses.length &&
              result.supportedStatuses.every(
                (item) => item.status === 'indexed' || item.status === 'failed'
              ),
            {
              name: 'prepare-refreshes-index-summary',
              message:
                '真实共享 workspace fixture 中的支持文件应全部完成索引或失败收敛，文件索引摘要和节点状态应同步刷新，对齐 SET-WORKSPACE-004-AC1、SET-WORKSPACE-004-AC2。',
              data: result
            }
          )

          const legacyDocStatus = result.supportedStatuses.find(
            (item) => item.name === LEGACY_DOC_NAME
          )
          await runtime.assertThat(
            legacyDocStatus?.status === 'indexed' && !legacyDocStatus.lastError,
            {
              name: 'prepare-indexes-legacy-doc-fixture',
              message: '真实共享 workspace fixture 中的旧版 .doc 文件应完成索引且没有解析错误。',
              data: legacyDocStatus || null
            }
          )
        }
      })
    },
    SETTINGS_REAL_WORKSPACE_LONG_E2E_TIMEOUT_MS
  )
})
