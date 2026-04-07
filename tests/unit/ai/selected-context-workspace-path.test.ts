import { describe, expect, it } from 'vitest'
import {
  buildReferenceScope,
  renderReferenceScopeText
} from '../../../src/main/services/ai/prompts/referenceScope'

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

    expect(text).toContain('当前工作区绝对路径：/tmp/real-workspace-root')
    expect(text).toContain(
      '后续所有本地文件路径、cwd 与生成产物路径，都必须位于该工作区内；未显式指定 cwd 时，默认从该工作区根目录开始。'
    )
    expect(text).toContain('默认可用资料范围：')
    expect(text).toContain('当前用户未显式指定优先参考资料。')
    expect(text).toContain('当前应先使用默认范围，而不要把这理解成无资料可查。')
    expect(text).toContain('当前没有可直接缩圈的 kbDocumentIds。')
    expect(text).toContain('不表示默认知识库范围不可用。')
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

    expect(text).toContain('优先参考资料：')
    expect(text).toContain('[本地文件] reports/weekly-risk.md')
    expect(text).toContain('知识库可用性：已索引')
    expect(text).toContain('当前已选参考资料对应的 kbDocumentIds：')
    expect(text).toContain('[本地文件] weekly-risk.md -> [doc-1]')
  })
})
