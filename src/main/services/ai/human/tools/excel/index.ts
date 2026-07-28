import { tool } from '@langchain/core/tools'
import type { z } from 'zod/v4'
import type { JsonObject } from '../../../../../../shared/types'
import { createWorkspaceBoundToolFamily } from '../utils/workspaceGuards'
import { createToolEventEmitter } from '../utils/toolEvents'
import { withToolLifecycle } from '../utils/lifecycle'
import { createExcelToolRuntime, toExcelToolFailure } from './runtime'
import {
  excelEditSchema,
  excelReadCellsSchema,
  excelReadOutlineSchema,
  excelSearchSchema
} from './schemas'
import {
  EXCEL_EDIT_TOOL_SPEC,
  EXCEL_READ_CELLS_TOOL_SPEC,
  EXCEL_READ_OUTLINE_TOOL_SPEC,
  EXCEL_SEARCH_TOOL_SPEC
} from './toolSpecs'
import type { ExcelCapabilityToolsInput } from './types'

type ExcelToolName = 'excel_read_outline' | 'excel_search' | 'excel_read_cells' | 'excel_edit'

const ACTIVITY: Record<ExcelToolName, string> = {
  excel_read_outline: '读取 Excel 概览',
  excel_search: '搜索 Excel',
  excel_read_cells: '读取 Excel 单元格',
  excel_edit: '编辑 Excel'
}

export const buildExcelCapabilityTools = (input: ExcelCapabilityToolsInput) => {
  const runtime = createExcelToolRuntime(input)
  input.cache.excelRuntime = runtime
  const emitter = createToolEventEmitter({
    ctx: input.ctx,
    runId: input.runId,
    taskId: input.taskId
  })

  const createTool = <TSchema extends z.ZodType>(params: {
    name: ExcelToolName
    description: string
    schema: TSchema
    execute: (args: never) => Promise<JsonObject>
  }) =>
    tool(
      async (args) =>
        await withToolLifecycle({
          emitter,
          toolName: params.name,
          args: args as JsonObject,
          execute: async (session) => {
            input.ctx.checkCancelled()
            input.emitActivity({
              actionType: params.name,
              status: 'started',
              summary: ACTIVITY[params.name]
            })
            try {
              const result = await params.execute(args as never)
              session.succeed(undefined, { toolName: params.name, ok: true, data: result })
              input.emitActivity({
                actionType: params.name,
                status: 'completed',
                summary: `${ACTIVITY[params.name]}完成`
              })
              return result
            } catch (error) {
              const sourcePath =
                typeof (args as JsonObject)?.sourcePath === 'string'
                  ? String((args as JsonObject).sourcePath)
                  : ''
              const failure = toExcelToolFailure(sourcePath, error)
              session.fail(String(failure.error || 'Excel 工具执行失败'), undefined, {
                toolName: params.name,
                ok: false,
                data: failure
              })
              input.emitActivity({
                actionType: params.name,
                status: 'failed',
                summary: String(failure.error || 'Excel 工具执行失败')
              })
              return failure
            }
          }
        }),
      { name: params.name, description: params.description, schema: params.schema }
    )

  return {
    runtime,
    tools: [
      createTool({
        name: 'excel_read_outline',
        description: EXCEL_READ_OUTLINE_TOOL_SPEC.promptSpec.description,
        schema: excelReadOutlineSchema,
        execute: runtime.outline as never
      }),
      createTool({
        name: 'excel_search',
        description: EXCEL_SEARCH_TOOL_SPEC.promptSpec.description,
        schema: excelSearchSchema,
        execute: runtime.search as never
      }),
      createTool({
        name: 'excel_read_cells',
        description: EXCEL_READ_CELLS_TOOL_SPEC.promptSpec.description,
        schema: excelReadCellsSchema,
        execute: runtime.readCells as never
      }),
      createTool({
        name: 'excel_edit',
        description: EXCEL_EDIT_TOOL_SPEC.promptSpec.description,
        schema: excelEditSchema,
        execute: runtime.edit as never
      })
    ]
  }
}

export const excelToolFamily = createWorkspaceBoundToolFamily({
  familyId: 'excel',
  descriptionForTool: (name) => `Excel 工具暂不可用：${name}`,
  reason: 'Excel capability requires workspace binding before execution',
  error: 'workspace is required for Excel capability',
  buildWorkspaceTools: (input) => buildExcelCapabilityTools(input).tools
})
