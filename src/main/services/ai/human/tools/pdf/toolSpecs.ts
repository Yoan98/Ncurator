import type { z } from 'zod/v4'
import type { JsonObject } from '../../../../../../shared/types'
import type { RuntimeToolName } from '../../../../../../shared/runtimeCapabilities'
import type { RuntimeToolsetId } from '../../types'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver, readStringArg } from '../utils/toolSpecUtils'
import { pdfOutlineSchema, pdfReadPagesSchema, pdfSearchSchema } from './toolSchemas'
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
  TName extends RuntimeToolName = RuntimeToolName,
  TToolsetId extends RuntimeToolsetId = 'pdf-read'
> = HumanToolSpec<TArgs, TName, TToolsetId>

export const PDF_OUTLINE_TOOL_SPEC: PdfToolSpec<
  z.infer<typeof pdfOutlineSchema>,
  'pdf_outline',
  'pdf-read'
> = {
  name: 'pdf_outline',
  familyId: 'pdf',
  toolsetIds: ['pdf-read'],
  promptSpec: {
    name: 'pdf_outline',
    description: '返回 PDF 页数、文档元数据与书签提纲。'
  },
  inputSchema: pdfOutlineSchema,
  resolveExecutionMeta: PDF_READ_EXECUTION_META,
  modelResult: { renderSuccess: renderPdfOutlineModelResult }
}

export const PDF_SEARCH_TOOL_SPEC: PdfToolSpec<
  z.infer<typeof pdfSearchSchema>,
  'pdf_search',
  'pdf-read'
> = {
  name: 'pdf_search',
  familyId: 'pdf',
  toolsetIds: ['pdf-read'],
  promptSpec: {
    name: 'pdf_search',
    description: '在 PDF 文本层中按文字或正则搜索。'
  },
  inputSchema: pdfSearchSchema,
  resolveExecutionMeta: PDF_READ_EXECUTION_META,
  modelResult: { renderSuccess: renderPdfSearchModelResult }
}

export const PDF_READ_PAGES_TOOL_SPEC: PdfToolSpec<
  z.infer<typeof pdfReadPagesSchema>,
  'pdf_read_pages',
  'pdf-read'
> = {
  name: 'pdf_read_pages',
  familyId: 'pdf',
  toolsetIds: ['pdf-read'],
  promptSpec: {
    name: 'pdf_read_pages',
    description: '按页码读取 PDF 文本层与页面信息。'
  },
  inputSchema: pdfReadPagesSchema,
  resolveExecutionMeta: PDF_READ_EXECUTION_META,
  modelResult: { renderSuccess: renderPdfReadPagesModelResult }
}

export const PDF_TOOL_SPECS = [
  PDF_OUTLINE_TOOL_SPEC,
  PDF_SEARCH_TOOL_SPEC,
  PDF_READ_PAGES_TOOL_SPEC
] as const
