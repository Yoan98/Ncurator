import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import type { AiRunEvent } from '../../../../../src/shared/types'
import type { TerminalToolContext } from '../../../../../src/main/services/ai/types'
import { createHumanRuntimeCache } from '../../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { buildTerminalCapabilityTools } from '../../../../../src/main/services/ai/human/tools/terminal/terminalTools'
import type { TerminalSessionManager } from '../../../../../src/main/services/ai/human/tools/terminal/TerminalSessionManager'
import { createTerminalToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { filterEventsByType } from '../testHelpers'

type TerminalRunCommandResult = {
  terminalId: string
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
      description: '验证终端命令完成后立即记录本命令产生的文件变化。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const sourceDir = path.join(runtime.workspaceRoot, 'generated')
        await fs.mkdir(sourceDir, { recursive: true })
        await fs.writeFile(path.join(runtime.workspaceRoot, 'notes.txt'), 'before\n')
        await fs.writeFile(path.join(runtime.workspaceRoot, 'replacement.txt'), 'after\n')
        const harness = createTerminalToolHarness(runtime)
        try {
          const updateExisting = await harness.invoke<TerminalRunCommandResult>('terminal_run', {
            command: isWindows
              ? 'Copy-Item -LiteralPath replacement.txt -Destination notes.txt'
              : 'cp replacement.txt notes.txt'
          })
          const createNew = await harness.invoke<TerminalRunCommandResult>('terminal_run', {
            terminalId: updateExisting.terminalId,
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
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          !result.updateExisting.reason &&
            !result.createNew.reason &&
            result.approvalEvents.length === 0 &&
            result.notesContent === 'after\n' &&
            result.createdExists &&
            !Object.hasOwn(result.updateExisting, 'artifacts') &&
            !Object.hasOwn(result.createNew, 'artifacts') &&
            result.records.length === 2 &&
            result.records.every((record) => record.source === 'terminal_tool') &&
            result.records.every((record) => record.runId === runtime.runId) &&
            result.artifactEvents.length === 2,
          {
            name: 'terminal-command-scoped-change-capture',
            message: '终端工具应以命令前后快照记录真实文件变化，不依赖顶层 Run 收尾扫描。',
            data: result
          }
        )
      }
    })
  })

  it('terminal-tracking-start-failure-cleanup', async () => {
    await runBackendCase({
      caseId: 'terminal-tracking-start-failure-cleanup',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['terminal'],
      description: '验证终端启动失败时丢弃已创建的命令级文件追踪。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const baseCtx = runtime.createAiRunContext()
        const events: AiRunEvent[] = []
        const begunTrackingIds: string[] = []
        const discardedTrackingIds: string[] = []
        let finishCalls = 0
        const ctx = {
          runId: runtime.runId,
          platform: baseCtx.platform,
          checkCancelled: baseCtx.checkCancelled,
          humanRuntimeOverrides: baseCtx.humanRuntimeOverrides,
          sendEvent: (event: AiRunEvent) => events.push(event),
          saveFileChangeRecord: baseCtx.saveFileChangeRecord,
          beginTerminalCommandTracking: async ({ commandId }) => {
            begunTrackingIds.push(commandId)
          },
          finishTerminalCommandTracking: async () => {
            finishCalls += 1
            return []
          },
          discardTerminalCommandTracking: (commandId) => {
            discardedTrackingIds.push(commandId)
          }
        } satisfies TerminalToolContext
        const failedSessionManager = {
          list: () => [],
          run: async () => {
            throw new Error('terminal startup failed')
          }
        } as unknown as TerminalSessionManager
        const terminalRun = buildTerminalCapabilityTools({
          ctx,
          cache: createHumanRuntimeCache(),
          runId: runtime.runId,
          partnerId: 'test-session',
          taskId: runtime.taskId,
          workspaceRootPath: runtime.workspaceRoot,
          workspaceId: 'test-workspace',
          sessionManager: failedSessionManager,
          emitActivity: () => undefined
        }).tools.find((tool) => tool.name === 'terminal_run')
        if (!terminalRun) throw new Error('terminal_run tool is missing')
        const result = await terminalRun.invoke({
          command: isWindows ? 'Get-Location' : 'pwd',
          commandExplanation: '验证终端启动失败时的追踪清理。'
        })

        return {
          result,
          begunTrackingIds,
          discardedTrackingIds,
          finishCalls,
          artifactEvents: events.filter((event) => event.type === 'file_artifact')
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.begunTrackingIds.length === 1 &&
            result.discardedTrackingIds.length === 1 &&
            result.discardedTrackingIds[0] === result.begunTrackingIds[0] &&
            result.finishCalls === 0 &&
            result.artifactEvents.length === 0,
          {
            name: 'terminal-startup-failure-discards-file-tracking',
            message: '终端启动失败后必须丢弃命令快照，不得保存修改记录或发送文件 artifact。',
            data: result
          }
        )
      }
    })
  })
})
