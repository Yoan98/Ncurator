import { copyFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, it } from 'vitest'
import { importSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_REAL_WORKSPACE_E2E_TIMEOUT_MS,
  createRealWorkspaceWithRoot,
  getSettingsLocator,
  getWorkspaceIndexCounts,
  navigateToSettingsSection,
  waitForFileIndexJobIdle
} from '../../../../harness/e2e/settings'
import {
  createEmptyE2EWorkspace,
  E2E_WORKSPACE_FIXTURE_ROOT
} from '../../../../harness/e2e/workspaceFixture'

const FILE_NAMES = ['workbench-preview.md', 'human-input.txt', 'subagent-checkout-config.ts']

it(
  'workspace-scan-progress-refresh',
  async () => {
    await runE2ECase({
      caseId: 'workspace-scan-progress-refresh',
      domain: 'settings',
      suite: 'workspace',
      groups: ['files'],
      description: '检查更新扫描三个真实文件，完成后刷新目录树并汇总两份待索引文件。',
      fixtures: ['tests/fixtures/workspace'],
      knowledge: 'none',
      serviceMode: 'real',
      runMode: 'single',
      execute: async ({ page }) => {
        const { rootPath } = await createEmptyE2EWorkspace(
          'workspace-scan-progress-refresh',
          'settings'
        )
        const response = await createRealWorkspaceWithRoot(page, { rootPath, name: '扫描工作区' })
        const workspaceId = response.workspace!.id
        await navigateToSettingsSection(page, 'workspace')
        const initial = await waitForFileIndexJobIdle(page, workspaceId)
        expect(initial.tree.summary.file_count).toBe(0)
        await getSettingsLocator(page, importSelectors.workspaceTree)
          .getByRole('button', { name: new RegExp(path.basename(rootPath)) })
          .first()
          .click()
        const scan = getSettingsLocator(page, importSelectors.workspaceQuickScanButton)
        await scan.waitFor({ state: 'visible' })

        await Promise.all(
          FILE_NAMES.map((name) =>
            copyFile(path.join(E2E_WORKSPACE_FIXTURE_ROOT, name), path.join(rootPath, name))
          )
        )

        const observer = await page.evaluateHandle((id) => {
          const readCount = (): number =>
            (
              window as typeof window & {
                __NCURATOR_E2E_OBSERVER__?: { ipcInvokeEntries: Array<{ name: string }> }
              }
            ).__NCURATOR_E2E_OBSERVER__?.ipcInvokeEntries.filter(
              (entry) => entry.name === 'workspaceDirectoryList'
            ).length || 0
          const baseline = readCount()
          const events: {
            id: string
            phase: string
            status: string
            total: number
            reads: number
          }[] = []
          const done = new Promise<typeof events>((resolve) => {
            const timeout = window.setTimeout(() => {
              unsubscribe()
              resolve(events)
            }, 10_000)
            const unsubscribe = window.api.onWorkspaceIndexJobProgress((job) => {
              if (job.workspace_id !== id || job.source_kind !== 'file' || job.action !== 'scan')
                return
              events.push({
                id: job.id,
                phase: job.phase,
                status: job.status,
                total: job.total_count,
                reads: readCount() - baseline
              })
              if (job.status !== 'running') {
                window.clearTimeout(timeout)
                unsubscribe()
                resolve(events)
              }
            })
          })
          return { done }
        }, workspaceId)
        await scan.click()
        const events = await observer.evaluate(({ done }) => done)
        await observer.dispose()

        const tree = getSettingsLocator(page, importSelectors.workspaceTree)
        for (const name of FILE_NAMES) await tree.getByText(name, { exact: true }).waitFor()
        await page.waitForFunction(
          (testId) =>
            document.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() === '2',
          importSelectors.workspaceActionableIndexCount
        )
        const counts = await getWorkspaceIndexCounts(page)
        const { tree: indexed } = await waitForFileIndexJobIdle(page, workspaceId)
        return { events, counts, indexed: indexed.summary }
      },
      assert: async ({ events, counts, indexed }, runtime) => {
        await runtime.assertThat(
          new Set(events.map((event) => event.id)).size === 1 &&
            events.some((event) => event.phase === 'scan' && event.status === 'running') &&
            events.some((event) => event.phase === 'diff' && event.total === 2) &&
            events
              .filter((event) => event.status === 'running')
              .every((event) => event.reads === 0) &&
            events.at(-1)?.status === 'succeeded' &&
            indexed.file_count === 2 &&
            indexed.needs_index_count === 2 &&
            counts.actionableCount === 2,
          {
            name: 'workspace-scan-refreshes-fixed-files',
            message: '检查更新应完成两阶段，刷新实际目录，并且只统计两份可索引文件。',
            data: { events, counts, indexed }
          }
        )
      }
    })
  },
  SETTINGS_REAL_WORKSPACE_E2E_TIMEOUT_MS
)
