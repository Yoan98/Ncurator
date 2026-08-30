import type { AiFileChangeRecord, JsonObject } from '../../../../../../shared/types'
import type { AiRunContext } from '../../../types'
import type { ToolEventEmitter } from '../utils/toolEvents'
import type { ExcelEditInput, ExcelReadInput } from './schemas'

export type ExcelToolRuntime = {
  read: (args: ExcelReadInput) => Promise<JsonObject>
  edit: (args: ExcelEditInput) => Promise<JsonObject>
}

export type ExcelCapabilityToolsInput = {
  ctx: AiRunContext
  cache: { excelRuntime?: ExcelToolRuntime }
  runId: string
  sessionId: string
  taskId: string
  workspaceRootPath: string
  emitActivity: (input: {
    actionType: string
    status: 'started' | 'completed' | 'failed'
    summary: string
  }) => void
}

export type ExcelRuntimeState = {
  toolEvents: ToolEventEmitter
  recordsByPath: Map<string, AiFileChangeRecord>
  baselineBytesByPath: Map<string, Buffer | undefined>
  currentBytesByPath: Map<string, Buffer>
  sheetLineageByPath: Map<string, Map<string, string | null>>
}
