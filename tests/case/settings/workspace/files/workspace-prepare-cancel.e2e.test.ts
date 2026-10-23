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

const createCancelWorkspaceFiles = (): Array<{ relativePath: string; content: string }> => {
  const runMarker = Date.now().toString(36)
  return Array.from({ length: 24 }, (_, fileIndex) => ({
    relativePath: `notes/index-source-${String(fileIndex + 1).padStart(2, '0')}.md`,
    content: Array.from(
      { length: 80 },
      (_, paragraphIndex) =>
        `# ${runMarker} file ${fileIndex + 1} paragraph ${paragraphIndex + 1}\n\n` +
        `Unique indexing content ${runMarker}-${fileIndex + 1}-${paragraphIndex + 1}.`
    ).join('\n\n')
  }))
}

describe('settings workspace e2e', () => {
  it(
    'workspace-prepare-cancel',
    async () => {
      await runE2ECase({
        caseId: 'workspace-prepare-cancel',
        domain: 'settings',
        suite: 'workspace',
        groups: ['files'],
        description: '更新索引进行中可取消，停止后按钮恢复且仍有未完成文件。',
        fixtures: [],
        knowledge: 'cached',
        serviceMode: 'real',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const workspaceRoot = await createWorkspaceWithFiles(
            'workspace-prepare-cancel',
            createCancelWorkspaceFiles()
          )
          const workspace = await createRealWorkspaceWithRoot(page, {
            name: '文件取消索引工作区',
            rootPath: workspaceRoot
          })
          const workspaceId = workspace.workspace!.id

          await navigateToSettingsSection(page, 'workspace')
          await getSettingsLocator(page, importSelectors.workspaceQuickPrepareButton).click()
          await getSettingsLocator(page, importSelectors.workspaceIndexJobProgress).waitFor({
            state: 'visible'
          })
          await page.waitForFunction(
            async (selectedWorkspaceId) => {
              const response = await window.api.workspaceIndexJobGet({
                workspaceId: selectedWorkspaceId,
                sourceKind: 'file'
              })
              return Boolean(
                response.job &&
                response.job.status === 'running' &&
                response.job.total_count > 1 &&
                response.job.processed_count < response.job.total_count
              )
            },
            workspaceId,
            { timeout: SETTINGS_REAL_WORKSPACE_LONG_E2E_TIMEOUT_MS }
          )

          const prepareButton = getSettingsLocator(
            page,
            importSelectors.workspaceQuickPrepareButton
          )
          const cancelLabel = ((await prepareButton.innerText()) || '').trim()
          const cancelDisabled = await prepareButton.isDisabled()
          await prepareButton.click()
          const dialog = page.getByRole('dialog')
          await dialog.waitFor({ state: 'visible' })
          const dialogText = (await dialog.innerText()) || ''
          await getSettingsLocator(page, importSelectors.workspaceIndexCancelContinueButton).click()
          await dialog.waitFor({ state: 'hidden' })
          const continuedProgressVisible = await getSettingsLocator(
            page,
            importSelectors.workspaceIndexJobProgress
          ).isVisible()

          await prepareButton.click()
          await dialog.waitFor({ state: 'visible' })
          await getSettingsLocator(page, importSelectors.workspaceIndexCancelConfirmButton).click()
          const idle = await waitForFileIndexJobIdle(
            page,
            workspaceId,
            SETTINGS_REAL_WORKSPACE_LONG_E2E_TIMEOUT_MS
          )
          const idleButtonName = (
            (await getSettingsLocator(
              page,
              importSelectors.workspaceQuickPrepareButton
            ).innerText()) || ''
          ).trim()

          return {
            cancelLabel,
            cancelDisabled,
            dialogText,
            continuedProgressVisible,
            idleButtonName,
            summary: idle.tree.summary
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.cancelLabel.includes('取消') && result.cancelDisabled === false,
            {
              name: 'prepare-button-becomes-cancel',
              message: '更新索引执行中按钮文案应为「取消」且可点，对齐 SET-WORKSPACE-004-AC12。',
              data: result
            }
          )
          await runtime.assertThat(
            result.dialogText.includes('尚未完成的将不会继续索引') &&
              result.dialogText.includes('已经完成的索引会保留') &&
              !/已完成 \d+ 个文件/.test(result.dialogText) &&
              !/剩余 \d+ 个文件将停止/.test(result.dialogText) &&
              result.continuedProgressVisible,
            {
              name: 'cancel-dialog-confirms-stop-and-continue-keeps-running',
              message:
                '取消确认框应说明尚未完成的将不会继续索引，且不展示已完成/剩余数量；继续更新后任务继续跑，对齐 SET-WORKSPACE-004-AC13。',
              data: result
            }
          )
          await runtime.assertThat(
            result.idleButtonName.includes('更新索引') &&
              result.summary.indexed_file_count >= 0 &&
              result.summary.needs_index_count + result.summary.failed_file_count > 0 &&
              result.summary.failed_file_count < result.summary.file_count,
            {
              name: 'cancel-restores-button-and-leaves-unfinished-files',
              message:
                '停止后按钮回到「更新索引」，仍有可索引或失败文件且未全部变成失败，部分验证 SET-WORKSPACE-004-AC14。',
              data: result
            }
          )
        }
      })
    },
    SETTINGS_REAL_WORKSPACE_LONG_E2E_TIMEOUT_MS
  )
})
