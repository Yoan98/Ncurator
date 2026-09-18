import Database from 'better-sqlite3'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
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
  seedWebSources,
  startLocalSettingsHttpServer
} from '../../../../harness/e2e/settings'

const CASE_ID = 'workspace-interrupted-jobs-recovery'
const WORKSPACE_NAME = '中断恢复工作空间'

const readJob = (userDataDir: string, jobId: string): WorkspaceIndexJobRecord | null => {
  const database = new Database(path.join(userDataDir, 'app.sqlite'), { readonly: true })
  try {
    return (database.prepare('SELECT * FROM workspace_index_job WHERE id = ?').get(jobId) ||
      null) as WorkspaceIndexJobRecord | null
  } finally {
    database.close()
  }
}

const createLargeWorkspace = async (rootPath: string): Promise<void> => {
  const docsPath = path.join(rootPath, 'docs')
  await mkdir(docsPath, { recursive: true })
  const totalFiles = 200_000
  const batchSize = 500
  for (let batchStart = 0; batchStart < totalFiles; batchStart += batchSize) {
    await Promise.all(
      Array.from({ length: Math.min(batchSize, totalFiles - batchStart) }, (_, offset) => {
        const index = batchStart + offset
        return writeFile(
          path.join(docsPath, `interrupted-${String(index).padStart(5, '0')}.txt`),
          `interrupted scan ${String(index)}`,
          'utf8'
        )
      })
    )
  }
}

describe('settings workspace recovery e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'settings',
        suite: 'workspace',
        groups: ['core'],
        description:
          '通过真实 UI 启动文件和网页后台任务，关闭并重启应用后验证中断任务收敛为失败并退出执行中状态。',
        fixtures: [],
        serviceMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          let page = runtime.page
          const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'ncurator-interrupted-'))
          runtime.registerResource({
            name: `interrupted-workspace:${workspaceRoot}`,
            phase: 'after-app-close',
            dispose: async () => await rm(workspaceRoot, { recursive: true, force: true })
          })
          const server = await startLocalSettingsHttpServer({
            '/interrupted': {
              body: '<html><head><title>Interrupted Web</title></head><body>real delayed page</body></html>',
              delayMs: 30_000
            }
          })
          runtime.registerResource({
            name: 'interrupted-web-server',
            phase: 'before-app-close',
            dispose: server.close
          })

          const workspace = await createRealWorkspaceWithRoot(page, {
            name: WORKSPACE_NAME,
            rootPath: workspaceRoot
          })
          const workspaceId = workspace.workspace!.id
          await createLargeWorkspace(workspaceRoot)
          await getSettingsLocator(page, importSelectors.workspaceQuickScanButton).click()
          await getSettingsLocator(page, importSelectors.workspaceIndexJobProgress).waitFor({
            state: 'visible'
          })
          const fileJobId = await page.evaluate(async (id) => {
            const response = await window.api.workspaceIndexJobGet({
              workspaceId: id,
              sourceKind: 'file'
            })
            if (!response.job) throw new Error('file scan job is not running')
            return response.job.id
          }, workspaceId)

          ;({ page } = await runtime.restartApp())
          await navigateToSettingsSection(page, 'workspace')
          await getSettingsLocator(page, importSelectors.workspaceQuickScanButton).waitFor({
            state: 'visible'
          })
          // Scan must leave the running/disabled-by-job state; prepare may stay disabled
          // without a vector model or actionable files (not part of AC4).
          await page.waitForFunction((testId) => {
            const button = document.querySelector(`[data-testid="${testId}"]`)
            return button instanceof HTMLButtonElement && !button.disabled
          }, importSelectors.workspaceQuickScanButton)
          const fileProgressHidden = await getSettingsLocator(
            page,
            importSelectors.workspaceIndexJobProgress
          ).isHidden()
          const fileScanButtonEnabled = !(await getSettingsLocator(
            page,
            importSelectors.workspaceQuickScanButton
          ).isDisabled())
          const fileJob = readJob(runtime.userDataDir, fileJobId)

          await seedWebSources(page, workspaceId, [server.url('/interrupted')])
          await navigateToSettingsSection(page, 'workspace')
          await page.getByRole('tab', { name: /网页/u }).click()
          await page.getByRole('button', { name: '检查更新', exact: true }).click()
          await page.getByTestId(importSelectors.webSourceIndexJobProgress).waitFor({
            state: 'visible'
          })
          const webScanJobId = await page.evaluate(async (id) => {
            const response = await window.api.workspaceIndexJobGet({
              workspaceId: id,
              sourceKind: 'web'
            })
            if (!response.job) throw new Error('web scan job is not running')
            return response.job.id
          }, workspaceId)

          ;({ page } = await runtime.restartApp())
          await navigateToSettingsSection(page, 'workspace')
          await page.getByRole('tab', { name: /网页/u }).click()
          const webScanJob = readJob(runtime.userDataDir, webScanJobId)
          const webScanProgressHidden = await page
            .getByTestId(importSelectors.webSourceIndexJobProgress)
            .isHidden()

          await page.getByRole('button', { name: '更新索引', exact: true }).click()
          await page.getByTestId(importSelectors.webSourceIndexJobProgress).waitFor({
            state: 'visible'
          })
          const webPrepareJobId = await page.evaluate(async (id) => {
            const response = await window.api.workspaceIndexJobGet({
              workspaceId: id,
              sourceKind: 'web'
            })
            if (!response.job) throw new Error('web prepare job is not running')
            return response.job.id
          }, workspaceId)

          ;({ page } = await runtime.restartApp())
          await navigateToSettingsSection(page, 'workspace')
          await page.getByRole('tab', { name: /网页/u }).click()
          const webPrepareJob = readJob(runtime.userDataDir, webPrepareJobId)
          const webSources = await page.evaluate(async () => {
            const response = await window.api.webSourceList({})
            return response.items
          })
          const webProgressHidden = await page
            .getByTestId(importSelectors.webSourceIndexJobProgress)
            .isHidden()

          return {
            fileProgressHidden,
            fileScanButtonEnabled,
            fileJobStatus: fileJob?.status,
            fileJobError: fileJob?.last_error,
            webScanProgressHidden,
            webScanJobStatus: webScanJob?.status,
            webPrepareJobStatus: webPrepareJob?.status,
            webPrepareJobError: webPrepareJob?.last_error,
            webProgressHidden,
            webSourceStatuses: webSources.map((source) => source.index_status),
            webSourceErrors: webSources.map((source) => source.last_error)
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.fileProgressHidden &&
              result.fileScanButtonEnabled &&
              result.fileJobStatus === 'failed' &&
              Boolean(result.fileJobError),
            {
              name: 'interrupted-file-scan-fails-after-restart',
              message:
                '文件检查被关闭中断后，重启必须退出执行中状态、恢复检查按钮并将任务标记为失败，对齐 SET-WORKSPACE-003-AC4。',
              data: result
            }
          )
          await runtime.assertThat(
            result.webScanProgressHidden && result.webScanJobStatus === 'failed',
            {
              name: 'interrupted-web-scan-fails-after-restart',
              message:
                '网页检查被关闭中断后，重启必须退出执行中状态并将任务标记为失败，对齐 SET-WEB-003-AC4。',
              data: result
            }
          )
          await runtime.assertThat(
            result.webPrepareJobStatus === 'failed' &&
              Boolean(result.webPrepareJobError) &&
              result.webProgressHidden &&
              result.webSourceStatuses.every((status) =>
                ['crawl_failed', 'index_failed'].includes(status)
              ) &&
              result.webSourceErrors.every(Boolean),
            {
              name: 'interrupted-web-prepare-fails-after-restart',
              message:
                '网页索引被关闭中断后，重启必须将任务和执行中的网页收敛为失败，对齐 SET-WEB-004-AC6。',
              data: result
            }
          )
        }
      })
    },
    SETTINGS_REAL_WORKSPACE_LONG_E2E_TIMEOUT_MS
  )
})
