import React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChatPage from '../../../../src/renderer/src/pages/ChatPage'
import { workbenchSelectors } from '../../../../src/renderer/src/testing/selectors'
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

const CASE_METADATA = {
  description: '验证统一工作台时间线和检查器能正确映射 plan、检索、产物和草稿审阅事件。',
  taskGoal:
    'Validate the unified workbench timeline and inspector mappings for plan, retrieval, artifact, and draft review events.',
  scenarioTags: ['renderer', 'chat', 'workbench', 'timeline'],
  expectedOutcome: 'success',
  requiredFixtures: [],
  retentionTier: 'canonical',
  lifecycle: 'active',
  runPolicy: 'gating',
  capabilityArea: 'chat-ui'
} as const

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
  fireEvent.change(screen.getByTestId(workbenchSelectors.input), {
    target: { value: '测试统一检查器' }
  })
  await user.click(screen.getByTestId(workbenchSelectors.sendButton))
  await waitFor(() => {
    expect(apiMock.calls.aiRunStart).toHaveLength(1)
  })

  return apiMock
}

describe('chat.right-panel-events', () => {
  it('renders timeline entries for plan, retrieval, artifact, and draft review in the workbench inspector', async () => {
    const userActionSequence: string[] = []
    const selectorFailures: string[] = []
    const assertions: UiAssertion[] = []
    const notes: string[] = []
    const apiMock = await startRun()

    const planEvent: AiRunEvent = {
      type: 'plan_created',
      runId: 'run-test-1',
      plan: [
        {
          id: 'task-1',
          title: '检索资料',
          objective: '先读取相关资料',
          status: 'pending',
          attempts: 0
        }
      ]
    }
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
      completedAt: Date.now()
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
      artifactRole: 'preview',
      summary: '生成草稿预览',
      createdAt: Date.now()
    }
    const reviewEvent: AiRunEvent = {
      type: 'draft_review_ready',
      runId: 'run-test-1',
      review: {
        reviewId: 'review-1',
        documentCount: 1,
        changeCount: 2
      },
      createdAt: Date.now()
    }

    await runRendererCase({
      suite: 'renderer-chat-contract',
      caseId: 'chat-right-panel-events',
      caseMetadata: CASE_METADATA,
      apiMock,
      userActionSequence,
      selectorFailures,
      assertions,
      notes,
      route: '#/',
      expectedOutcome: CASE_METADATA.expectedOutcome,
      scenarioTags: CASE_METADATA.scenarioTags,
      taskGoal: CASE_METADATA.taskGoal,
      body: async () => {
        await replayAiRunEvents({
          mock: apiMock,
          events: [planEvent, retrievalEvent, artifactEvent, reviewEvent]
        })
        userActionSequence.push('events:plan+tool+artifact+review')

        await waitFor(() => {
          expect(screen.getByTestId(workbenchSelectors.timeline)).not.toBeNull()
        })

        await userEvent.setup().click(screen.getByRole('button', { name: /本地混合检索/i }))
        await waitFor(() => {
          expect(screen.getByTestId(workbenchSelectors.inspectorTitle).textContent).toContain('工具结果')
        })
        expect(screen.getByTestId(workbenchSelectors.searchResults).textContent).toContain('命中文本')
        assertions.push({ id: 'workbench-retrieval-inspector-rendered', pass: true })

        await userEvent.setup().click(screen.getByRole('button', { name: /result\.docx/i }))
        await waitFor(() => {
          expect(screen.getByTestId(workbenchSelectors.inspectorTitle).textContent).toContain('result.docx')
        })
        expect(screen.getByTestId(workbenchSelectors.inspector).textContent).toContain('preview')
        assertions.push({ id: 'workbench-artifact-inspector-rendered', pass: true })

        await userEvent.setup().click(screen.getByRole('button', { name: /草稿审阅已就绪/i }))
        await waitFor(() => {
          expect(screen.getByTestId(workbenchSelectors.inspectorTitle).textContent).toContain('草稿审阅')
        })
        expect(screen.getByTestId(workbenchSelectors.inspector).textContent).toContain('2 处修改')
        assertions.push({ id: 'workbench-review-inspector-rendered', pass: true })
      }
    })
  })
})
