import { describe, expect, it } from 'vitest'
import { selectionTooltip } from '../../../../src/shared/documentSelection'
import type { DocumentSelectionAnchor, DocumentSelectionNode } from '../../../../src/shared/types'
import {
  buildReferenceScope,
  renderAttachmentsText,
  renderSelectedReferencesText
} from '../../../../src/main/services/ai/human/prompts/referenceScope'

describe('ai unit selected context workspace path', () => {
  it('does not render empty reference scope placeholders', () => {
    const scope = buildReferenceScope({
      selectedReferences: []
    })
    const references = renderSelectedReferencesText(scope)
    const attachments = renderAttachmentsText(scope)

    expect(references).toBe('')
    expect(attachments).toBe('')
    expect(references).not.toContain('用户引用的文档：')
    expect(references).not.toContain('当前没有用户显式指定的参考范围')
    expect(attachments).not.toContain('用户添加的附件：')
    expect(attachments).not.toContain('当前没有用户添加的附件')
    expect(references).not.toContain('用户工作区域：')
    expect(references).not.toContain('根目录：')
    expect(references).not.toContain('默认应优先在此目录内完成用户任务')
    expect(references).not.toContain('cwd')
  })

  it('renders selected references and direct kb narrowing pairs when user explicitly selected inputs', () => {
    const text = renderSelectedReferencesText(
      buildReferenceScope({
        selectedReferences: [
          {
            kind: 'file',
            workspaceId: 'workspace-1',
            nodeId: 'node-1',
            name: 'weekly-risk.md',
            relativePath: 'reports/weekly-risk.md',
            absolutePath: '/tmp/real-workspace-root/reports/weekly-risk.md',
            kbAvailability: 'indexed',
            kbDocumentIds: ['doc-1']
          }
        ]
      })
    )

    expect(text).toContain('1. 文档：weekly-risk.md')
    expect(text).not.toContain('类型：')
    expect(text).toContain('引用内容：整个资源')
    expect(text).toContain('资源地址：/tmp/real-workspace-root/reports/weekly-risk.md')

    expect(
      renderSelectedReferencesText(
        buildReferenceScope({
          selectedReferences: [
            {
              kind: 'directory',
              workspaceId: 'workspace-1',
              nodeId: 'node-dir',
              name: 'reports',
              relativePath: 'reports',
              absolutePath: '/tmp/real-workspace-root/reports',
              kbAvailability: 'partial',
              kbDocumentIds: [],
              indexedFileCount: 1,
              notIndexedFileCount: 0
            },
            {
              kind: 'web',
              workspaceId: 'workspace-1',
              webSourceId: 'web-1',
              name: '内部规范',
              url: 'https://example.com/policy',
              kbAvailability: 'indexed',
              kbDocumentIds: ['doc-web']
            }
          ]
        })
      )
    ).toContain('资源地址：/tmp/real-workspace-root/reports')
    expect(
      renderSelectedReferencesText(
        buildReferenceScope({
          selectedReferences: [
            {
              kind: 'web',
              workspaceId: 'workspace-1',
              webSourceId: 'web-1',
              name: '内部规范',
              url: 'https://example.com/policy',
              kbAvailability: 'indexed',
              kbDocumentIds: ['doc-web']
            }
          ]
        })
      )
    ).toContain('资源地址：https://example.com/policy')
    expect(text).toContain('文档知识库状态：已索引')
    expect(text).toContain('知识库文档ID：doc-1')
    expect(text).not.toContain('用户添加的附件：')
    expect(text).not.toContain('当前没有用户添加的附件')
  })

  it('preserves whitespace and embedded fences inside separate numbered excerpt blocks', () => {
    const selectedText = '首行\n\n  \t单元格\t\n```text\n后文：这是原文\n```\n   '
    const contextBefore = '\n  前文\n'
    const contextAfter = '\t后文  '
    const text = renderSelectedReferencesText(
      buildReferenceScope({
        contentNodes: [
          {
            kind: 'document_selection',
            id: 'excerpt',
            number: 2,
            filePath: '/tmp/example.docx',
            selectedText,
            contextBefore,
            contextAfter,
            children: [{ kind: 'text', text: '解释' }]
          }
        ]
      })
    )
    expect(text.split('<用户选中片段2>')).toHaveLength(2)
    expect(text).toContain(`<选中内容>\n${selectedText}\n</选中内容>`)
    expect(text).toContain(
      `</选中内容>\n<定位信息>\n<选中内容的前文>\n${contextBefore}\n</选中内容的前文>\n<选中内容的后文>\n${contextAfter}\n</选中内容的后文>\n</定位信息>`
    )
    expect(text).not.toContain('不属于选中内容')
    expect(text).not.toContain('引用内容：')
    expect(text).not.toContain('选中片段2的')
    expect(text).not.toContain('[example.docx')
  })

  it('groups text excerpts by document, preserves differing source and omits empty blocks', () => {
    const text = renderSelectedReferencesText(
      buildReferenceScope({
        contentNodes: ['plain', 'before bold after'].map((selectedText, index) => ({
          kind: 'document_selection',
          id: `excerpt-${index}`,
          number: index + 1,
          filePath: '/tmp/example.md',
          selectedText,
          contextBefore: '',
          contextAfter: '',
          children: [],
          anchor: {
            kind: 'text',
            start: 0,
            end: selectedText.length,
            startLine: 1,
            endLine: 1,
            sourceText: index === 0 ? selectedText : 'before **bold** after'
          }
        }))
      })
    )
    expect(text.split('文档：example.md')).toHaveLength(2)
    expect(text.split('<用户选中片段1>')).toHaveLength(2)
    expect(text.split('<用户选中片段2>')).toHaveLength(2)
    expect(text).toContain('</用户选中片段1>\n<用户选中片段2>')
    expect(text.split('<源文件片段>')).toHaveLength(2)
    expect(text).toContain(
      '<定位信息>\n行号：第 1 行\n<源文件片段>\nbefore **bold** after\n</源文件片段>\n</定位信息>'
    )
    expect(text).not.toContain('<选中内容的前文>')
    expect(text).not.toContain('<选中内容的后文>')
  })

  const locationCases: {
    name: string
    filePath: string
    anchor?: DocumentSelectionAnchor
    selectedText: string
    location: string
    position: string
  }[] = [
    {
      name: 'DOCX without a format anchor',
      filePath: '/tmp/example.docx',
      selectedText: '选中原文',
      location: '',
      position: ''
    },
    {
      name: 'single text line',
      filePath: '/tmp/example.txt',
      anchor: { kind: 'text', start: 0, end: 4, startLine: 3, endLine: 3, sourceText: '选中原文' },
      selectedText: '选中原文',
      location: '位置：第 3 行',
      position: '行号：第 3 行'
    },
    {
      name: 'multiple text lines',
      filePath: '/tmp/example.txt',
      anchor: {
        kind: 'text',
        start: 0,
        end: 11,
        startLine: 3,
        endLine: 5,
        sourceText: '第一行\n第二行\n第三行'
      },
      selectedText: '第一行\n第二行\n第三行',
      location: '位置：第 3–5 行',
      position: '行号：第 3–5 行'
    },
    {
      name: 'single PDF page',
      filePath: '/tmp/example.pdf',
      anchor: { kind: 'pdf', startPage: 2, endPage: 2, start: 0, end: 4 },
      selectedText: '选中原文',
      location: '位置：第 2 页',
      position: '页码：第 2 页'
    },
    {
      name: 'multiple PDF pages',
      filePath: '/tmp/example.pdf',
      anchor: { kind: 'pdf', startPage: 2, endPage: 3, start: 0, end: 4 },
      selectedText: '选中原文',
      location: '位置：第 2–3 页',
      position: '页码：第 2–3 页'
    },
    {
      name: 'Excel cells',
      filePath: '/tmp/example.xlsx',
      anchor: {
        kind: 'excel',
        sheetId: 'sheet-1',
        sheetName: '订单明细',
        range: 'B2',
        startRow: 1,
        endRow: 1,
        startColumn: 1,
        endColumn: 1
      },
      selectedText:
        '{"display":[["订单"]],"cells":[[{"value":"订单","formula":null}]],"merges":[]}',
      location: '位置：订单明细!B2',
      position: '工作表：订单明细\n选中单元格范围：B2'
    },
    {
      name: 'PPT element with text',
      filePath: '/tmp/example.pptx',
      anchor: {
        kind: 'ppt',
        slideId: '/ppt/slides/slide1.xml',
        elementId: '/ppt/slides/slide1.xml#2',
        page: 1,
        mode: 'element',
        revision: 'revision-1'
      },
      selectedText: '完整标题',
      location: '位置：第 1 页\n选中元素：/ppt/slides/slide1.xml#2',
      position: '页码：第 1 页\n选中元素：/ppt/slides/slide1.xml#2'
    },
    {
      name: 'PPT element without text',
      filePath: '/tmp/example.pptx',
      anchor: {
        kind: 'ppt',
        slideId: '/ppt/slides/slide1.xml',
        elementId: '/ppt/slides/slide1.xml#3',
        page: 1,
        mode: 'element',
        revision: 'revision-1'
      },
      selectedText: '',
      location: '位置：第 1 页\n选中元素：/ppt/slides/slide1.xml#3',
      position: '页码：第 1 页\n选中元素：/ppt/slides/slide1.xml#3'
    },
    {
      name: 'PPT whole slide',
      filePath: '/tmp/example.pptx',
      anchor: {
        kind: 'ppt',
        slideId: '/ppt/slides/slide1.xml',
        page: 1,
        mode: 'slide',
        revision: 'revision-1'
      },
      selectedText: '页面文字',
      location: '位置：第 1 页\n选中页面：/ppt/slides/slide1.xml',
      position: '页码：第 1 页\n选中页面：/ppt/slides/slide1.xml'
    }
  ]

  it.each(locationCases)('renders $name locator and retains its tooltip snapshot', (example) => {
    const node: DocumentSelectionNode = {
      kind: 'document_selection',
      id: 'excerpt',
      number: 1,
      filePath: example.filePath,
      anchor: example.anchor,
      selectedText: example.selectedText,
      contextBefore: '',
      contextAfter: '',
      children: []
    }
    const text = renderSelectedReferencesText(buildReferenceScope({ contentNodes: [node] }))
    expect(text).toContain('知识库文档ID：无\n<用户选中片段1>')

    if (example.position) {
      expect(text).toContain(`<定位信息>\n${example.position}\n</定位信息>`)
    } else {
      expect(text).not.toContain('<定位信息>')
    }
    expect(selectionTooltip(node)).toBe(
      example.location
        ? `${example.location}${example.selectedText ? `\n${example.selectedText}` : ''}`
        : example.selectedText
    )
    const locatorOnly = example.anchor?.kind === 'ppt' || example.anchor?.kind === 'excel'
    if (example.selectedText && !locatorOnly) {
      expect(text).toContain(`<选中内容>\n${example.selectedText}\n</选中内容>`)
    } else {
      expect(text).not.toContain('<选中内容>')
      if (example.selectedText) expect(text).not.toContain(example.selectedText)
    }
    expect(text).not.toContain('<源文件片段>')
    expect(text).not.toContain('<选中内容的前文>')
    expect(text).not.toContain('<选中内容的后文>')
  })

  it('renders user selected attachments with compact content-info template', () => {
    const text = renderAttachmentsText(
      buildReferenceScope({
        selectedReferences: [],
        attachments: [
          {
            id: 'att-1',
            kind: 'image',
            name: 'screen.png',
            path: '/tmp/screen.png',
            status: 'ready'
          },
          {
            id: 'att-2',
            kind: 'file',
            name: 'README.md',
            path: '/tmp/README.md',
            status: 'ready'
          }
        ]
      })
    )

    expect(text).toContain('第 1 个附件路径：/tmp/screen.png')
    expect(text).toContain('第 2 个附件路径：/tmp/README.md')
    expect(text).not.toContain('第 1 个附件：screen.png')
    expect(text).not.toContain('- 路径：')
    expect(text).not.toContain('用户引用的文档：')
    expect(text).not.toContain('来源：')
    expect(text).not.toContain('类型：图片')
    expect(text).not.toContain('格式：')
    expect(text).not.toContain('大小：')
    expect(text).not.toContain('内容信息')
  })
})
