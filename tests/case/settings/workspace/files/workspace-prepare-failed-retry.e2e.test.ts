import { describe, it } from 'vitest'
import { importSelectors } from '../../../../../src/renderer/src/testing/selectors'
import type { WorkspaceIndexJobRecord } from '../../../../../src/shared/types'
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
    'workspace-prepare-failed-retry',
    async () => {
      await runE2ECase({
        caseId: 'workspace-prepare-failed-retry',
        domain: 'settings',
        suite: 'workspace',
        groups: ['files'],
        description: '已有失败文件再次点击更新索引时，应被纳入本次处理范围。',
        fixtures: [],
        knowledge: 'cached',
        serviceMode: 'real',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          let workspaceRoot = ''
          workspaceRoot = await createWorkspaceWithFiles('workspace-prepare-failed-retry', [
            {
              relativePath: 'broken.docx',
              content: 'not a valid docx archive'
            }
          ])
          const workspace = await createRealWorkspaceWithRoot(page, {
            name: '失败重试工作区',
            rootPath: workspaceRoot
          })
          const workspaceId = workspace.workspace!.id

          await navigateToSettingsSection(page, 'workspace')
          await getSettingsLocator(page, importSelectors.workspaceQuickPrepareButton).waitFor({
            state: 'visible'
          })
          const runIndex = async () => {
            const finished = page.evaluate(
              (id) =>
                new Promise<WorkspaceIndexJobRecord>((resolve, reject) => {
                  const timer = setTimeout(() => {
                    unsubscribe()
                    reject(new Error('没有收到本次文件索引任务终态'))
                  }, 120_000)
                  const unsubscribe = window.api.onWorkspaceIndexJobProgress((job) => {
                    if (
                      job.workspace_id !== id ||
                      job.source_kind !== 'file' ||
                      job.action !== 'prepare' ||
                      job.status === 'running'
                    )
                      return
                    clearTimeout(timer)
                    unsubscribe()
                    resolve(job)
                  })
                }),
              workspaceId
            )
            // Flush browser commands so the read-only listener precedes the UI click.
            await page.evaluate(() => true)
            await getSettingsLocator(page, importSelectors.workspaceQuickPrepareButton).click()
            const job = await finished
            const idle = await waitForFileIndexJobIdle(page, workspaceId)
            return { job, tree: idle.tree }
          }
          const first = await runIndex()
          const retry = await runIndex()

          return {
            firstJob: {
              id: first.job.id,
              status: first.job.status,
              total_count: first.job.total_count,
              processed_count: first.job.processed_count,
              failed_count: first.job.failed_count
            },
            retryJob: {
              id: retry.job.id,
              status: retry.job.status,
              total_count: retry.job.total_count,
              processed_count: retry.job.processed_count,
              failed_count: retry.job.failed_count
            },
            firstStatuses: toSupportedFileStatuses(first.tree),
            statuses: toSupportedFileStatuses(retry.tree)
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.firstJob.id !== result.retryJob.id &&
              [result.firstJob, result.retryJob].every(
                (job) =>
                  job.status === 'failed' &&
                  job.total_count === 1 &&
                  job.processed_count === 1 &&
                  job.failed_count === 1
              ) &&
              result.firstStatuses[0]?.status === 'failed' &&
              result.statuses.length === 1 &&
              result.statuses[0]?.status === 'failed',
            {
              name: 'failed-file-is-retried',
              message:
                '再次更新索引时，已有 failed 文件应再次完成处理并收敛为文件级状态，对齐 SET-WORKSPACE-004-AC1、SET-WORKSPACE-004-AC2。',
              data: result
            }
          )
        }
      })
    },
    SETTINGS_REAL_WORKSPACE_E2E_TIMEOUT_MS
  )
})
