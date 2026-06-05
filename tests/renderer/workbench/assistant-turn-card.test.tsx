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
      text: '让俺想想',
      status: 'running',
      createdAt: 1,
      sourceEventType: 'thinking'
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

    expect(screen.getByText('让俺想想')).toBeTruthy()
    expect(screen.queryByTestId('workbench-assistant-final-answer-assistant-1')).toBeNull()
  })

  it('renders markdown final answer below process stream', () => {
    render(
      <AssistantTurnCard
        messageId="assistant-1"
        turn={createTurn({
          status: 'completed',
          processItems: [
            {
              id: 'assistant-1:thinking',
              text: '让俺想想',
              status: 'completed',
              createdAt: 1,
              sourceEventType: 'thinking'
            },
            {
              id: 'assistant-1:answer-started',
              text: '俺想好了，开始说',
              status: 'completed',
              createdAt: 2,
              sourceEventType: 'answer_token'
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
  })
})
