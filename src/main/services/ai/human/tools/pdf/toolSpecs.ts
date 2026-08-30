import type { z } from 'zod/v4'
import type { JsonObject } from '../../../../../../shared/types'
import type { RuntimeToolName } from '../../../../../../shared/runtimeCapabilities'
import type { RuntimeSkillId } from '../../types'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver, readStringArg } from '../utils/toolSpecUtils'
import {
  pdfOutlineOutputSchema,
  pdfOutlineSchema,
  pdfReadPagesOutputSchema,
  pdfReadPagesSchema,
  pdfSearchOutputSchema,
  pdfSearchSchema
} from './toolSchemas'
import {
  renderPdfOutlineModelResult,
  renderPdfReadPagesModelResult,
  renderPdfSearchModelResult
} from '../../shared/modelToolResultRenderers'

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

export const PDF_OUTLINE_TOOL_SPEC: PdfToolSpec<
  z.infer<typeof pdfOutlineSchema>,
  z.infer<typeof pdfOutlineOutputSchema>,
  'pdf_outline',
  'pdf-read'
> = {
  name: 'pdf_outline',
  familyId: 'pdf',
  skillIds: ['pdf-read'],
  promptSpec: {
    name: 'pdf_outline',
    description: '读取 PDF 页数、元数据与书签提纲。'
  },
  inputSchema: pdfOutlineSchema,
  outputSchema: pdfOutlineOutputSchema,
  resolveExecutionMeta: PDF_READ_EXECUTION_META,
  modelResult: { renderSuccess: renderPdfOutlineModelResult }
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
      '在 PDF 文本层中按 literal 或 regex 搜索，支持可选页码范围；最多返回 10 条匹配及文本层统计。'
  },
  inputSchema: pdfSearchSchema,
  outputSchema: pdfSearchOutputSchema,
  resolveExecutionMeta: PDF_READ_EXECUTION_META,
  modelResult: { renderSuccess: renderPdfSearchModelResult }
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
      '按连续页码范围或指定页码集合读取 PDF，并逐页返回正文、页码、文本状态、图片数量与可交给 read_image 的 pageImagePath。'
  },
  inputSchema: pdfReadPagesSchema,
  outputSchema: pdfReadPagesOutputSchema,
  resolveExecutionMeta: PDF_READ_EXECUTION_META,
  modelResult: { renderSuccess: renderPdfReadPagesModelResult }
}

export const PDF_TOOL_SPECS = [
  PDF_OUTLINE_TOOL_SPEC,
  PDF_SEARCH_TOOL_SPEC,
  PDF_READ_PAGES_TOOL_SPEC
] as const
