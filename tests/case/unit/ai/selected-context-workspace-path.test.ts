import { describe, expect, it } from 'vitest'
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

    expect(text).toContain('1. weekly-risk.md')
    expect(text).not.toContain('类型：')
    expect(text).toContain('引用范围：整个资源')
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
