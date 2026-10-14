import Database from 'better-sqlite3'
import path from 'node:path'
import { describe, it } from 'vitest'
import { importSelectors } from '../../../../../src/renderer/src/testing/selectors'
import type { WorkspaceIndexJobRecord } from '../../../../../src/shared/types'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_REAL_WORKSPACE_LONG_E2E_TIMEOUT_MS,
  createRealWorkspaceWithRoot,
  getSettingsLocator,
  navigateToSettingsSection,
  waitForFileIndexJobIdle
} from '../../../../harness/e2e/settings'
import { createWorkspaceWithFiles, toSupportedFileStatuses } from './realWorkspaceHelpers'

type CompletedJob = Pick<
  WorkspaceIndexJobRecord,
  'id' | 'status' | 'total_count' | 'processed_count' | 'failed_count'
>

describe('settings workspace e2e', () => {
  it(
    'workspace-prepare-cancel-after-complete',
    async () => {
      await runE2ECase({
        caseId: 'workspace-prepare-cancel-after-complete',
        domain: 'settings',
        suite: 'workspace',
        groups: ['files'],
        description: '运行中打开取消确认框，任务自然成功后关闭确认框并保留完成结果。',
        fixtures: [],
        serviceMode: 'real',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const marker = `${Date.now()}-${Math.random().toString(36).slice(2)}`
          const files = ['done-a.md', 'done-b.md'].map((relativePath) => ({
            relativePath,
            content: Array.from(
              { length: 40 },
              (_, index) =>
                `# ${relativePath} ${marker} section ${index}\n\n` +
                `Unique indexing source ${marker}-${relativePath}-${index}. ` +
                'This real document continues indexing while the cancellation dialog is open. '.repeat(
                  4
                )
            ).join('\n\n')
          }))
          const workspaceRoot = await createWorkspaceWithFiles(
            'workspace-prepare-cancel-after-complete',
            files
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
          await page.waitForFunction(async (selectedWorkspaceId) => {
            const { job } = await window.api.workspaceIndexJobGet({
              workspaceId: selectedWorkspaceId,
              sourceKind: 'file'
            })
            return job?.action === 'prepare' && job.status === 'running'
          }, workspaceId)
          const { job: runningJob } = await page.evaluate(async (selectedWorkspaceId) => {
            return await window.api.workspaceIndexJobGet({
              workspaceId: selectedWorkspaceId,
              sourceKind: 'file'
            })
          }, workspaceId)
          if (!runningJob || runningJob.action !== 'prepare' || runningJob.status !== 'running') {
            throw new Error('prepare job must still be running before opening cancellation dialog')
          }
          await prepareButton.click()
          await dialog.waitFor({ state: 'visible' })
          const { job: jobWithDialog } = await page.evaluate(async (selectedWorkspaceId) => {
            return await window.api.workspaceIndexJobGet({
              workspaceId: selectedWorkspaceId,
              sourceKind: 'file'
            })
          }, workspaceId)
          await runtime.assertThat(
            jobWithDialog?.id === runningJob.id && jobWithDialog.status === 'running',
            {
              name: 'cancel-dialog-opens-during-target-prepare',
              message: '必须在目标索引任务仍运行时实际打开取消确认框，不能跳过此场景。',
              data: {
                runningJobId: runningJob.id,
                observedJobId: jobWithDialog?.id ?? null,
                observedStatus: jobWithDialog?.status ?? null
              }
            }
          )
          const idle = await waitForFileIndexJobIdle(
            page,
            workspaceId,
            SETTINGS_REAL_WORKSPACE_LONG_E2E_TIMEOUT_MS
          )
          await dialog.waitFor({ state: 'hidden' })
          await getSettingsLocator(page, importSelectors.workspaceIndexJobProgress).waitFor({
            state: 'hidden'
          })
          const database = new Database(path.join(runtime.userDataDir, 'app.sqlite'), {
            readonly: true,
            fileMustExist: true
          })
          let completedJob: CompletedJob | undefined
          try {
            completedJob = database
              .prepare(
                'SELECT id, status, total_count, processed_count, failed_count FROM workspace_index_job WHERE id = ?'
              )
              .get(runningJob.id) as CompletedJob | undefined
          } finally {
            database.close()
          }
          const idleButtonName = ((await prepareButton.innerText()) || '').trim()
          const statuses = toSupportedFileStatuses(idle.tree)

          return {
            dialogClosed: !(await dialog.isVisible()),
            progressHidden: !(await getSettingsLocator(
              page,
              importSelectors.workspaceIndexJobProgress
            ).isVisible()),
            runningJobId: runningJob.id,
            completedJob: completedJob ?? null,
            expectedPaths: files.map((file) => file.relativePath),
            idleButtonName,
            statuses,
            summary: { ...idle.tree.summary }
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.dialogClosed &&
              result.progressHidden &&
              result.idleButtonName.includes('更新索引') &&
              result.completedJob?.id === result.runningJobId &&
              result.completedJob.status === 'succeeded' &&
              result.completedJob.total_count === result.expectedPaths.length &&
              result.completedJob.processed_count === result.expectedPaths.length &&
              result.completedJob.failed_count === 0 &&
              result.expectedPaths.length > 0 &&
              result.statuses.length === result.expectedPaths.length &&
              JSON.stringify(result.statuses.map((item) => item.relativePath).sort()) ===
                JSON.stringify([...result.expectedPaths].sort()) &&
              result.summary.failed_file_count === 0 &&
              result.statuses.every((item) => item.status === 'indexed') &&
              result.summary.needs_index_count === 0,
            {
              name: 'completion-closes-cancel-dialog-and-keeps-indexed',
              message:
                '取消确认框打开期间任务自然完成后，确认框与进度关闭，同一任务保持成功且预期文件全部已索引，补充 SET-WORKSPACE-004-AC17 的成功终态 UI 证据。',
              data: result
            }
          )
        }
      })
    },
    SETTINGS_REAL_WORKSPACE_LONG_E2E_TIMEOUT_MS
  )
})
