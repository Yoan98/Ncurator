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
import { createRetryModelResultPolicy } from '../modelResultPolicies'

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
    description:
      '读取 Excel：workbook 看表清单，range 读值和公式，style 读格式，search 按格子值或公式搜索。'
  },
  resolveExecutionMeta: readMeta,
  modelResult: {
    renderSuccess: renderExcelReadModelResult,
    overflowPolicy: createRetryModelResultPolicy(
      'Call excel_read again with a smaller range, a narrower sheetName, or a more specific search query.'
    )
  }
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
    description:
      '一次一个 type 创建或编辑 Excel：工作表、范围值/公式、样式、合并、行列和列宽行高。'
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
