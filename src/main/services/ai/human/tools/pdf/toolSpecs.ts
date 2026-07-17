import type { z } from 'zod/v4'
import type { JsonObject } from '../../../../../../shared/types'
import type { RuntimeSkillId } from '../../types'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver, readStringArg } from '../utils/toolSpecUtils'
import {
  pdfInspectOutputSchema,
  pdfReadPagesOutputSchema,
  pdfRenderPagesOutputSchema,
  pdfSearchOutputSchema
} from './outputSchemas'
import {
  pdfInspectSchema,
  pdfReadPagesSchema,
  pdfRenderPagesSchema,
  pdfSearchSchema
} from './schemas'

const PDF_READ_EXECUTION_META = createStaticExecutionMetaResolver({
  mutability: 'read_only',
  getResourceKey: (args) => readStringArg(args, 'sourcePath'),
  defaultResourceKey: 'pdf'
})

type PdfToolSpec<
  TArgs extends JsonObject = JsonObject,
  TOutput extends JsonObject = JsonObject,
  TName extends string = string,
  TSkillId extends RuntimeSkillId = 'pdf-read'
> = HumanToolSpec<TArgs, TOutput, TName, TSkillId>

const PDF_SOURCE_PATH_EXAMPLE = '学习笔记/深度学习.pdf'

export const PDF_INSPECT_TOOL_SPEC: PdfToolSpec<
  z.infer<typeof pdfInspectSchema>,
  z.infer<typeof pdfInspectOutputSchema>,
  'pdf_inspect',
  'pdf-read'
> = {
  name: 'pdf_inspect',
  familyId: 'pdf',
  skillIds: ['pdf-read'],
  requiresWorkspace: true,
  promptSpec: {
    name: 'pdf_inspect',
    description:
      '能力：读取指定 PDF 的基础信息。\n结果：返回页数、元数据、书签提纲和警告。\n边界：只检查 PDF，不返回各页正文，不修改源文件。',
    whenToUse: '适用于需要先了解 PDF 页数、元数据或目录结构的任务。',
    examples: [
      {
        goal: '先查看 PDF 的页数、标题和目录结构',
        args: { sourcePath: PDF_SOURCE_PATH_EXAMPLE }
      }
    ]
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
  requiresWorkspace: true,
  promptSpec: {
    name: 'pdf_search',
    description:
      '能力：在指定 PDF 的文本层中按 literal 或 regex 搜索，可限制页码范围和返回数量。\n结果：返回命中页码、匹配文本、上下文片段、位置和文本层状态统计。\n边界：只搜索 PDF 文本层；扫描图片中的文字不会自动识别。',
    whenToUse: '适用于需要在 PDF 正文中定位关键词或表达式的任务。',
    examples: [
      {
        goal: '按原词定位 PDF 中讨论过度拟合的页面',
        args: { sourcePath: PDF_SOURCE_PATH_EXAMPLE, query: '过度拟合' }
      },
      {
        goal: '用正则匹配 PDF 文本层中空格可能变化的英文术语',
        args: { sourcePath: PDF_SOURCE_PATH_EXAMPLE, query: 'Proper\\s+fit', mode: 'regex' }
      }
    ]
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
  requiresWorkspace: true,
  promptSpec: {
    name: 'pdf_read_pages',
    description:
      '能力：按连续页码范围或指定页码集合读取指定 PDF 的文本层。\n结果：逐页返回正文、页码、文本状态、图片数量、页面尺寸和警告。\n边界：不理解页面图片；空文本或可疑文本会明确标记，不修改源文件。',
    whenToUse: '适用于需要精读 PDF 某一页或连续页码范围正文的任务。',
    examples: [
      {
        goal: '连续读取 PDF 前三页正文',
        args: {
          sourcePath: PDF_SOURCE_PATH_EXAMPLE,
          selection: { type: 'page_range', fromPage: 1, toPage: 3 }
        }
      },
      {
        goal: '只读取任务明确关心的第 1 页和第 9 页',
        args: {
          sourcePath: PDF_SOURCE_PATH_EXAMPLE,
          selection: { type: 'page_numbers', pageNumbers: [1, 9] }
        }
      }
    ]
  },
  inputSchema: pdfReadPagesSchema,
  outputSchema: pdfReadPagesOutputSchema,
  resolveExecutionMeta: PDF_READ_EXECUTION_META
}

export const PDF_RENDER_PAGES_TOOL_SPEC: PdfToolSpec<
  z.infer<typeof pdfRenderPagesSchema>,
  z.infer<typeof pdfRenderPagesOutputSchema>,
  'pdf_render_pages',
  'pdf-read'
> = {
  name: 'pdf_render_pages',
  familyId: 'pdf',
  skillIds: ['pdf-read'],
  requiresWorkspace: true,
  promptSpec: {
    name: 'pdf_render_pages',
    description:
      '能力：将指定 PDF 的页面渲染为 PNG 图片。\n结果：返回每页的页码、图片路径、格式和尺寸。\n边界：只生成页面图片，不识别或解释图片内容，不修改源文件。',
    whenToUse: '适用于 PDF 文本层不足以回答问题，需要查看页面图形或把页面交给图像识别工具的任务。',
    examples: [
      {
        goal: '把包含对比曲线的第 9 页渲染成图片，供后续图像识别',
        args: { sourcePath: PDF_SOURCE_PATH_EXAMPLE, pageNumbers: [9] }
      }
    ]
  },
  inputSchema: pdfRenderPagesSchema,
  outputSchema: pdfRenderPagesOutputSchema,
  resolveExecutionMeta: PDF_READ_EXECUTION_META
}

export const PDF_TOOL_SPECS = [
  PDF_INSPECT_TOOL_SPEC,
  PDF_SEARCH_TOOL_SPEC,
  PDF_READ_PAGES_TOOL_SPEC,
  PDF_RENDER_PAGES_TOOL_SPEC
] as const
