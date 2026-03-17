import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'vitest'
import type { AiRunEvent } from '../../../../../src/shared/types'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { createTerminalToolHarness } from '../../../../harness/backend/aiToolHarness'

type TerminalRunResult = {
  ok: boolean
  code: string
  command: string
  cwd: string
  stepId: string
  stepIndex: number
  outputPreview: string
  stdoutPreview: string
  stderrPreview: string
  exitCode: number | null
  timedOut: boolean
  truncated: boolean
  artifacts: Array<{
    path: string
    operation: 'created' | 'updated'
  }>
  error?: string
}

describe('terminal artifact approval', () => {
  it('auto-approves a medium-risk write command and emits file artifact events', async () => {
    await runBackendCase({
      caseId: 'terminal-artifact-approval',
      caseType: 'scenario',
      domain: 'ai',
      layer: 'backend',
      suite: 'tools',
      groups: ['terminal'],
      description: '验证 terminal capability 对 medium risk 写入命令会触发审批并产出 file_artifact',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const harness = createTerminalToolHarness(runtime)
        const result = await harness.invoke<TerminalRunResult>('terminal_run_command', {
          command: "printf 'stage1 artifact' > result.txt && cat result.txt"
        })

        runtime.recordEvent({
          type: 'step',
          name: 'terminal-medium-risk-artifact',
          status: result.ok ? 'ok' : 'failed',
          message: result.ok
            ? 'terminal medium risk 命令执行成功并生成 artifact'
            : 'terminal medium risk 命令执行失败',
          data: {
            command: result.command,
            exitCode: result.exitCode,
            artifactCount: result.artifacts.length,
            outputPreview: result.outputPreview
          }
        })

        return {
          result,
          aiEvents: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(result.result.ok && result.result.exitCode === 0, {
          name: 'terminal-medium-risk-success',
          message: 'medium risk terminal 命令执行成功'
        })
        runtime.assertThat(
          result.result.outputPreview.includes('stage1 artifact') &&
            result.result.artifacts.length === 1 &&
            path.basename(result.result.artifacts[0]?.path || '') === 'result.txt',
          {
            name: 'terminal-artifact-detected',
            message: 'terminal 输出与 artifact 路径都符合预期',
            data: {
              outputPreview: result.result.outputPreview,
              artifacts: result.result.artifacts
            }
          }
        )
        runtime.assertThat(fs.existsSync(path.join(runtime.workspaceRoot, 'result.txt')), {
          name: 'terminal-artifact-file-exists',
          message: 'terminal 命令实际生成了 result.txt'
        })

        const approvalRequired = result.aiEvents.filter(
          (event: AiRunEvent) => event.type === 'approval_required'
        )
        const approvalGranted = result.aiEvents.filter(
          (event: AiRunEvent) => event.type === 'approval_decision' && event.approved
        )
        const fileArtifacts = result.aiEvents.filter(
          (event: AiRunEvent) => event.type === 'file_artifact'
        )

        runtime.assertThat(
          approvalRequired.length === 1 &&
            approvalGranted.length === 1 &&
            fileArtifacts.length === 1,
          {
            name: 'terminal-approval-and-artifact-events',
            message: 'approval_required / approval_decision / file_artifact 事件均已记录',
            data: {
              approvalRequired: approvalRequired.length,
              approvalGranted: approvalGranted.length,
              fileArtifacts: fileArtifacts.length
            }
          }
        )
      }
    })
  })
})
