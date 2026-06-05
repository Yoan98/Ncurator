import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import AssistantTurnCard from '../../../src/renderer/src/components/workbench/AssistantTurnCard'
import type { AssistantTurnViewModel } from '../../../src/renderer/src/components/workbench/types'

vi.mock('../../../src/renderer/src/components/MarkdownRenderer', () => ({
  default: ({ content }: { content: string }) => (
    <div data-testid="mock-markdown-renderer">{content}</div>
  )
}))

const createTurn = (overrides: Partial<AssistantTurnViewModel> = {}): AssistantTurnViewModel => ({
  messageId: 'assistant-1',
  status: 'running',
  processItems: [
    {
      id: 'assistant-1:thinking',
      nodeKind: 'brain',
      variant: 'brain_placeholder',
      text: '让俺想下',
      status: 'active',
      isCurrent: true,
      createdAt: 1,
      sourceEventType: 'thinking',
      iconKind: 'brain',
      details: []
    }
  ],
  finalAnswerMarkdown: '',
  artifacts: [],
  applyTargets: [],
  blockers: [],
  ...overrides
})

describe('AssistantTurnCard', () => {
  it('shows thinking placeholder before final answer', () => {
    render(
      <AssistantTurnCard
        messageId="assistant-1"
        turn={createTurn()}
        isStreaming
        onOpenFile={vi.fn()}
        onOpenApply={vi.fn()}
      />
    )

    expect(screen.getByText('让俺想下')).toBeTruthy()
    expect(screen.queryByTestId('workbench-assistant-final-answer-assistant-1')).toBeNull()
  })

  it('renders search placeholder with the same streaming surface before final text', () => {
    render(
      <AssistantTurnCard
        messageId="assistant-search-1"
        turn={createTurn({
          messageId: 'assistant-search-1',
          processItems: [
            {
              id: 'assistant-search-1:thinking',
              nodeKind: 'search',
              variant: 'search_placeholder',
              text: '让俺找找',
              status: 'active',
              isCurrent: true,
              createdAt: 1,
              sourceEventType: 'thinking',
              iconKind: 'search',
              details: []
            }
          ]
        })}
        isStreaming
        onOpenFile={vi.fn()}
        onOpenApply={vi.fn()}
      />
    )

    expect(screen.getByText('让俺找找')).toBeTruthy()
    expect(screen.queryByTestId('workbench-assistant-final-answer-assistant-search-1')).toBeNull()
  })

  it('renders markdown final answer below process stream', () => {
    render(
      <AssistantTurnCard
        messageId="assistant-1"
        turn={createTurn({
          status: 'completed',
          processItems: [
            {
              id: 'assistant-1:step',
              nodeKind: 'brain',
              variant: 'brain_thought',
              text: '俺在整理最后的回答',
              status: 'completed',
              isCurrent: false,
              createdAt: 1,
              sourceEventType: 'human_step',
              iconKind: 'brain',
              details: []
            }
          ],
          finalAnswerMarkdown: '## 最终结果\n\n- 已完成'
        })}
        onOpenFile={vi.fn()}
        onOpenApply={vi.fn()}
      />
    )

    const process = screen.getByTestId('workbench-assistant-process-assistant-1')
    const finalAnswer = screen.getByTestId('workbench-assistant-final-answer-assistant-1')
    expect(
      process.compareDocumentPosition(finalAnswer) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(screen.getByTestId('mock-markdown-renderer').textContent).toContain('## 最终结果')
    expect(screen.getByTestId('mock-markdown-renderer').textContent).toContain('- 已完成')
    expect(finalAnswer.className).not.toContain('bg-white')
    expect(finalAnswer.className).not.toContain('rounded')
    expect(process.className).not.toContain('bg-')
  })

  it('renders tool process rows with compact expandable details', () => {
    render(
      <AssistantTurnCard
        messageId="assistant-1"
        turn={createTurn({
          processItems: [
            {
              id: 'tool-1',
              nodeKind: 'hand',
              variant: 'hand_tool',
              toolName: 'kb_search',
              text: '俺正在搜索知识库线索',
              details: [
                { label: '查询词', value: 'langchain' },
                { label: '策略', value: 'auto' }
              ],
              status: 'active',
              isCurrent: true,
              createdAt: 1,
              sourceEventType: 'tool_call_started',
              iconKind: 'search-doc'
            }
          ]
        })}
        isStreaming
        onOpenFile={vi.fn()}
        onOpenApply={vi.fn()}
      />
    )

    expect(screen.getByText('俺正在搜索知识库线索')).toBeTruthy()
    expect(screen.getByText('查询词')).toBeTruthy()
    expect(screen.getByText('langchain')).toBeTruthy()
    expect(screen.queryByText('这一步处理完了')).toBeNull()
  })
})
