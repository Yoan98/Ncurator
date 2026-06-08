import { describe, expect, it } from 'vitest'
import { createInitialHumanState } from '../../../src/main/services/ai/human/state/schema'
import { renderHumanFileChangeLines } from '../../../src/main/services/ai/human/shared/runtimeRenderers'

describe('ai unit file changes renderer', () => {
  it('renders changed files in prompt mode', () => {
    const state = createInitialHumanState({
      taskId: 'task-runtime-1',
      userInput: '整理文档'
    })
    state.execution.fileChanges = {
      changed_files: [
        {
          id: 'change-sample',
          fileName: 'sample.docx',
          path: '/workspace/sample.docx',
          capability: 'docx',
          operation: 'updated',
          changeCount: 2,
          status: 'applied'
        }
      ]
    }

    const rendered = renderHumanFileChangeLines(state, 'prompt')

    expect(rendered).toContain('文件：sample.docx')
    expect(rendered).toContain('改动数：2')
    expect(rendered).toContain('文件路径：/workspace/sample.docx')
    expect(rendered).toContain('修改记录：change-sample')
  })

  it('renders empty fallback when no changed files exist', () => {
    const state = createInitialHumanState({
      taskId: 'task-runtime-2',
      userInput: '整理文档'
    })

    const rendered = renderHumanFileChangeLines(state, 'prompt')

    expect(rendered).toContain('本次运行未形成新的文件改动结果。')
    expect(rendered).not.toContain('AI 修改记录')
  })
})
