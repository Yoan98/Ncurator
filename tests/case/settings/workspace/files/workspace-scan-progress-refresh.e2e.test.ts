import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
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

const createManyWorkspaceFiles = async (workspaceRoot: string): Promise<void> => {
  const docsRoot = path.join(workspaceRoot, 'docs')
  await mkdir(docsRoot, { recursive: true })
  await Promise.all(
    Array.from({ length: 600 }, async (_, index) => {
      const fileName = `brief-${String(index + 1).padStart(3, '0')}.txt`
      await writeFile(path.join(docsRoot, fileName), `hello workspace ${index + 1}`, 'utf8')
    })
  )
}

describe('settings workspace e2e', () => {
  it(
    'workspace-scan-progress-refresh',
    async () => {
      await runE2ECase({
        caseId: 'workspace-scan-progress-refresh',
        domain: 'settings',
        suite: 'workspace',
        groups: ['files'],
        description: '点击检查更新后，页面展示执行中状态，并在完成后刷新目录树和索引摘要。',
        fixtures: [],
        serviceMode: 'real',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'ncurator-settings-scan-'))
          runtime.registerResource({
            name: `settings-workspace:${workspaceRoot}`,
            phase: 'after-app-close',
            dispose: async () => await rm(workspaceRoot, { recursive: true, force: true })
          })
          let workspaceId = ''

          await runtime.step({
            name: 'create-empty-workspace',
            message: '通过 UI 创建并绑定一个真实空目录工作空间。',
            run: async () => {
              const workspace = await createRealWorkspaceWithRoot(page, {
                rootPath: workspaceRoot,
                name: '扫描工作区'
              })
              workspaceId = workspace.workspace!.id
              await navigateToSettingsSection(page, 'workspace')
              await getSettingsLocator(page, importSelectors.workspaceQuickScanButton).waitFor({
                state: 'visible'
              })
            }
          })

          await runtime.step({
            name: 'create-real-file-changes',
            message: '在已绑定目录里写入真实文件，制造目录变化。',
            run: async () => {
              await createManyWorkspaceFiles(workspaceRoot)
            }
          })

          let inProgressVisible = false
          let buttonsDisabled = false
          let progressEventSeen = false

          await runtime.step({
            name: 'scan-workspace-through-ui',
            message: '点击检查更新，并捕捉真实进度事件或执行中 UI。',
            run: async () => {
              const progressEventsPromise = page.evaluate(
                (workspaceId) =>
                  new Promise<boolean>((resolve) => {
                    let settled = false
                    const finish = (value: boolean): void => {
                      if (settled) return
                      settled = true
                      unsubscribe()
                      resolve(value)
                    }
                    const unsubscribe = window.api.onWorkspaceIndexJobProgress((job) => {
                      if (
                        job.workspace_id === workspaceId &&
                        job.source_kind === 'file' &&
                        job.action === 'scan'
                      ) {
                        finish(true)
                      }
                    })
                    window.setTimeout(() => finish(false), 3000)
                  }),
                workspaceId
              )

              await getSettingsLocator(page, importSelectors.workspaceQuickScanButton).click()
              inProgressVisible = await getSettingsLocator(
                page,
                importSelectors.workspaceIndexJobProgress
              )
                .waitFor({
                  state: 'visible',
                  timeout: 1000
                })
                .then(() => true)
                .catch(() => false)
              if (inProgressVisible) {
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
              progressEventSeen = await progressEventsPromise
            }
          })

          const result = await waitForFileIndexJobIdle(page, workspaceId)

          return {
            inProgressVisible,
            buttonsDisabled,
            progressEventSeen,
            summary: result.tree.summary,
            itemNames: result.tree.items.map((item) => item.name)
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(result.inProgressVisible || result.progressEventSeen, {
            name: 'scan-progress-is-observable',
            message:
              '检查更新应通过真实 UI 触发扫描，并能观察到执行中的 UI 或真实进度事件；扫描很快完成时进度块可能已恢复。',
            data: result
          })

          await runtime.assertThat(
            result.summary.file_count === 600 &&
              result.summary.needs_index_count === 600 &&
              result.itemNames.includes('brief-001.txt'),
            {
              name: 'scan-refreshes-summary-and-tree',
              message:
                '检查成功后，文件索引摘要和目录树内容都应同步刷新，对齐 SET-WORKSPACE-003-AC2。',
              data: result
            }
          )
        }
      })
    },
    SETTINGS_REAL_WORKSPACE_E2E_TIMEOUT_MS
  )
})
