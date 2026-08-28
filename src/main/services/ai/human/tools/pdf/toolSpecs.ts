import type { z } from 'zod/v4'
import type { JsonObject } from '../../../../../../shared/types'
import type { RuntimeToolName } from '../../../../../../shared/runtimeCapabilities'
import type { RuntimeSkillId } from '../../types'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver, readStringArg } from '../utils/toolSpecUtils'
import {
  pdfInspectOutputSchema,
  pdfReadPagesOutputSchema,
  pdfSearchOutputSchema
} from './outputSchemas'
import { pdfInspectSchema, pdfReadPagesSchema, pdfSearchSchema } from './schemas'

const PDF_READ_EXECUTION_META = createStaticExecutionMetaResolver({
  mutability: 'read_only',
  getResourceKey: (args) => readStringArg(args, 'sourcePath'),
  defaultResourceKey: 'pdf'
})

type PdfToolSpec<
  TArgs extends JsonObject = JsonObject,
  TOutput extends JsonObject = JsonObject,
  TName extends RuntimeToolName = RuntimeToolName,
  TSkillId extends RuntimeSkillId = 'pdf-read'
> = HumanToolSpec<TArgs, TOutput, TName, TSkillId>

export const PDF_INSPECT_TOOL_SPEC: PdfToolSpec<
  z.infer<typeof pdfInspectSchema>,
  z.infer<typeof pdfInspectOutputSchema>,
  'pdf_inspect',
  'pdf-read'
> = {
  name: 'pdf_inspect',
  familyId: 'pdf',
  skillIds: ['pdf-read'],
  promptSpec: {
    name: 'pdf_inspect',
    description: '读取 PDF 的基础信息，并返回页数、元数据、书签提纲和警告。'
  },
  inputSchema: pdfInspectSchema,
  outputSchema: pdfInspectOutputSchema,
  resolveExecutionMeta: PDF_READ_EXECUTION_META
}

export const PDF_SEARCH_TOOL_SPEC: PdfToolSpec<
  z.infer<typeof pdfSearchSchema>,
  z.infer<typeof pdfSearchOutputSchema>,
  'pdf_search',
  'pdf-read'
> = {
  name: 'pdf_search',
  familyId: 'pdf',
  skillIds: ['pdf-read'],
  promptSpec: {
    name: 'pdf_search',
    description:
      '在 PDF 文本层中按 literal 或 regex 搜索并支持限制页码和数量，并返回页码、匹配文本、上下文、位置和文本层统计。'
  },
  inputSchema: pdfSearchSchema,
  outputSchema: pdfSearchOutputSchema,
  resolveExecutionMeta: PDF_READ_EXECUTION_META
}

export const PDF_READ_PAGES_TOOL_SPEC: PdfToolSpec<
  z.infer<typeof pdfReadPagesSchema>,
  z.infer<typeof pdfReadPagesOutputSchema>,
  'pdf_read_pages',
  'pdf-read'
> = {
  name: 'pdf_read_pages',
  familyId: 'pdf',
  skillIds: ['pdf-read'],
  promptSpec: {
    name: 'pdf_read_pages',
    description:
      '按连续页码范围或指定页码集合读取 PDF，并逐页返回正文、页码、文本状态、图片数量、尺寸和可交给 read_image 的 pageImagePath。'
  },
  inputSchema: pdfReadPagesSchema,
  outputSchema: pdfReadPagesOutputSchema,
  resolveExecutionMeta: PDF_READ_EXECUTION_META
}

export const PDF_TOOL_SPECS = [
  PDF_INSPECT_TOOL_SPEC,
  PDF_SEARCH_TOOL_SPEC,
  PDF_READ_PAGES_TOOL_SPEC
] as const
