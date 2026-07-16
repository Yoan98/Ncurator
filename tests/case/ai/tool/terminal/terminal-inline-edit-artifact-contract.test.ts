import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createTerminalToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { filterEventsByType } from '../testHelpers'

type TerminalRunCommandResult = {
  artifacts: unknown[]
  reason?: string
}

const isWindows = process.platform === 'win32'

describe('ai tool terminal backend', () => {
  it('terminal-inline-edit-artifact-contract', async () => {
    await runBackendCase({
      caseId: 'terminal-inline-edit-artifact-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['terminal'],
      description: '验证终端只执行命令，文件变化统一交给 Run 结束扫描捕获。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const sourceDir = path.join(runtime.workspaceRoot, 'generated')
        await fs.mkdir(sourceDir, { recursive: true })
        await fs.writeFile(path.join(runtime.workspaceRoot, 'notes.txt'), 'before\n')
        await fs.writeFile(path.join(runtime.workspaceRoot, 'replacement.txt'), 'after\n')
        const harness = createTerminalToolHarness(runtime)
        const updateExisting = await harness.invoke<TerminalRunCommandResult>('terminal_run', {
          command: isWindows
            ? 'Copy-Item -LiteralPath replacement.txt -Destination notes.txt'
            : 'cp replacement.txt notes.txt'
        })
        const createNew = await harness.invoke<TerminalRunCommandResult>('terminal_run', {
          command: isWindows
            ? 'New-Item -ItemType File -Path generated/output.txt'
            : 'touch generated/output.txt'
        })
        return {
          updateExisting,
          createNew,
          notesContent: await fs.readFile(path.join(runtime.workspaceRoot, 'notes.txt'), 'utf8'),
          createdExists: await fs
            .access(path.join(runtime.workspaceRoot, 'generated', 'output.txt'))
            .then(() => true)
            .catch(() => false),
          records: await harness.ctx.listFileChangeRecords({ runId: runtime.runId }),
          artifactEvents: filterEventsByType(runtime.eventCollector.snapshot(), 'file_artifact'),
          approvalEvents: filterEventsByType(
            runtime.eventCollector.snapshot(),
            'approval_batch_required'
          )
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          !result.updateExisting.reason &&
            !result.createNew.reason &&
            result.approvalEvents.length === 2 &&
            result.notesContent === 'after\n' &&
            result.createdExists &&
            result.updateExisting.artifacts.length === 0 &&
            result.createNew.artifacts.length === 0 &&
            result.records.length === 0 &&
            result.artifactEvents.length === 0,
          {
            name: 'terminal-defers-workspace-change-capture',
            message: '终端工具不得根据命令文本猜测文件产物，变化由顶层 Run 扫描统一捕获。',
            data: result
          }
        )
      }
    })
  })
})
