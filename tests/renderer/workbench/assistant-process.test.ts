import { describe, expect, it } from 'vitest'
import type { AiRunEvent } from '../../../src/shared/types'
import {
  buildAssistantProcessText,
  createAssistantProcessItem,
  reduceAssistantProcessItems
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

    expect(buildAssistantProcessText(docxEvent)).toBe('俺正在编辑文档')
    expect(buildAssistantProcessText(terminalEvent)).toBe('俺正在跑指令')
    expect(buildAssistantProcessText(docxEvent)).not.toContain('docx_edit')
    expect(buildAssistantProcessText(terminalEvent)).not.toContain('terminal_run')
  })

  it('merges tool start and result into one process row without completion filler text', () => {
    const started: AiRunEvent = {
      ...baseEvent,
      type: 'tool_call_started',
      toolCallId: 'tool-1',
      toolName: 'kb_search',
      input: {
        queryText: 'langchain',
        strategy: 'auto'
      },
      createdAt: 1
    }
    const completed: AiRunEvent = {
      ...baseEvent,
      type: 'tool_call_result',
      toolCallId: 'tool-1',
      toolName: 'kb_search',
      result: {
        toolName: 'kb_search',
        ok: true,
        data: []
      },
      completedAt: 2
    }

    const startedItem = createAssistantProcessItem(started)
    const completedItem = createAssistantProcessItem(completed)

    expect(startedItem).toMatchObject({
      id: 'tool-1',
      nodeKind: 'hand',
      variant: 'hand_tool',
      toolName: 'kb_search',
      text: '俺正在搜索知识库线索',
      status: 'active',
      isCurrent: true,
      details: [
        { label: '查询词', value: 'langchain' },
        { label: '策略', value: 'auto' }
      ]
    })
    expect(completedItem).toMatchObject({
      id: 'tool-1',
      nodeKind: 'hand',
      text: '已完成搜索知识库线索',
      status: 'completed'
    })
    expect(completedItem?.text).not.toBe('这一步处理完了')
    expect(reduceAssistantProcessItems([startedItem!], completed)).toMatchObject([
      {
        id: 'tool-1',
        text: '已完成搜索知识库线索',
        status: 'completed',
        isCurrent: false
      },
      {
        nodeKind: 'brain',
        variant: 'brain_placeholder',
        text: '让俺想想',
        status: 'active',
        isCurrent: true
      }
    ])
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
      text: '让俺整理下，东西太多',
      status: 'active',
      sourceEventType: 'context_compaction_started'
    })
    expect(createAssistantProcessItem(completed)).toMatchObject({
      text: '已整理好上下文',
      status: 'completed',
      sourceEventType: 'context_compaction_completed'
    })
  })
})
