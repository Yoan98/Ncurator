import { z } from 'zod/v4'
import type { JsonObject } from '../../../../../../shared/types'
import type { RuntimeSkillId } from '../../types'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver, readStringArg } from '../utils/toolSpecUtils'
import {
  excelEditSchema,
  excelReadCellsSchema,
  excelReadOutlineSchema,
  excelSearchSchema
} from './schemas'
import {
  excelEditOutputSchema,
  excelReadCellsOutputSchema,
  excelReadOutlineOutputSchema,
  excelSearchOutputSchema
} from './outputSchemas'

type ExcelSpec<
  TArgs extends JsonObject,
  TOutput extends JsonObject,
  TName extends string,
  TSkill extends RuntimeSkillId
> = HumanToolSpec<TArgs, TOutput, TName, TSkill>

const readMeta = createStaticExecutionMetaResolver({
  mutability: 'read_only',
  getResourceKey: (args) => readStringArg(args, 'sourcePath'),
  defaultResourceKey: 'excel'
})
const writeMeta = createStaticExecutionMetaResolver({
  mutability: 'mutating',
  getResourceKey: (args) => readStringArg(args, 'sourcePath'),
  defaultResourceKey: 'excel'
})

export const EXCEL_READ_OUTLINE_TOOL_SPEC = {
  name: 'excel_read_outline',
  familyId: 'excel',
  requiresWorkspace: true,
  skillIds: ['excel-read'],
  inputSchema: excelReadOutlineSchema,
  outputSchema: excelReadOutlineOutputSchema,
  promptSpec: {
    name: 'excel_read_outline',
    description: '读取 Excel 工作簿、工作表、使用范围、表格和公式数量概览。'
  },
  resolveExecutionMeta: readMeta
} satisfies ExcelSpec<
  z.infer<typeof excelReadOutlineSchema>,
  z.infer<typeof excelReadOutlineOutputSchema>,
  'excel_read_outline',
  'excel-read'
>

export const EXCEL_SEARCH_TOOL_SPEC = {
  name: 'excel_search',
  familyId: 'excel',
  requiresWorkspace: true,
  skillIds: ['excel-read'],
  inputSchema: excelSearchSchema,
  outputSchema: excelSearchOutputSchema,
  promptSpec: {
    name: 'excel_search',
    description: '搜索 Excel 单元格值、显示值、公式、工作表名和表格列名。'
  },
  resolveExecutionMeta: readMeta
} satisfies ExcelSpec<
  z.infer<typeof excelSearchSchema>,
  z.infer<typeof excelSearchOutputSchema>,
  'excel_search',
  'excel-read'
>

export const EXCEL_READ_CELLS_TOOL_SPEC = {
  name: 'excel_read_cells',
  familyId: 'excel',
  requiresWorkspace: true,
  skillIds: ['excel-read'],
  inputSchema: excelReadCellsSchema,
  outputSchema: excelReadCellsOutputSchema,
  promptSpec: {
    name: 'excel_read_cells',
    description: '按工作表和 A1 范围读取 Excel 单元格地址、值、显示值、公式、类型和数字格式。'
  },
  resolveExecutionMeta: readMeta
} satisfies ExcelSpec<
  z.infer<typeof excelReadCellsSchema>,
  z.infer<typeof excelReadCellsOutputSchema>,
  'excel_read_cells',
  'excel-read'
>

export const EXCEL_EDIT_TOOL_SPEC = {
  name: 'excel_edit',
  familyId: 'excel',
  requiresWorkspace: true,
  skillIds: ['excel-write'],
  inputSchema: excelEditSchema,
  outputSchema: excelEditOutputSchema,
  promptSpec: {
    name: 'excel_edit',
    description:
      '创建或编辑 Excel 工作簿中的工作表、单元格、公式、格式和结构，并返回写入后的回读信息。'
  },
  resolveExecutionMeta: writeMeta
} satisfies ExcelSpec<
  z.infer<typeof excelEditSchema>,
  z.infer<typeof excelEditOutputSchema>,
  'excel_edit',
  'excel-write'
>

export const EXCEL_TOOL_SPECS = [
  EXCEL_READ_OUTLINE_TOOL_SPEC,
  EXCEL_SEARCH_TOOL_SPEC,
  EXCEL_READ_CELLS_TOOL_SPEC,
  EXCEL_EDIT_TOOL_SPEC
] as const
