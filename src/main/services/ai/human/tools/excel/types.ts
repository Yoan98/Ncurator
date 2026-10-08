import type { JsonObject } from '../../../../../../shared/types'
import type { AiRunContext } from '../../../types'
import type { ExcelEditInput, ExcelReadInput } from './toolSchemas'

export type ExcelToolRuntime = {
  read: (args: ExcelReadInput) => Promise<JsonObject>
  edit: (args: ExcelEditInput) => Promise<JsonObject>
}

export type ExcelCapabilityToolsInput = {
  ctx: AiRunContext
  cache: { excelRuntime?: ExcelToolRuntime }
  runId: string
  partnerId: string
  taskId: string
  workspaceRootPath: string
  emitActivity: (input: {
    actionType: string
    status: 'started' | 'completed' | 'failed'
    summary: string
  }) => void
}
