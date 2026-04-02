import { describe, expect, it } from 'vitest'
import { buildSelectedContextText } from '../../../src/main/services/ai/utils/runContext'

describe('ai unit selected context workspace path', () => {
  it('renders workspace rootPath instead of workspaceName in selected context', () => {
    const text = buildSelectedContextText({
      workspace: {
        workspaceId: 'workspace-1',
        workspaceName: 'display-name-only',
        rootPath: '/tmp/real-workspace-root'
      },
      selectedReferences: [],
      usesWorkspaceDefaultKbScope: true
    })

    expect(text).toContain('当前工作区绝对路径：/tmp/real-workspace-root')
    expect(text).toContain(
      '后续所有本地文件路径、cwd 与生成产物路径，都必须位于该工作区内；未显式指定 cwd 时，默认从该工作区根目录开始。'
    )
    expect(text).toContain(
      '当前用户没有指定任何目录、文件或网页资料；本轮默认使用当前工作区中已索引文件作为本地检索范围。'
    )
    expect(text).not.toContain('display-name-only')
  })

  it('renders a clearer selected references heading when user explicitly selected inputs', () => {
    const text = buildSelectedContextText({
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
      ],
      usesWorkspaceDefaultKbScope: false
    })

    expect(text).toContain('当前用户已指定以下参考资料：')
    expect(text).toContain('[本地文件] reports/weekly-risk.md')
    expect(text).toContain('知识库可用性：已索引')
  })
})
