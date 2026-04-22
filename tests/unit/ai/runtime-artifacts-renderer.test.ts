import { describe, expect, it } from 'vitest'
import { createInitialHumanState } from '../../../src/main/services/ai/human/state/schema'
import { renderHumanArtifactLines } from '../../../src/main/services/ai/human/shared/runtimeRenderers'

describe('ai unit runtime artifacts renderer', () => {
  it('renders changed files in prompt mode', () => {
    const state = createInitialHumanState({
      taskId: 'task-runtime-1',
      userInput: '整理文档'
    })
    state.execution.runtimeArtifacts = {
      changed_files: [
        {
          file_name: 'sample.docx',
          source_path: '/workspace/sample.docx',
          format: 'docx',
          change_count: 2,
          summary: '补充了课堂说明',
          change_highlights: ['补充交互设计说明', '新增总结表'],
          draft_artifact_path: '/workspace/.ncurator/file-reviews/review-1/draft-sample.docx'
        }
      ]
    }

    const rendered = renderHumanArtifactLines(state, 'prompt')

    expect(rendered).toContain('文件：sample.docx')
    expect(rendered).toContain('改动数：2')
    expect(rendered).toContain('补充交互设计说明')
    expect(rendered).toContain('待确认稿：/workspace/.ncurator/file-reviews/review-1/draft-sample.docx')
  })

  it('renders empty fallback when no changed files exist', () => {
    const state = createInitialHumanState({
      taskId: 'task-runtime-2',
      userInput: '整理文档'
    })

    const rendered = renderHumanArtifactLines(state, 'prompt')

    expect(rendered).toContain('本次运行未形成新的文件改动结果。')
    expect(rendered).not.toContain('draft review')
  })
})
