import { createWorkspaceBoundToolFamily } from '../utils/workspaceGuards'
import type { DocxCapabilityToolsInput } from './types'
import { createDocxToolRuntime } from './runtime'
import { buildDocxReadTools } from './tools/readTools'
import { buildDocxWriteTools } from './tools/writeTools'

export const buildDocxCapabilityTools = (input: DocxCapabilityToolsInput) => {
  const runtime = createDocxToolRuntime(input)
  input.cache.docxRuntime = runtime

  return {
    tools: [...buildDocxReadTools(runtime), ...buildDocxWriteTools(runtime)],
    state: runtime.state,
    runtime
  }
}

export const docxToolFamily = createWorkspaceBoundToolFamily({
  familyId: 'docx',
  buildWorkspaceTools: ({
    ctx,
    cache,
    runId,
    partnerId,
    taskId,
    workspaceRootPath,
    emitActivity
  }) =>
    buildDocxCapabilityTools({
      ctx,
      cache,
      runId,
      partnerId,
      taskId,
      workspaceRootPath,
      emitActivity
    }).tools
})
