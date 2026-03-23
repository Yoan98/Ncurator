import path from 'node:path'
import { test } from 'vitest'
import { terminalToolFamily } from '../../../../../src/main/services/ai/human/tools/terminal'
import type { AiRunEvent, AiTaskResultCode, JsonObject } from '../../../../../src/shared/types'
import { createTerminalToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

type WorkspaceGuardResult = {
  ok: boolean
  code: AiTaskResultCode
  error?: string
}

type TerminalRunResult = {
  ok: boolean
  code: AiTaskResultCode
  artifacts: Array<{ path: string; operation: 'created' | 'updated' }>
  outputPreview: string
}

const isEventType = <TType extends AiRunEvent['type']>(
  event: AiRunEvent,
  type: TType
): event is Extract<AiRunEvent, { type: TType }> => event.type === type

test('terminal-workspace-guard', async () => {
  await runBackendCase({
    caseId: 'terminal-workspace-guard',
    caseType: 'basic',
    domain: 'ai',
    layer: 'backend',
    suite: 'tools',
    groups: ['terminal'],
    description: 'terminal family keeps workspace guard behavior and terminal execution emits tool/artifact events.',
    fixtures: [],
    runMode: 'repeatable',
    execute: async (runtime) => {
      const unboundCtx = runtime.createAiRunContext({ bindWorkspace: false })
      const [guardTool] = terminalToolFamily.buildTools({
        ctx: unboundCtx,
        runId: runtime.runId,
        taskId: runtime.taskId
      })
      const guardResult = await guardTool.invoke({} as JsonObject)

      const harness = createTerminalToolHarness(runtime)
      const runResult = await harness.invoke<TerminalRunResult>('terminal_run_command', {
        command: 'printf "terminal regression" > summary.txt',
        cwd: '.',
        expectedArtifacts: [{ path: 'summary.txt', operation: 'created' }]
      })

      return {
        guardResult: guardResult as WorkspaceGuardResult,
        runResult,
        activities: harness.activities,
        events: runtime.eventCollector.snapshot()
      }
    },
    assert: async (result, runtime) => {
      runtime.assertThat(result.guardResult.code === 'workspace_required', {
        name: 'terminal-guard-code',
        message: 'terminal family should return workspace_required when workspace is unbound',
        data: result.guardResult
      })

      runtime.assertThat(result.runResult.ok, {
        name: 'terminal-run-ok',
        message: 'terminal_run_command should succeed for a workspace-bound write command',
        data: result.runResult
      })

      runtime.assertThat(
        result.runResult.artifacts.some((artifact) => artifact.path.endsWith(path.join('summary.txt'))),
        {
          name: 'terminal-artifact-path',
          message: 'terminal_run_command should capture the declared artifact path',
          data: result.runResult.artifacts
        }
      )

      const workspaceRequiredEvents = result.events.filter((event) =>
        isEventType(event, 'workspace_required')
      )
      const toolStartedEvents = result.events.filter((event) => isEventType(event, 'tool_call_started'))
      const toolResultEvents = result.events.filter((event) => isEventType(event, 'tool_call_result'))
      const terminalStepEvents = result.events.filter(
        (event) => isEventType(event, 'terminal_step_started') || isEventType(event, 'terminal_step_result')
      )
      const artifactEvents = result.events.filter((event) => isEventType(event, 'file_artifact'))

      runtime.assertThat(workspaceRequiredEvents.length === 1, {
        name: 'terminal-workspace-event',
        message: 'workspace guard should emit one workspace_required event',
        data: workspaceRequiredEvents
      })

      runtime.assertThat(toolStartedEvents.length >= 1 && toolResultEvents.length >= 1, {
        name: 'terminal-tool-events',
        message: 'terminal execution should emit tool_call_started and tool_call_result events',
        data: result.events
      })

      runtime.assertThat(terminalStepEvents.length === 2, {
        name: 'terminal-step-events',
        message: 'terminal execution should emit terminal_step_started and terminal_step_result events',
        data: terminalStepEvents
      })

      runtime.assertThat(artifactEvents.length === 1, {
        name: 'terminal-artifact-event',
        message: 'terminal execution should emit one file_artifact event for the generated file',
        data: artifactEvents
      })

      runtime.assertThat(
        result.activities.some((activity) => activity.actionType === 'terminal_exec' && activity.status === 'completed'),
        {
          name: 'terminal-activity',
          message: 'terminal execution should record a completed terminal_exec activity',
          data: result.activities
        }
      )
    }
  })
})
