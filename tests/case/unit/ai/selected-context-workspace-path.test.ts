import { describe, expect, it } from 'vitest'
import {
  buildReferenceScope,
  renderReferenceScopeText
} from '../../../../src/main/services/ai/prompts/referenceScope'

describe('ai unit selected context workspace path', () => {
  it('renders workspace rootPath instead of workspaceName in reference scope text', () => {
    const text = renderReferenceScopeText(
      buildReferenceScope({
        workspace: {
          workspaceId: 'workspace-1',
          workspaceName: 'display-name-only',
          rootPath: '/tmp/real-workspace-root'
        },
        selectedReferences: []
      })
    )

    expect(text).toContain('工作区：')
    expect(text).toContain('- 根目录：/tmp/real-workspace-root')
    expect(text).not.toContain('display-name-only')
  })

  it('renders selected references and direct kb narrowing pairs when user explicitly selected inputs', () => {
    const text = renderReferenceScopeText(
      buildReferenceScope({
        workspace: {
          workspaceId: 'workspace-1',
          workspaceName: 'display-name-only',
          rootPath: '/tmp/real-workspace-root'
        },
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
    expect(text).toContain('类型：本地文件')
    expect(text).toContain('资源地址：reports/weekly-risk.md')
    expect(text).toContain('文档知识库状态：已索引')
    expect(text).toContain('知识库文档ID：doc-1')
  })

  it('renders user selected attachments with compact content-info template', () => {
    const text = renderReferenceScopeText(
      buildReferenceScope({
        workspace: {
          workspaceId: 'workspace-1',
          workspaceName: 'display-name-only',
          rootPath: '/tmp/real-workspace-root'
        },
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

    expect(text).toContain('用户添加的附件：')
    expect(text).toContain('第 1 个附件：screen.png')
    expect(text).toContain('- 路径：/tmp/screen.png')
    expect(text).toContain('第 2 个附件：README.md')
    expect(text).toContain('- 路径：/tmp/README.md')
    expect(text).not.toContain('来源：')
    expect(text).not.toContain('类型：图片')
    expect(text).not.toContain('格式：')
    expect(text).not.toContain('大小：')
    expect(text).not.toContain('内容信息')
  })
})
