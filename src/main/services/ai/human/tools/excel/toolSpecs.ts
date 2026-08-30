import { z } from 'zod/v4'
import type { JsonObject } from '../../../../../../shared/types'
import type { RuntimeToolName } from '../../../../../../shared/runtimeCapabilities'
import type { RuntimeSkillId } from '../../types'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver, readStringArg } from '../utils/toolSpecUtils'
import { excelEditSchema, excelReadSchema } from './schemas'
import { excelEditOutputSchema, excelReadOutputSchema } from './outputSchemas'
import {
  renderExcelEditModelResult,
  renderExcelReadModelResult
} from '../../shared/modelToolResultRenderers'
type ExcelSpec<
  TArgs extends JsonObject,
  TOutput extends JsonObject,
  TName extends RuntimeToolName,
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

export const EXCEL_READ_TOOL_SPEC = {
  name: 'excel_read',
  familyId: 'excel',
  skillIds: ['excel-read'],
  inputSchema: excelReadSchema,
  outputSchema: excelReadOutputSchema,
  promptSpec: {
    name: 'excel_read',
    description: '读取 Excel 工作簿结构、单元格内容、格式，或按格子搜索。'
  },
  resolveExecutionMeta: readMeta,
  modelResult: { renderSuccess: renderExcelReadModelResult }
} satisfies ExcelSpec<
  z.infer<typeof excelReadSchema>,
  z.infer<typeof excelReadOutputSchema>,
  'excel_read',
  'excel-read'
>

export const EXCEL_EDIT_TOOL_SPEC = {
  name: 'excel_edit',
  familyId: 'excel',
  skillIds: ['excel-write'],
  inputSchema: excelEditSchema,
  outputSchema: excelEditOutputSchema,
  promptSpec: {
    name: 'excel_edit',
    description: '创建或编辑 Excel 的工作表、单元格、公式、格式和结构。'
  },
  resolveExecutionMeta: writeMeta,
  modelResult: { renderSuccess: renderExcelEditModelResult }
} satisfies ExcelSpec<
  z.infer<typeof excelEditSchema>,
  z.infer<typeof excelEditOutputSchema>,
  'excel_edit',
  'excel-write'
>

export const EXCEL_TOOL_SPECS = [EXCEL_READ_TOOL_SPEC, EXCEL_EDIT_TOOL_SPEC] as const
