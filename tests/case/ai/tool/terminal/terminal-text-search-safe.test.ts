import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createTerminalToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { filterEventsByType } from '../testHelpers'

type TerminalRunCommandResult = {
  output: string
  error?: string
}

const isWindows = process.platform === 'win32'

describe('ai tool terminal backend', () => {
  it('terminal-text-search-safe', async () => {
    await runBackendCase({
      caseId: 'terminal-text-search-safe',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['terminal'],
      description: '验证通过平台安全指令执行文本搜索，并在越界路径参数下于执行前拒绝。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await fs.mkdir(path.join(runtime.workspaceRoot, 'notes'), { recursive: true })
        await fs.writeFile(
          path.join(runtime.workspaceRoot, 'notes', 'release.md'),
          'Approval denied should keep existing files unchanged.\nTerminal artifacts must be recorded.\n'
        )
        await fs.writeFile(
          path.join(runtime.workspaceRoot, 'notes', 'overview.md'),
          'Overview content should not leave workspace scope.\n'
        )

        const harness = createTerminalToolHarness(runtime)

        const firstSearch = await harness.invoke<TerminalRunCommandResult & { terminalId: string }>(
          'terminal_run',
          {
            command: isWindows
              ? 'Get-ChildItem -Path notes -Recurse -File | Select-String -Pattern "Approval denied"'
              : 'grep -R -n "Approval denied" notes'
          }
        )
        const result = {
          firstSearch,
          secondSearch: await harness.invoke<TerminalRunCommandResult>('terminal_run', {
            terminalId: firstSearch.terminalId,
            command: isWindows
              ? 'Get-ChildItem -Path notes -Recurse -File | Select-String -Pattern "artifacts"'
              : 'grep -R -n "artifacts" notes'
          }),
          boundaryRejected: await harness.invoke<TerminalRunCommandResult>('terminal_run', {
            command: isWindows
              ? 'Get-ChildItem -Path ../ -Recurse -File | Select-String -Pattern "Overview"'
              : 'grep -R -n "Overview" ../'
          }),
          events: runtime.eventCollector.snapshot()
        }
        await harness.release()
        return result
      },
      assert: async (result, runtime) => {
        const approvalEvents = filterEventsByType(result.events, 'approval_batch_required')

        runtime.assertThat(
          !result.firstSearch.error && !result.secondSearch.error && approvalEvents.length === 0,
          {
            name: 'search-commands-stay-safe',
            message: '安全文本搜索指令应直接成功执行，不触发审批。',
            data: {
              approvals: approvalEvents.length,
              firstSearch: result.firstSearch,
              secondSearch: result.secondSearch
            }
          }
        )

        runtime.assertThat(
          result.firstSearch.output.includes('release.md') &&
            result.secondSearch.output.includes('Terminal artifacts must be recorded.') &&
            result.boundaryRejected.error.includes('workspace boundary check failed'),
          {
            name: 'search-commands-honor-boundary-checks',
            message: '文本搜索应正确返回命中结果，并在越界路径参数下于执行前拒绝。',
            data: {
              firstSearch: result.firstSearch.output,
              secondSearch: result.secondSearch.output,
              boundaryRejected: result.boundaryRejected
            }
          }
        )
      }
    })
  })
})
