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
      description: 'Inspection and text search commands run without unnecessary approval.',
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
          'Overview content should remain available.\n'
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
          events: runtime.eventCollector.snapshot()
        }
        await harness.release()
        return result
      },
      assert: async (result, runtime) => {
        const approvalEvents = filterEventsByType(result.events, 'approval_batch_required')
        runtime.assertThat(
          !result.firstSearch.error &&
            !result.secondSearch.error &&
            approvalEvents.length === 0 &&
            result.firstSearch.output.includes('release.md') &&
            result.secondSearch.output.includes('Terminal artifacts must be recorded.'),
          {
            name: 'search-commands-auto-allow',
            message: 'Inspection and search commands should not require approval.',
            data: { firstSearch: result.firstSearch, secondSearch: result.secondSearch }
          }
        )
      }
    })
  })
})
