import { describe, it } from 'vitest'
import { importSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_REAL_WORKSPACE_LONG_E2E_TIMEOUT_MS,
  bindWorkspaceRootThroughSettingsUi,
  createWorkspaceThroughSettingsUi,
  getSettingsLocator,
  navigateToSettingsSection,
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
        execution: 'exclusive',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          let workspaceRoot = ''

          workspaceRoot = await copySharedWorkspaceFixture('workspace-prepare-refresh')
          const workspaceId = await createWorkspaceThroughSettingsUi(page, '索引工作区')
          await bindWorkspaceRootThroughSettingsUi(page, workspaceRoot)
          let prepareProgressVisible = false
          let buttonsDisabled = false

          await runtime.step({
            name: 'prepare-workspace-through-ui',
            message: '通过 UI 点击更新索引，并确认执行中进度块和按钮禁用状态。',
            run: async () => {
              await navigateToSettingsSection(page, 'workspace')
              await getSettingsLocator(page, importSelectors.workspaceQuickPrepareButton).waitFor({
                state: 'visible'
              })
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
            }
          })

          const result = await waitForFileIndexJobIdle(page, workspaceId)
          const supportedStatuses = toSupportedFileStatuses(result.tree)

          return {
            prepareProgressVisible,
            buttonsDisabled,
            summary: result.tree.summary,
            supportedStatuses
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(result.prepareProgressVisible && result.buttonsDisabled, {
            name: 'prepare-progress-is-visible',
            message:
              '更新索引执行中，界面应展示持久化总进度并禁用两个索引操作按钮，对齐 SET-WORKSPACE-004-AC3。',
            data: result
          })

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
