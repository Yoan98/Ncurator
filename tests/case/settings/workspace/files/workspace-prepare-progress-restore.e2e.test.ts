import { describe, it } from 'vitest'
import { importSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_REAL_WORKSPACE_LONG_E2E_TIMEOUT_MS,
  createRealWorkspaceWithRoot,
  getSettingsLocator,
  navigateToSettingsSection,
  waitForFileIndexJobIdle
} from '../../../../harness/e2e/settings'
import { createWorkspaceWithFiles } from './realWorkspaceHelpers'

const createSlowEnoughWorkspaceFiles = (): Array<{ relativePath: string; content: string }> => {
  const runMarker = Date.now().toString(36)
  const invalidDocxFiles = Array.from({ length: 20 }, (_, index) => ({
    relativePath: `broken/broken-${String(index + 1).padStart(2, '0')}.docx`,
    content: `not a valid docx archive ${runMarker}-${index + 1}`
  }))
  const markdownFiles = Array.from({ length: 10 }, (_, fileIndex) => ({
    relativePath: `notes/index-source-${String(fileIndex + 1).padStart(2, '0')}.md`,
    content: Array.from(
      { length: 100 },
      (_, paragraphIndex) =>
        `# ${runMarker} file ${fileIndex + 1} paragraph ${paragraphIndex + 1}\n\n` +
        `Unique indexing content ${runMarker}-${fileIndex + 1}-${paragraphIndex + 1}.`
    ).join('\n\n')
  }))
  return [...invalidDocxFiles, ...markdownFiles]
}

describe('settings workspace e2e', () => {
  it(
    'workspace-prepare-progress-restore',
    async () => {
      await runE2ECase({
        caseId: 'workspace-prepare-progress-restore',
        domain: 'settings',
        suite: 'workspace',
        groups: ['files'],
        description: '文件索引执行中离开并返回工作空间页后，应恢复持久化进度块和取消按钮状态。',
        fixtures: [],
        serviceMode: 'real',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          let workspaceRoot = ''

          workspaceRoot = await createWorkspaceWithFiles(
            'workspace-prepare-progress-restore',
            createSlowEnoughWorkspaceFiles()
          )
          const workspace = await createRealWorkspaceWithRoot(page, {
            name: '文件进度恢复工作区',
            rootPath: workspaceRoot
          })
          const workspaceId = workspace.workspace!.id

          await runtime.step({
            name: 'start-real-prepare',
            message: '通过 UI 对真实多文件工作区启动索引，并等待进度块出现。',
            run: async () => {
              await navigateToSettingsSection(page, 'workspace')
              await getSettingsLocator(page, importSelectors.workspaceQuickPrepareButton).click()
              await getSettingsLocator(page, importSelectors.workspaceIndexJobProgress).waitFor({
                state: 'visible'
              })
            }
          })

          let restoredProgressVisible = false
          let restoredButtonsDisabled = false
          let restoredPrepareButtonName = ''

          await runtime.step({
            name: 'restore-progress-after-route-change',
            message: '切到其他设置页再返回工作空间页，确认 running job 进度仍可恢复。',
            run: async () => {
              await navigateToSettingsSection(page, 'model')
              await navigateToSettingsSection(page, 'workspace')
              await getSettingsLocator(page, importSelectors.workspaceIndexJobProgress).waitFor({
                state: 'visible'
              })
              restoredProgressVisible = await getSettingsLocator(
                page,
                importSelectors.workspaceIndexJobProgress
              ).isVisible()
              restoredButtonsDisabled =
                (await getSettingsLocator(
                  page,
                  importSelectors.workspaceQuickScanButton
                ).isDisabled()) &&
                (await getSettingsLocator(
                  page,
                  importSelectors.workspaceQuickPrepareButton
                ).isDisabled())
              restoredPrepareButtonName = (
                (await getSettingsLocator(
                  page,
                  importSelectors.workspaceQuickPrepareButton
                ).innerText()) || ''
              ).trim()
            }
          })

          const idle = await waitForFileIndexJobIdle(
            page,
            workspaceId,
            SETTINGS_REAL_WORKSPACE_LONG_E2E_TIMEOUT_MS
          )

          return {
            restoredProgressVisible,
            restoredButtonsDisabled,
            restoredPrepareButtonName,
            failedFileCount: idle.tree.summary.failed_file_count
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.restoredProgressVisible &&
              !result.restoredButtonsDisabled &&
              result.restoredPrepareButtonName.includes('取消') &&
              result.failedFileCount > 0,
            {
              name: 'file-progress-restores-after-return',
              message:
                '离开并返回文件 tab 后，应通过持久化 running job 恢复进度块，「检查更新」可用，「更新索引」文案为「取消」且可点，对齐 SET-WORKSPACE-004-AC4、SET-WORKSPACE-004-AC12。',
              data: result
            }
          )
        }
      })
    },
    SETTINGS_REAL_WORKSPACE_LONG_E2E_TIMEOUT_MS
  )
})
