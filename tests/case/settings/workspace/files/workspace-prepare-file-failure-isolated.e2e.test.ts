import { cp, mkdir } from 'node:fs/promises'
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
import { createWorkspaceWithFiles, toSupportedFileStatuses } from './realWorkspaceHelpers'

describe('settings workspace e2e', () => {
  it(
    'workspace-prepare-file-failure-isolated',
    async () => {
      await runE2ECase({
        caseId: 'workspace-prepare-file-failure-isolated',
        domain: 'settings',
        suite: 'workspace',
        groups: ['files'],
        description:
          '单个文件索引失败不应导致 Settings 页面或 Electron 应用退出，并应留下文件级失败状态。',
        fixtures: ['tests/fixtures/workspace/sample-edit.docx'],
        knowledge: 'cached',
        serviceMode: 'real',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          let workspaceRoot = ''
          workspaceRoot = await createWorkspaceWithFiles(
            'workspace-prepare-file-failure-isolated',
            [
              {
                relativePath: 'broken.docx',
                content: 'not a valid docx archive'
              }
            ]
          )
          await mkdir(path.join(workspaceRoot, 'ok'), { recursive: true })
          await cp(
            path.resolve('tests/fixtures/workspace/sample-edit.docx'),
            path.join(workspaceRoot, 'ok', 'sample-edit.docx')
          )
          const workspace = await createRealWorkspaceWithRoot(page, {
            name: '失败隔离工作区',
            rootPath: workspaceRoot
          })
          const workspaceId = workspace.workspace!.id

          await navigateToSettingsSection(page, 'workspace')
          await getSettingsLocator(page, importSelectors.workspaceQuickPrepareButton).waitFor({
            state: 'visible'
          })
          await getSettingsLocator(page, importSelectors.workspaceQuickPrepareButton).click()
          const result = await waitForFileIndexJobIdle(page, workspaceId)
          const pingTree = await page.evaluate(async (selectedWorkspaceId) => {
            return await window.api.workspaceTree({
              workspaceId: selectedWorkspaceId,
              includeUnsupported: true
            })
          }, workspaceId)

          return {
            finalSummary: result.tree.summary,
            statuses: toSupportedFileStatuses(result.tree),
            pingTotal: pingTree.total
          }
        },
        assert: async (result, runtime) => {
          const broken = result.statuses.find((item) => item.relativePath === 'broken.docx')
          const valid = result.statuses.find((item) => item.relativePath === 'ok/sample-edit.docx')

          await runtime.assertThat(Boolean(result.pingTotal >= 2), {
            name: 'app-remains-responsive-after-file-failure',
            message:
              '单文件失败后，Settings 页面仍应能通过 IPC 读取目录树，不能导致应用退出，对齐 SET-WORKSPACE-004-AC8。',
            data: result
          })

          await runtime.assertThat(
            broken?.status === 'failed' &&
              Boolean(broken.lastError) &&
              Boolean(valid) &&
              (valid.status === 'indexed' || valid.status === 'failed'),
            {
              name: 'file-failure-is-file-level',
              message:
                '损坏文件应保留文件级 failed/last_error，其他支持文件也应完成自身状态收敛，对齐 SET-WORKSPACE-004-AC2、SET-WORKSPACE-008-AC2。',
              data: result
            }
          )
        }
      })
    },
    SETTINGS_REAL_WORKSPACE_E2E_TIMEOUT_MS
  )
})
