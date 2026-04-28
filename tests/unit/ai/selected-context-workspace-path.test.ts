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

    expect(text).toContain('[本地文件] reports/weekly-risk.md')
    expect(text).toContain('知识库可用性：已索引')
    expect(text).toContain('[本地文件] weekly-risk.md -> [doc-1]')
  })
})
