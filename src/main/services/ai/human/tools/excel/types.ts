import type { AiFileChangeRecord, JsonObject } from '../../../../../../shared/types'
import type { AiRunContext } from '../../../types'
import type { ToolEventEmitter } from '../utils/toolEvents'
import type { ExcelEditInput } from './schemas'

export type ExcelCellSnapshot = {
  address: string
  value: unknown
  displayValue: string
  formula?: string
  type: string
  numberFormat?: string
  style?: JsonObject
}

export type ExcelToolRuntime = {
  outline: (args: { sourcePath: string }) => Promise<JsonObject>
  search: (args: {
    sourcePath: string
    query: string
    mode?: 'literal' | 'regex'
    scope?: { sheetNames?: string[] }
  }) => Promise<JsonObject>
  readCells: (args: {
    sourcePath: string
    ranges: Array<{ sheetName: string; range: string }>
  }) => Promise<JsonObject>
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
}
