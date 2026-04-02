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
    expect(text).not.toContain('display-name-only')
  })
})
