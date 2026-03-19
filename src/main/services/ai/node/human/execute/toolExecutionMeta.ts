import {
  classifyCommandMode,
  classifyCommandRisk,
  collectTerminalArtifactCandidates
} from '../../../tools/terminal_exec/terminalPolicy'
import type { JsonObject } from '../../../../../../shared/types'
import type { ToolExecutionMeta } from '../shared/state'

const DOCX_READ_ONLY_TOOLS = new Set([
  'docx_outline',
  'docx_search',
  'docx_get_block',
  'docx_validate',
  'docx_get_history'
])

const KB_READ_ONLY_TOOLS = new Set([
  'kb_hybrid_search_chunks',
  'kb_vector_search_chunks',
  'kb_fts_search_chunks',
  'kb_list_documents'
])

export const getToolExecutionMeta = (input: {
  toolName: string
  args: JsonObject
}): ToolExecutionMeta => {
  if (KB_READ_ONLY_TOOLS.has(input.toolName)) {
    return {
      mutability: 'read_only',
      parallelSafe: true,
      resourceKey: 'local-kb'
    }
  }

  if (DOCX_READ_ONLY_TOOLS.has(input.toolName)) {
    const docId = typeof input.args.docId === 'string' ? input.args.docId : undefined
    return {
      mutability: 'read_only',
      parallelSafe: true,
      resourceKey: docId || 'docx'
    }
  }

  if (
    input.toolName === 'docx_open' ||
    input.toolName === 'docx_apply_ops' ||
    input.toolName === 'docx_rollback' ||
    input.toolName === 'docx_save' ||
    input.toolName === 'docx_render_preview'
  ) {
    const sourcePath = typeof input.args.sourcePath === 'string' ? input.args.sourcePath : undefined
    const docId = typeof input.args.docId === 'string' ? input.args.docId : undefined
    return {
      mutability: 'mutating',
      parallelSafe: false,
      resourceKey: sourcePath || docId || 'docx'
    }
  }

  if (input.toolName === 'terminal_run_command') {
    const command = typeof input.args.command === 'string' ? input.args.command : ''
    const risk = classifyCommandRisk(command)
    const commandMode = classifyCommandMode(command)
    const artifacts = collectTerminalArtifactCandidates(command)
    if (risk === 'low' && commandMode === 'read_only' && artifacts.length === 0) {
      return {
        mutability: 'read_only',
        parallelSafe: true,
        resourceKey: typeof input.args.cwd === 'string' ? input.args.cwd : 'workspace'
      }
    }
    return {
      mutability: 'mutating',
      parallelSafe: false,
      resourceKey: typeof input.args.cwd === 'string' ? input.args.cwd : 'workspace'
    }
  }

  return {
    mutability: 'mutating',
    parallelSafe: false
  }
}

export const canBatchPlan = (input: {
  actions: Array<{ toolName: string; args: JsonObject }>
  maxParallel: number
}): boolean => {
  if (input.actions.length <= 1) return true
  if (input.actions.length > input.maxParallel) return false

  for (const action of input.actions) {
    const meta = getToolExecutionMeta(action)
    if (meta.mutability !== 'read_only' || !meta.parallelSafe) return false
  }
  return true
}
