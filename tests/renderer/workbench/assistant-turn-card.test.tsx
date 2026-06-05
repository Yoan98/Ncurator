import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import AssistantTurnCard from '../../../src/renderer/src/components/workbench/AssistantTurnCard'
import type {
  AssistantProcessGroup,
  AssistantTurnViewModel
} from '../../../src/renderer/src/components/workbench/types'
import {
  createAssistantThinkingGroup,
  createSearchProcessGroup
} from '../../../src/renderer/src/components/workbench/utils'

vi.mock('../../../src/renderer/src/components/MarkdownRenderer', () => ({
  default: ({ content }: { content: string }) => (
    <div data-testid="mock-markdown-renderer">{content}</div>
  )
}))

const createTurn = (overrides: Partial<AssistantTurnViewModel> = {}): AssistantTurnViewModel => ({
  messageId: 'assistant-1',
  status: 'running',
  processThoughts: [],
  processGroups: [createAssistantThinkingGroup('assistant-1')],
  finalAnswerMarkdown: '',
  artifacts: [],
  applyTargets: [],
  blockers: [],
  ...overrides
})

const createToolGroup = (): AssistantProcessGroup => ({
  id: 'run-1:skill:docx-reader',
  kind: 'skill',
  skillKey: 'docx-reader',
  iconKind: 'document',
  status: 'running',
  runningText: [{ text: '俺正在阅读 ' }, { text: 'docx', emphasis: true }],
  completedText: [{ text: '俺已阅读完 ' }, { text: 'docx', emphasis: true }],
  failedText: [{ text: '阅读 ' }, { text: 'docx', emphasis: true }, { text: ' 失败了' }],
  createdAt: 1,
  sourceEventType: 'tool_call_started',
  items: [
    {
      id: 'tool-1',
      toolName: 'docx_outline',
      status: 'running',
      runningText: [
        { text: '正在阅读 ' },
        { text: '/tmp/report.docx', emphasis: true },
        { text: ' 文件的结构' }
      ],
      completedText: [
        { text: '已阅读 ' },
        { text: '/tmp/report.docx', emphasis: true },
        { text: ' 文件的结构' }
      ],
      failedText: [
        { text: '阅读 ' },
        { text: '/tmp/report.docx', emphasis: true },
        { text: ' 文件的结构失败了' }
      ],
      createdAt: 1,
      sourceEventType: 'tool_call_started'
    }
  ]
})

describe('AssistantTurnCard', () => {
  it('shows thinking placeholder before final answer without process dots', () => {
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
    expect(document.querySelector('.rounded-full.bg-\\[\\#D97757\\]')).toBeNull()
  })

  it('renders search placeholder as reference-reader group', () => {
    render(
      <AssistantTurnCard
        messageId="assistant-search-1"
        turn={createTurn({
          messageId: 'assistant-search-1',
          processGroups: [createSearchProcessGroup('assistant-search-1')]
        })}
        isStreaming
        onOpenFile={vi.fn()}
        onOpenApply={vi.fn()}
      />
    )

    expect(screen.getByText('俺正在查阅资料')).toBeTruthy()
    expect(screen.queryByTestId('workbench-assistant-final-answer-assistant-search-1')).toBeNull()
  })

  it('renders markdown final answer below process stream', () => {
    render(
      <AssistantTurnCard
        messageId="assistant-1"
        turn={createTurn({
          status: 'completed',
          processGroups: [createToolGroup()],
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
    expect(finalAnswer.className).not.toContain('bg-white')
    expect(process.className).not.toContain('bg-')
  })

  it('renders public thought text above skill and tool process groups', () => {
    render(
      <AssistantTurnCard
        messageId="assistant-1"
        turn={createTurn({
          processThoughts: [
            {
              id: 'thought-1',
              text: '俺先看一下文档结构，再决定读哪些细节。',
              createdAt: 1,
              sourceEventType: 'assistant_process_thought'
            }
          ],
          processGroups: [createToolGroup()]
        })}
        isStreaming
        onOpenFile={vi.fn()}
        onOpenApply={vi.fn()}
      />
    )

    const thoughts = screen.getByTestId('workbench-assistant-thoughts')
    const processGroup = screen.getByTestId('workbench-assistant-process-item-run-1:skill:docx-reader')
    expect(screen.getByText('俺先看一下文档结构，再决定读哪些细节。')).toBeTruthy()
    expect(
      thoughts.compareDocumentPosition(processGroup) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('renders tool group with emphasized file name in expanded tool sentence', () => {
    render(
      <AssistantTurnCard
        messageId="assistant-1"
        turn={createTurn({
          processGroups: [createToolGroup()]
        })}
        isStreaming
        onOpenFile={vi.fn()}
        onOpenApply={vi.fn()}
      />
    )

    expect(screen.getByText('俺正在阅读')).toBeTruthy()
    const fileName = screen.getByText('/tmp/report.docx')
    expect(fileName.className).toContain('font-semibold')
    expect(screen.getByText('文件的结构')).toBeTruthy()
    expect(screen.queryByText('这一步处理完了')).toBeNull()
  })
})
