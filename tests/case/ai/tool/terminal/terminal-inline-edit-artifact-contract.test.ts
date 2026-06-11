import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTerminalToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { filterEventsByType } from '../testHelpers'
import { readCapturedRunLog } from '../logHelpers'

type TerminalRunCommandResult = {
  artifacts: Array<{ path: string; operation: 'created' | 'updated' }>
}

const isWindows = process.platform === 'win32'
const normalizeArtifactPath = (value: string): string => value.replace(/\\/g, '/')

describe('ai tool terminal backend', () => {
  it('terminal-inline-edit-artifact-contract', async () => {
    let runId = ''

    await runBackendCase({
      caseId: 'terminal-inline-edit-artifact-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['terminal'],
      description: '验证文本更新类命令的 mutating 审批路径与 artifact 识别。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        runId = runtime.runId
        const sourceDir = path.join(runtime.workspaceRoot, 'generated')
        await fs.mkdir(sourceDir, { recursive: true })
        await fs.writeFile(path.join(runtime.workspaceRoot, 'notes.txt'), 'before\n')
        await fs.writeFile(path.join(runtime.workspaceRoot, 'replacement.txt'), 'after\n')

        const harness = createTerminalToolHarness(runtime)

        return {
          updateExisting: await harness.invoke<TerminalRunCommandResult>('terminal_run', {
            command: isWindows
              ? 'Copy-Item -LiteralPath replacement.txt -Destination notes.txt'
              : 'cp replacement.txt notes.txt'
          }),
          createNew: await harness.invoke<TerminalRunCommandResult>('terminal_run', {
            command: isWindows
              ? 'New-Item -ItemType File -Path generated/output.txt'
              : 'touch generated/output.txt'
          }),
          notesContent: await fs.readFile(path.join(runtime.workspaceRoot, 'notes.txt'), 'utf8'),
          createdExists: await fs
            .access(path.join(runtime.workspaceRoot, 'generated', 'output.txt'))
            .then(() => true)
            .catch(() => false),
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const approvalEvents = filterEventsByType(result.events, 'approval_batch_required')
        const artifactEvents = filterEventsByType(result.events, 'file_artifact')

        runtime.assertThat(
          !('reason' in result.updateExisting) &&
            !('reason' in result.createNew) &&
            approvalEvents.length === 2 &&
            result.notesContent === 'after\n' &&
            result.createdExists,
          {
            name: 'mutating-terminal-commands-require-approval',
            message: '文本更新与创建文件命令应被当成 mutating，并走审批后执行。',
            data: {
              approvals: approvalEvents.map((event) => ({
                command: event.items[0]?.command,
                reason: event.items[0]?.reason
              })),
              notesContent: result.notesContent,
              createdExists: result.createdExists
            }
          }
        )

        runtime.assertThat(
          result.updateExisting.artifacts.some(
            (artifact) =>
              artifact.operation === 'updated' &&
              normalizeArtifactPath(artifact.path).endsWith('/notes.txt')
          ) &&
            result.createNew.artifacts.some(
              (artifact) =>
                artifact.operation === 'created' &&
                normalizeArtifactPath(artifact.path).endsWith('/generated/output.txt')
            ) &&
            artifactEvents.length >= 2,
          {
            name: 'mutating-terminal-commands-record-artifacts',
            message: 'terminal_run 应识别并结构化返回更新/创建的目标文件 artifact。',
            data: {
              updateArtifacts: result.updateExisting.artifacts,
              createArtifacts: result.createNew.artifacts,
              artifactEvents: artifactEvents.map((event) => ({
                path: event.path,
                operation: event.operation
              }))
            }
          }
        )
      }
    })

    const captured = await readCapturedRunLog({
      scope: 'ai/tool/terminal',
      caseId: 'terminal-inline-edit-artifact-contract',
      runId
    })
    const copiedArtifacts = await Promise.all(
      captured.artifacts.items.map((item) =>
        fs.readFile(path.join(captured.logDir, item.path), 'utf8')
      )
    )

    expect(captured.meta.stats.artifacts).toBe(2)
    expect(captured.artifacts.items).toHaveLength(2)
    expect(captured.artifacts.items.map((item) => item.fileName)).toEqual(
      expect.arrayContaining(['notes.txt', 'output.txt'])
    )
    expect(
      captured.artifacts.items.every(
        (item) =>
          item.path.startsWith('artifacts/file-artifacts/') &&
          (!item.fileName || !item.path.includes(item.fileName))
      )
    ).toBe(true)
    expect(copiedArtifacts).toContain('after\n')
    expect(copiedArtifacts).toContain('')
  })
})
