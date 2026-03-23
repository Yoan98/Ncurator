import { test } from 'vitest'
import { docxToolFamily } from '../../../../src/main/services/ai/human/tools/docx'
import { terminalToolFamily } from '../../../../src/main/services/ai/human/tools/terminal'
import { listToolNamesByFamily } from '../../../../src/main/services/ai/human/tools/toolCatalog'
import type { AiTaskResultCode, JsonObject } from '../../../../src/shared/types'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

type WorkspaceGuardResult = {
  ok: boolean
  code: AiTaskResultCode
  error?: string
}

const sortNames = (values: string[]) => [...values].sort((left, right) => left.localeCompare(right))

test('workspace-bound-family-builder', async () => {
  await runBackendCase({
    caseId: 'workspace-bound-family-builder',
    caseType: 'basic',
    domain: 'ai',
    layer: 'backend',
    suite: 'tools',
    groups: ['catalog'],
    description:
      'workspace-bound tool family helper should preserve guard behavior and tool filtering for terminal/docx families.',
    fixtures: [],
    runMode: 'repeatable',
    execute: async (runtime) => {
      const unboundCtx = runtime.createAiRunContext({ bindWorkspace: false })
      const boundCtx = runtime.createAiRunContext()

      const unboundTerminalTools = terminalToolFamily.buildTools({
        ctx: unboundCtx,
        runId: runtime.runId,
        taskId: runtime.taskId
      })
      const unboundDocxTools = docxToolFamily.buildTools({
        ctx: unboundCtx,
        runId: runtime.runId,
        taskId: runtime.taskId
      })
      const boundTerminalTools = terminalToolFamily.buildTools({
        ctx: boundCtx,
        runId: runtime.runId,
        taskId: runtime.taskId
      })
      const boundDocxTools = docxToolFamily.buildTools({
        ctx: boundCtx,
        runId: runtime.runId,
        taskId: runtime.taskId
      })

      return {
        terminalGuardResult: (await unboundTerminalTools[0].invoke({} as JsonObject)) as WorkspaceGuardResult,
        docxGuardResult: (await unboundDocxTools[0].invoke({} as JsonObject)) as WorkspaceGuardResult,
        unboundTerminalToolNames: sortNames(unboundTerminalTools.map((tool) => String(tool.name || '').trim())),
        unboundDocxToolNames: sortNames(unboundDocxTools.map((tool) => String(tool.name || '').trim())),
        boundTerminalToolNames: sortNames(boundTerminalTools.map((tool) => String(tool.name || '').trim())),
        boundDocxToolNames: sortNames(boundDocxTools.map((tool) => String(tool.name || '').trim())),
        expectedTerminalToolNames: sortNames(listToolNamesByFamily('terminal')),
        expectedDocxToolNames: sortNames(listToolNamesByFamily('docx'))
      }
    },
    assert: async (result, runtime) => {
      runtime.assertThat(
        result.terminalGuardResult.code === 'workspace_required' &&
          result.docxGuardResult.code === 'workspace_required',
        {
          name: 'workspace-bound-guard-results',
          message:
            'workspace-bound helper should keep terminal and docx unbound-family results at workspace_required',
          data: {
            terminalGuardResult: result.terminalGuardResult,
            docxGuardResult: result.docxGuardResult
          }
        }
      )

      runtime.assertThat(
        result.unboundTerminalToolNames.join(',') === result.expectedTerminalToolNames.join(',') &&
          result.unboundDocxToolNames.join(',') === result.expectedDocxToolNames.join(','),
        {
          name: 'workspace-bound-guard-toolsets',
          message:
            'unbound family builders should still expose exactly the guarded tool names for terminal and docx',
          data: {
            unboundTerminalToolNames: result.unboundTerminalToolNames,
            unboundDocxToolNames: result.unboundDocxToolNames
          }
        }
      )

      runtime.assertThat(
        result.boundTerminalToolNames.join(',') === result.expectedTerminalToolNames.join(',') &&
          result.boundDocxToolNames.join(',') === result.expectedDocxToolNames.join(','),
        {
          name: 'workspace-bound-built-toolsets',
          message:
            'bound family builders should still filter back to the exact terminal/docx tool names after helper extraction',
          data: {
            boundTerminalToolNames: result.boundTerminalToolNames,
            boundDocxToolNames: result.boundDocxToolNames
          }
        }
      )
    }
  })
})
