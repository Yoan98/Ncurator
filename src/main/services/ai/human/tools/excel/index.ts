import { tool } from '@langchain/core/tools'
import type { z } from 'zod/v4'
import type { JsonObject } from '../../../../../../shared/types'
import { createWorkspaceBoundToolFamily } from '../utils/workspaceGuards'
import { createToolEventEmitter } from '../utils/toolEvents'
import { withToolLifecycle } from '../utils/lifecycle'
import { createExcelToolRuntime, toExcelToolFailure } from './runtime'
import { excelEditSchema, excelReadSchema } from './toolSchemas'
import { EXCEL_EDIT_TOOL_SPEC, EXCEL_READ_TOOL_SPEC } from './toolSpecs'
import type { ExcelCapabilityToolsInput } from './types'

type ExcelToolName = 'excel_read' | 'excel_edit'

const readActivity = (args: JsonObject): string => {
  const type = typeof args.type === 'string' ? args.type : 'workbook'
  if (type === 'search') return '搜索 Excel'
  if (type === 'style') return '读取 Excel 样式'
  if (type === 'range') return '读取 Excel 范围'
  return '读取 Excel 工作簿'
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
    summary: (args: JsonObject) => string
  }) =>
    tool(
      async (args) =>
        await withToolLifecycle({
          emitter,
          toolName: params.name,
          args: args as JsonObject,
          execute: async (session) => {
            input.ctx.checkCancelled()
            const summary = params.summary(args as JsonObject)
            input.emitActivity({
              actionType: params.name,
              status: 'started',
              summary
            })
            try {
              const result = await params.execute(args as never)
              session.succeed(undefined, { toolName: params.name, ok: true, data: result })
              input.emitActivity({
                actionType: params.name,
                status: 'completed',
                summary: `${summary}完成`
              })
              return result
            } catch (error) {
              const sourcePath =
                typeof (args as JsonObject)?.sourcePath === 'string'
                  ? String((args as JsonObject).sourcePath)
                  : ''
              const failure = toExcelToolFailure(sourcePath, params.name, error)
              session.fail(String(failure.error), undefined, {
                toolName: params.name,
                ok: false,
                data: failure
              })
              input.emitActivity({
                actionType: params.name,
                status: 'failed',
                summary: String(failure.error)
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
        name: 'excel_read',
        description: EXCEL_READ_TOOL_SPEC.promptSpec.description,
        schema: excelReadSchema,
        execute: runtime.read as never,
        summary: readActivity
      }),
      createTool({
        name: 'excel_edit',
        description: EXCEL_EDIT_TOOL_SPEC.promptSpec.description,
        schema: excelEditSchema,
        execute: runtime.edit as never,
        summary: () => '编辑 Excel'
      })
    ]
  }
}

export const excelToolFamily = createWorkspaceBoundToolFamily({
  familyId: 'excel',
  buildWorkspaceTools: (input) => buildExcelCapabilityTools(input).tools
})
