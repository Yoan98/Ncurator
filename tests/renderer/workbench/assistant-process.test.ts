import { describe, expect, it } from 'vitest'
import type { AiRunEvent } from '../../../src/shared/types'
import {
  buildAssistantProcessText,
  createAssistantProcessItem
} from '../../../src/renderer/src/components/workbench/utils'

const baseEvent = {
  runId: 'run-1',
  taskId: 'task-1'
}

describe('workbench assistant process narrative', () => {
  it('maps internal tool names to user-facing text', () => {
    const docxEvent: AiRunEvent = {
      ...baseEvent,
      type: 'tool_call_started',
      toolCallId: 'tool-1',
      toolName: 'docx_edit',
      input: {},
      createdAt: 1
    }
    const terminalEvent: AiRunEvent = {
      ...baseEvent,
      type: 'tool_call_started',
      toolCallId: 'tool-2',
      toolName: 'terminal_run',
      input: {},
      createdAt: 2
    }

    expect(buildAssistantProcessText(docxEvent)).toBe('俺正在写 docx 中')
    expect(buildAssistantProcessText(terminalEvent)).toBe('俺在跑命令呢，等等俺')
    expect(buildAssistantProcessText(docxEvent)).not.toContain('docx_edit')
    expect(buildAssistantProcessText(terminalEvent)).not.toContain('terminal_run')
  })

  it('maps context compaction to natural process text', () => {
    const started: AiRunEvent = {
      ...baseEvent,
      type: 'context_compaction_started',
      targetRoundIds: [1],
      budgetTokensBefore: 20000,
      thresholdTokens: 12000,
      createdAt: 3
    }
    const completed: AiRunEvent = {
      ...baseEvent,
      type: 'context_compaction_completed',
      compactBlockId: 'compact-1',
      sourceRoundIds: [1],
      tokenEstimateBefore: 20000,
      sourceHistoryTokenEstimate: 10000,
      tokenEstimateAfter: 9000,
      summaryPreview: 'summary',
      completedAt: 4
    }

    expect(createAssistantProcessItem(started)).toMatchObject({
      text: '内容有点多，俺先整理下上下文',
      status: 'running',
      sourceEventType: 'context_compaction_started'
    })
    expect(createAssistantProcessItem(completed)).toMatchObject({
      text: '上下文整理好了，俺继续',
      status: 'completed',
      sourceEventType: 'context_compaction_completed'
    })
  })
})
