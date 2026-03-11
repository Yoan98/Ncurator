import React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChatPage from '../../../../src/renderer/src/pages/ChatPage'
import { chatSelectors } from '../../../../src/renderer/src/testing/selectors'
import type { AiRunEvent, ChatSession } from '../../../../src/shared/types'
import { createDesktopApiMock } from '../../../harness/renderer/apiMock'
import { runRendererCase } from '../../../harness/renderer/case'
import type { UiAssertion } from '../../../harness/e2e/reporter'
import { replayAiRunEvents } from '../../../harness/renderer/eventPlayer'
import { renderWithDesktopApi } from '../../../harness/renderer/renderPage'

const session: ChatSession = {
  id: 'session-1',
  title: '测试会话',
  created_at: 1
}

const startRun = async (): Promise<ReturnType<typeof createDesktopApiMock>> => {
  const apiMock = createDesktopApiMock({
    sessions: [session]
  })
  const user = userEvent.setup()
  renderWithDesktopApi({
    apiMock,
    ui: <ChatPage />
  })

  await screen.findByText('测试会话')
  fireEvent.change(screen.getByTestId(chatSelectors.input), {
    target: { value: '测试右侧面板' }
  })
  await user.click(screen.getByTestId(chatSelectors.sendButton))
  await waitFor(() => {
    expect(apiMock.calls.aiRunStart).toHaveLength(1)
  })

  return apiMock
}

describe('chat.right-panel-events', () => {
  it('renders retrieval, tool output, terminal, and artifact payloads in the right panel', async () => {
    const userActionSequence: string[] = []
    const selectorFailures: string[] = []
    const assertions: UiAssertion[] = []
    const notes: string[] = []
    const apiMock = await startRun()

    const retrievalEvent: AiRunEvent = {
      type: 'tool_call_result',
      runId: 'run-test-1',
      taskId: 'task-1',
      toolCallId: 'tool-1',
      toolName: 'kb_hybrid_search_chunks',
      outputPreview: [
        {
          id: 'chunk-1',
          text: '命中文本',
          document_name: '文档A'
        }
      ],
      createdAt: Date.now()
    }
    const docsEvent: AiRunEvent = {
      type: 'tool_call_result',
      runId: 'run-test-1',
      taskId: 'task-1',
      toolCallId: 'tool-2',
      toolName: 'kb_list_documents',
      outputPreview: [
        {
          id: 'doc-1',
          name: '文档B',
          source_type: 'file',
          created_at: Date.now(),
          import_status: 1
        }
      ],
      createdAt: Date.now()
    }
    const toolOutputEvent: AiRunEvent = {
      type: 'tool_call_result',
      runId: 'run-test-1',
      taskId: 'task-1',
      toolCallId: 'tool-3',
      toolName: 'docx_apply_ops',
      outputPreview: {
        code: 'ok',
        summary: 'done'
      },
      createdAt: Date.now()
    }
    const terminalEvent: AiRunEvent = {
      type: 'terminal_step_result',
      runId: 'run-test-1',
      taskId: 'task-1',
      stepId: 'step-1',
      stepIndex: 1,
      command: 'echo ok',
      outputPreview: 'ok',
      createdAt: Date.now()
    }
    const artifactEvent: AiRunEvent = {
      type: 'file_artifact',
      runId: 'run-test-1',
      taskId: 'task-1',
      artifactId: 'artifact-1',
      capability: 'docx',
      path: '/tmp/result.docx',
      fileName: 'result.docx',
      operation: 'created',
      summary: '生成文档',
      createdAt: Date.now()
    }

    await runRendererCase({
      suite: 'renderer-chat-contract',
      caseId: 'chat-right-panel-events',
      apiMock,
      userActionSequence,
      selectorFailures,
      assertions,
      notes,
      route: '#/',
      expectedOutcome: 'success',
      scenarioTags: ['renderer', 'chat', 'right-panel'],
      taskGoal: 'Validate Chat right-panel mappings for retrieval, docs, tool output, terminal, and artifact events.',
      body: async () => {
        await replayAiRunEvents({
          mock: apiMock,
          events: [retrievalEvent]
        })
        userActionSequence.push('event:tool_call_result:kb_hybrid_search_chunks')
        await waitFor(() => {
          expect(screen.getByTestId(chatSelectors.rightPanelTitle).textContent).toContain('检索结果')
        })
        expect(screen.getByTestId(chatSelectors.rightPanelChunks).textContent).toContain('命中文本')
        assertions.push({ id: 'right-panel-retrieval-rendered', pass: true })

        await replayAiRunEvents({
          mock: apiMock,
          events: [docsEvent]
        })
        userActionSequence.push('event:tool_call_result:kb_list_documents')
        await waitFor(() => {
          expect(screen.getByTestId(chatSelectors.rightPanelTitle).textContent).toContain('文档列表')
        })
        expect(screen.getByTestId(chatSelectors.rightPanelDocs).textContent).toContain('文档B')
        assertions.push({ id: 'right-panel-docs-rendered', pass: true })

        await replayAiRunEvents({
          mock: apiMock,
          events: [toolOutputEvent]
        })
        userActionSequence.push('event:tool_call_result:docx_apply_ops')
        await waitFor(() => {
          expect(screen.getByTestId(chatSelectors.rightPanelTitle).textContent).toContain('工具输出')
          expect(screen.getByTestId(chatSelectors.rightPanelTitle).textContent).toContain('docx_apply_ops')
        })
        expect(screen.getByTestId(chatSelectors.rightPanelJson).textContent).toContain('"summary":"done"')
        assertions.push({ id: 'right-panel-json-rendered', pass: true })

        await replayAiRunEvents({
          mock: apiMock,
          events: [terminalEvent]
        })
        userActionSequence.push('event:terminal_step_result')
        await waitFor(() => {
          expect(screen.getByTestId(chatSelectors.rightPanelTitle).textContent).toContain('终端步骤')
        })
        assertions.push({ id: 'right-panel-terminal-rendered', pass: true })

        await replayAiRunEvents({
          mock: apiMock,
          events: [artifactEvent]
        })
        userActionSequence.push('event:file_artifact')
        await waitFor(() => {
          expect(screen.getByTestId(chatSelectors.rightPanelTitle).textContent).toContain('文件产物')
        })
        expect(screen.getByTestId(chatSelectors.rightPanelArtifacts).textContent).toContain('result.docx')
        assertions.push({ id: 'right-panel-artifact-rendered', pass: true })
      }
    })
  })
})
