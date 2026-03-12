import React from 'react'
import type { DraftDocumentFormat } from '../../../../../shared/types'
import DocxDraftDiffRenderer from './DocxDraftDiffRenderer'
import PlaceholderDraftDiffRenderer from './PlaceholderDraftDiffRenderer'
import type { DraftDiffRendererProps, DraftDiffRendererRegistration } from './types'

const MarkdownDraftDiffRenderer: React.FC<DraftDiffRendererProps> = (props) => (
  <PlaceholderDraftDiffRenderer
    {...props}
    title="Markdown / 文本差异"
    description="文本类格式会复用统一 hunk 审阅容器，这一轮先预留注册位。"
  />
)

const SpreadsheetDraftDiffRenderer: React.FC<DraftDiffRendererProps> = (props) => (
  <PlaceholderDraftDiffRenderer
    {...props}
    title="表格差异"
    description="XLSX 会按单元格或区域适配差异渲染器，这一轮先保留注册入口。"
  />
)

const PresentationDraftDiffRenderer: React.FC<DraftDiffRendererProps> = (props) => (
  <PlaceholderDraftDiffRenderer
    {...props}
    title="演示文稿差异"
    description="PPTX 会按 slide 或 shape 渲染变更，这一轮先保留审阅接口。"
  />
)

const PdfDraftDiffRenderer: React.FC<DraftDiffRendererProps> = (props) => (
  <PlaceholderDraftDiffRenderer
    {...props}
    title="PDF 预览差异"
    description="PDF 不承诺稳定块级编辑；后续会优先支持批注或导出新文件。"
  />
)

const registry: Record<DraftDocumentFormat, DraftDiffRendererRegistration> = {
  docx: {
    format: 'docx',
    label: 'Word 文档',
    component: DocxDraftDiffRenderer
  },
  md: {
    format: 'md',
    label: 'Markdown',
    component: MarkdownDraftDiffRenderer
  },
  txt: {
    format: 'txt',
    label: '纯文本',
    component: MarkdownDraftDiffRenderer
  },
  xlsx: {
    format: 'xlsx',
    label: 'Excel 表格',
    component: SpreadsheetDraftDiffRenderer
  },
  pptx: {
    format: 'pptx',
    label: 'PowerPoint',
    component: PresentationDraftDiffRenderer
  },
  pdf: {
    format: 'pdf',
    label: 'PDF',
    component: PdfDraftDiffRenderer
  }
}

export const getDraftDiffRenderer = (format: DraftDocumentFormat): DraftDiffRendererRegistration => {
  return registry[format]
}

export type { DraftDiffRendererProps, DraftDiffRendererRegistration } from './types'
