import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'vitest'
import { importSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_REAL_WORKSPACE_LONG_E2E_TIMEOUT_MS,
  addWorkspaceDirectoryThroughNativeDialog,
  getSettingsLocator,
  navigateToSettingsSection,
  selectWorkspaceIndexSpeedThroughSettingsUi,
  waitForFileIndexJobIdle
} from '../../../../harness/e2e/settings'

type SequentialPrepareEvent = {
  workspaceId: string
  status: string
  startedAt: number
  finishedAt: number
}

describe('settings workspace e2e', () => {
  it(
    'workspace-prepare-sequential-addresses',
    async () => {
      await runE2ECase({
        caseId: 'workspace-prepare-sequential-addresses',
        domain: 'settings',
        suite: 'workspace',
        groups: ['files'],
        description: '多个文件地址更新索引时，前一个地址终态后再启动下一个。',
        fixtures: [],
        serviceMode: 'real',
        execution: 'exclusive',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const firstRoot = await mkdtemp(path.join(os.tmpdir(), 'settings-prepare-seq-a-'))
          const secondRoot = await mkdtemp(path.join(os.tmpdir(), 'settings-prepare-seq-b-'))
          await writeFile(path.join(firstRoot, 'alpha.txt'), 'first address index\n')
          await writeFile(path.join(secondRoot, 'beta.txt'), 'second address index\n')
          runtime.registerResource({
            name: `settings-prepare-seq:${firstRoot}`,
            phase: 'after-app-close',
            dispose: async () => {
              await rm(firstRoot, { recursive: true, force: true })
              await rm(secondRoot, { recursive: true, force: true })
            }
          })

          const firstWorkspaceId = await addWorkspaceDirectoryThroughNativeDialog(page, firstRoot)
          await waitForFileIndexJobIdle(page, firstWorkspaceId)
          const secondWorkspaceId = await addWorkspaceDirectoryThroughNativeDialog(page, secondRoot)
          await waitForFileIndexJobIdle(page, secondWorkspaceId)
          const workspaceIds = [firstWorkspaceId, secondWorkspaceId]
          await navigateToSettingsSection(page, 'workspace')
          await selectWorkspaceIndexSpeedThroughSettingsUi(page, 'fast')
          await page.waitForFunction((testId) => {
            const element = document.querySelector(`[data-testid="${testId}"]`)
            return element instanceof HTMLButtonElement && !element.disabled
          }, importSelectors.workspaceQuickPrepareButton)

          await page.evaluate((ids) => {
            const running = new Set<string>()
            const state = {
              events: [] as SequentialPrepareEvent[],
              overlapped: false
            }
            const host = window as typeof window & {
              __NCURATOR_SEQUENTIAL_PREPARE__?: typeof state
              __NCURATOR_SEQUENTIAL_PREPARE_UNSUB__?: () => void
            }
            host.__NCURATOR_SEQUENTIAL_PREPARE_UNSUB__?.()
            host.__NCURATOR_SEQUENTIAL_PREPARE__ = state
            host.__NCURATOR_SEQUENTIAL_PREPARE_UNSUB__ = window.api.onWorkspaceIndexJobProgress(
              (job) => {
                if (
                  job.source_kind !== 'file' ||
                  job.action !== 'prepare' ||
                  !ids.includes(job.workspace_id)
                ) {
                  return
                }
                state.events.push({
                  workspaceId: job.workspace_id,
                  status: job.status,
                  startedAt: job.started_at,
                  finishedAt: job.finished_at || 0
                })
                if (job.status === 'running') {
                  running.add(job.workspace_id)
                  if (running.size > 1) state.overlapped = true
                } else {
                  running.delete(job.workspace_id)
                }
              }
            )
          }, workspaceIds)

          await getSettingsLocator(page, importSelectors.workspaceQuickPrepareButton).click()

          const deadline = Date.now() + SETTINGS_REAL_WORKSPACE_LONG_E2E_TIMEOUT_MS
          let snapshot = { events: [] as SequentialPrepareEvent[], overlapped: false }
          while (Date.now() < deadline) {
            snapshot = await page.evaluate(() => {
              const state = (
                window as typeof window & {
                  __NCURATOR_SEQUENTIAL_PREPARE__?: {
                    events: SequentialPrepareEvent[]
                    overlapped: boolean
                  }
                }
              ).__NCURATOR_SEQUENTIAL_PREPARE__
              return {
                events: state?.events || [],
                overlapped: state?.overlapped === true
              }
            })
            const finishedIds = new Set(
              snapshot.events
                .filter((event) => event.status !== 'running' && event.finishedAt > 0)
                .map((event) => event.workspaceId)
            )
            if (workspaceIds.every((workspaceId) => finishedIds.has(workspaceId))) break
            await page.waitForTimeout(200)
          }

          await page.evaluate(() => {
            const host = window as typeof window & {
              __NCURATOR_SEQUENTIAL_PREPARE_UNSUB__?: () => void
            }
            host.__NCURATOR_SEQUENTIAL_PREPARE_UNSUB__?.()
          })

          const firstEvents = snapshot.events.filter(
            (event) => event.workspaceId === firstWorkspaceId
          )
          const secondEvents = snapshot.events.filter(
            (event) => event.workspaceId === secondWorkspaceId
          )
          return {
            workspaceCount: workspaceIds.length,
            firstStartedAt: firstEvents[0]?.startedAt || 0,
            firstFinishedAt:
              [...firstEvents].reverse().find((event) => event.finishedAt > 0)?.finishedAt || 0,
            secondStartedAt: secondEvents[0]?.startedAt || 0,
            secondFinishedAt:
              [...secondEvents].reverse().find((event) => event.finishedAt > 0)?.finishedAt || 0,
            overlapped: snapshot.overlapped,
            eventCount: snapshot.events.length
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.workspaceCount === 2 &&
              result.firstFinishedAt > 0 &&
              result.secondFinishedAt > 0 &&
              result.secondStartedAt >= result.firstFinishedAt &&
              result.overlapped === false,
            {
              name: 'prepare-runs-addresses-sequentially',
              message:
                '两个文件地址更新索引时，第二个 job 必须在第一个终态之后才启动，对齐 SET-WORKSPACE-004-AC11。',
              data: result
            }
          )
        }
      })
    },
    SETTINGS_REAL_WORKSPACE_LONG_E2E_TIMEOUT_MS
  )
})
