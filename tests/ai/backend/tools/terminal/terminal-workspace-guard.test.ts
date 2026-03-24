import fs from 'node:fs/promises'
import path from 'node:path'
import { test } from 'vitest'
import { parseShellTokens, splitCommandSegments } from '../../../../../src/main/services/ai/human/tools/terminal/commandParsing'
import { terminalToolFamily } from '../../../../../src/main/services/ai/human/tools/terminal'
import { collectTerminalArtifactCandidates } from '../../../../../src/main/services/ai/human/tools/terminal/terminalArtifacts'
import {
  checkWorkspaceBoundary,
  classifyCommandMode,
  classifyCommandRisk
} from '../../../../../src/main/services/ai/human/tools/terminal/terminalCommandPolicy'
import { resolveTerminalCwd } from '../../../../../src/main/services/ai/human/tools/terminal/terminalCwd'
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
      const notesDir = path.join(runtime.workspaceRoot, 'notes', 'archive')
      const notesFile = path.join(runtime.workspaceRoot, 'notes', 'readme.txt')
      await fs.mkdir(notesDir, { recursive: true })
      await fs.writeFile(notesFile, 'terminal helper regression', 'utf8')

      return {
        guardResult: guardResult as WorkspaceGuardResult,
        runResult,
        helperChecks: {
          parsedTokens: parseShellTokens('printf "terminal helper" > reports/output.txt'),
          commandSegments: splitCommandSegments(
            'cat notes/readme.txt && printf "done" > reports/output.txt | tee reports/log.txt'
          ),
          artifactCandidates: collectTerminalArtifactCandidates(
            'mkdir reports && printf "done" > reports/output.txt | tee reports/log.txt'
          ),
          cwdResolutions: {
            rootAlias: resolveTerminalCwd({
              workspaceRootPath: runtime.workspaceRoot,
              requestedCwd: path.basename(runtime.workspaceRoot)
            }),
            nested: resolveTerminalCwd({
              workspaceRootPath: runtime.workspaceRoot,
              requestedCwd: 'notes/archive'
            }),
            invalidFile: resolveTerminalCwd({
              workspaceRootPath: runtime.workspaceRoot,
              requestedCwd: 'notes/readme.txt'
            }),
            outside: resolveTerminalCwd({
              workspaceRootPath: runtime.workspaceRoot,
              requestedCwd: '../outside'
            })
          },
          commandPolicies: {
            safeRead: {
              risk: classifyCommandRisk('cat notes/readme.txt'),
              mode: classifyCommandMode('cat notes/readme.txt')
            },
            writeRedirect: {
              risk: classifyCommandRisk('printf "done" > reports/output.txt'),
              mode: classifyCommandMode('printf "done" > reports/output.txt')
            },
            destructive: {
              risk: classifyCommandRisk('rm -rf reports')
            },
            boundaryInside: checkWorkspaceBoundary(`cat ${notesFile}`, runtime.workspaceRoot),
            boundaryEscape: checkWorkspaceBoundary('cat ../outside.txt', runtime.workspaceRoot),
            boundaryOutsideAbsolute: checkWorkspaceBoundary('cat /tmp/outside.txt', runtime.workspaceRoot)
          }
        },
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

      runtime.assertThat(
        result.helperChecks.parsedTokens.join(',') ===
          'printf,terminal helper,>,reports/output.txt' &&
          result.helperChecks.commandSegments.join(',') ===
            'cat notes/readme.txt,printf "done" > reports/output.txt,tee reports/log.txt' &&
          result.helperChecks.artifactCandidates.length === 3 &&
          result.helperChecks.artifactCandidates[0]?.rawPath === 'reports' &&
          result.helperChecks.artifactCandidates[0]?.operation === 'created' &&
          result.helperChecks.artifactCandidates.some(
            (candidate) => candidate.rawPath === 'reports/output.txt'
          ) &&
          result.helperChecks.artifactCandidates.some(
            (candidate) => candidate.rawPath === 'reports/log.txt'
          ),
        {
          name: 'terminal-helper-command-parsing',
          message:
            'terminal command parsing and artifact inference helpers should keep stable tokenization, segmentation, and artifact detection',
          data: result.helperChecks
        }
      )

      runtime.assertThat(
        result.helperChecks.cwdResolutions.rootAlias.ok &&
          result.helperChecks.cwdResolutions.rootAlias.cwd === runtime.workspaceRoot &&
          result.helperChecks.cwdResolutions.nested.ok &&
          result.helperChecks.cwdResolutions.nested.cwd ===
            path.join(runtime.workspaceRoot, 'notes', 'archive') &&
          !result.helperChecks.cwdResolutions.invalidFile.ok &&
          result.helperChecks.cwdResolutions.invalidFile.code === 'invalid_input' &&
          !result.helperChecks.cwdResolutions.outside.ok &&
          result.helperChecks.cwdResolutions.outside.code === 'workspace_required',
        {
          name: 'terminal-helper-cwd-resolution',
          message:
            'terminal cwd helper should normalize workspace aliases and reject file paths or workspace escapes',
          data: result.helperChecks.cwdResolutions
        }
      )

      runtime.assertThat(
        result.helperChecks.commandPolicies.safeRead.risk === 'low' &&
          result.helperChecks.commandPolicies.safeRead.mode === 'read_only' &&
          result.helperChecks.commandPolicies.writeRedirect.risk === 'medium' &&
          result.helperChecks.commandPolicies.writeRedirect.mode === 'mutating' &&
          result.helperChecks.commandPolicies.destructive.risk === 'high' &&
          result.helperChecks.commandPolicies.boundaryInside.ok &&
          !result.helperChecks.commandPolicies.boundaryEscape.ok &&
          !result.helperChecks.commandPolicies.boundaryOutsideAbsolute.ok,
        {
          name: 'terminal-helper-policy-classification',
          message:
            'terminal policy helpers should preserve risk classification, command mode inference, and workspace boundary blocking',
          data: result.helperChecks.commandPolicies
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
