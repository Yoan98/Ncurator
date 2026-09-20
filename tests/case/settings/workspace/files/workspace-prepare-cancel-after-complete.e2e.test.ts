import { describe, it } from 'vitest'
import { importSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_REAL_WORKSPACE_E2E_TIMEOUT_MS,
  createRealWorkspaceWithRoot,
  getSettingsLocator,
  navigateToSettingsSection,
  waitForFileIndexJobIdle
} from '../../../../harness/e2e/settings'
import { createWorkspaceWithFiles, toSupportedFileStatuses } from './realWorkspaceHelpers'

describe('settings workspace e2e', () => {
  it(
    'workspace-prepare-cancel-after-complete',
    async () => {
      await runE2ECase({
        caseId: 'workspace-prepare-cancel-after-complete',
        domain: 'settings',
        suite: 'workspace',
        groups: ['files'],
        description: '取消确认框仍打开时任务已跑完，再点停止不把完成结果改成取消。',
        fixtures: [],
        serviceMode: 'real',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const workspaceRoot = await createWorkspaceWithFiles(
            'workspace-prepare-cancel-after-complete',
            [
              { relativePath: 'done-a.md', content: 'cancel after complete a\n' },
              { relativePath: 'done-b.md', content: 'cancel after complete b\n' }
            ]
          )
          const workspace = await createRealWorkspaceWithRoot(page, {
            name: '完成后停止工作区',
            rootPath: workspaceRoot
          })
          const workspaceId = workspace.workspace!.id

          await navigateToSettingsSection(page, 'workspace')
          await getSettingsLocator(page, importSelectors.workspaceQuickPrepareButton).click()
          await getSettingsLocator(page, importSelectors.workspaceIndexJobProgress).waitFor({
            state: 'visible'
          })
          const prepareButton = getSettingsLocator(
            page,
            importSelectors.workspaceQuickPrepareButton
          )
          const dialog = page.getByRole('dialog')
          const runningLabel = ((await prepareButton.innerText()) || '').trim()
          if (runningLabel.includes('取消')) {
            await prepareButton.click()
            await dialog.waitFor({ state: 'visible' })
          }
          await waitForFileIndexJobIdle(page, workspaceId, SETTINGS_REAL_WORKSPACE_E2E_TIMEOUT_MS)
          const dialogVisibleAfterIdle = await dialog.isVisible().catch(() => false)
          if (dialogVisibleAfterIdle) {
            const confirmButton = getSettingsLocator(
              page,
              importSelectors.workspaceIndexCancelConfirmButton
            )
            // Job may reach a terminal state and close the dialog before click; stop is then a no-op.
            if (await confirmButton.isVisible().catch(() => false)) {
              try {
                await confirmButton.click({ timeout: 5_000 })
              } catch {
                // Dialog closed while clicking; keep going and assert final indexed state.
              }
            }
          }
          const idle = await waitForFileIndexJobIdle(
            page,
            workspaceId,
            SETTINGS_REAL_WORKSPACE_E2E_TIMEOUT_MS
          )
          const idleButtonName = ((await prepareButton.innerText()) || '').trim()
          const statuses = toSupportedFileStatuses(idle.tree)

          return {
            dialogVisibleAfterIdle,
            idleButtonName,
            statuses,
            summary: idle.tree.summary
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.idleButtonName.includes('更新索引') &&
              result.summary.failed_file_count === 0 &&
              result.statuses.every((item) => item.status === 'indexed') &&
              result.summary.needs_index_count === 0,
            {
              name: 'stop-after-complete-keeps-indexed',
              message:
                '确认框打开期间任务已结束后，再点停止不得回退已索引，按钮回到「更新索引」，对齐 SET-WORKSPACE-004-AC17。',
              data: result
            }
          )
        }
      })
    },
    SETTINGS_REAL_WORKSPACE_E2E_TIMEOUT_MS
  )
})
