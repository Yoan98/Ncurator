import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createTerminalToolHarness } from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { filterEventsByType } from '../testHelpers'

type WorkspaceResult = {
  ok: boolean
  code: 'ok' | 'failed' | 'invalid_input' | 'approval_denied' | 'workspace_required'
  [key: string]: unknown
}

describe('ai tool terminal backend', () => {
  it('terminal-directory-inspection-readonly', async () => {
    await runBackendCase({
      caseId: 'terminal-directory-inspection-readonly',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['terminal'],
      description: '验证 workspace 目录浏览与文件读取类只读工具的基础契约。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await fs.mkdir(path.join(runtime.workspaceRoot, 'materials', 'nested'), {
          recursive: true
        })
        await fs.writeFile(
          path.join(runtime.workspaceRoot, 'materials', 'nested', 'daily-note.txt'),
          'alpha\nbeta\ngamma\n'
        )

        const harness = createTerminalToolHarness(runtime)

        return {
          files: await harness.invoke<WorkspaceResult>('workspace_list_files', {
            path: 'materials',
            limit: 20
          }),
          search: await harness.invoke<WorkspaceResult>('workspace_search_text', {
            query: 'beta',
            path: 'materials'
          }),
          read: await harness.invoke<WorkspaceResult>('workspace_read_file', {
            path: 'materials/nested/daily-note.txt'
          }),
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const approvalEvents = filterEventsByType(result.events, 'approval_required')
        const stepErrors = filterEventsByType(result.events, 'terminal_step_error')

        runtime.assertThat(
          result.files.ok &&
            result.search.ok &&
            result.read.ok &&
            approvalEvents.length === 0 &&
            stepErrors.length === 0,
          {
            name: 'readonly-workspace-tools-run-without-approval',
            message: '目录与文件读取类只读工具应直接成功执行，且不触发审批。',
            data: {
              approvals: approvalEvents.length,
              stepErrors: stepErrors.length,
              codes: [result.files.code, result.search.code, result.read.code]
            }
          }
        )

        const fileItems = Array.isArray(result.files.items) ? result.files.items : []
        const searchMatches = Array.isArray(result.search.matches) ? result.search.matches : []
        const readContent = typeof result.read.content === 'string' ? result.read.content : ''
        runtime.assertThat(
          fileItems.some((item) => JSON.stringify(item).includes('daily-note.txt')) &&
            searchMatches.some((item) => JSON.stringify(item).includes('beta')) &&
            readContent.includes('alpha') &&
            readContent.includes('gamma'),
          {
            name: 'readonly-workspace-tools-return-stable-output',
            message: 'workspace 只读工具应返回稳定结构，供后续推理继续消费。',
            data: {
              files: result.files,
              search: result.search,
              read: result.read
            }
          }
        )
      }
    })
  })
})
