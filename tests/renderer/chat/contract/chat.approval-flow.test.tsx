import React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChatPage from '../../../../src/renderer/src/pages/ChatPage'
import { chatSelectors } from '../../../../src/renderer/src/testing/selectors'
import type { AiRunEvent, ChatSession } from '../../../../src/shared/types'
import { createDesktopApiMock } from '../../../harness/renderer/apiMock'
import type { UiAssertion } from '../../../harness/e2e/reporter'
import { runRendererCase } from '../../../harness/renderer/case'
import { renderWithDesktopApi } from '../../../harness/renderer/renderPage'

const session: ChatSession = {
  id: 'session-1',
  title: '测试会话',
  created_at: 1
}

const renderAndStartRun = async () => {
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
    target: { value: '请继续处理这条需要审批的请求' }
  })
  await user.click(screen.getByTestId(chatSelectors.sendButton))

  await waitFor(() => {
    expect(apiMock.calls.aiRunStart).toHaveLength(1)
  })

  const approvalEvent: AiRunEvent = {
    type: 'approval_required',
    runId: 'run-test-1',
    taskId: 'task-approval',
    approvalId: 'approval-1',
    command: 'rm -rf /tmp/demo',
    riskLevel: 'high',
    reason: '高风险命令需要审批',
    createdAt: Date.now()
  }
  apiMock.emitAiRunEvent(approvalEvent)

  await screen.findByTestId(chatSelectors.approvalBanner)
  return { apiMock, user }
}

describe('chat.approval-flow', () => {
  it('submits an approve decision from the chat approval banner', async () => {
    const userActionSequence: string[] = []
    const selectorFailures: string[] = []
    const assertions: UiAssertion[] = []
    const notes: string[] = []
    const { apiMock, user } = await renderAndStartRun()

    await runRendererCase({
      suite: 'renderer-chat-contract',
      caseId: 'chat-approval-approve',
      apiMock,
      userActionSequence,
      selectorFailures,
      assertions,
      notes,
      route: '#/',
      expectedOutcome: 'success',
      scenarioTags: ['renderer', 'chat', 'approval', 'approve'],
      taskGoal: 'Approve an approval_required interruption from the Chat banner and verify the preload call payload.',
      body: async () => {
        await user.click(screen.getByTestId(chatSelectors.approvalApproveButton))
        userActionSequence.push('click:chat-approval-approve-button')

        await waitFor(() => {
          expect(apiMock.calls.aiRunApprovalDecide).toHaveLength(1)
        })
        expect(apiMock.calls.aiRunApprovalDecide[0]).toEqual({
          runId: 'run-test-1',
          approvalId: 'approval-1',
          approved: true,
          reason: 'approved_in_chat_ui'
        })
        assertions.push({ id: 'approval-approve-dispatched', pass: true })
      }
    })
  })

  it('submits a deny decision from the chat approval banner', async () => {
    const userActionSequence: string[] = []
    const selectorFailures: string[] = []
    const assertions: UiAssertion[] = []
    const notes: string[] = []
    const { apiMock, user } = await renderAndStartRun()

    await runRendererCase({
      suite: 'renderer-chat-contract',
      caseId: 'chat-approval-deny',
      apiMock,
      userActionSequence,
      selectorFailures,
      assertions,
      notes,
      route: '#/',
      expectedOutcome: 'blocked',
      scenarioTags: ['renderer', 'chat', 'approval', 'deny'],
      taskGoal: 'Deny an approval_required interruption from the Chat banner and verify the preload call payload.',
      body: async () => {
        await user.click(screen.getByTestId(chatSelectors.approvalDenyButton))
        userActionSequence.push('click:chat-approval-deny-button')

        await waitFor(() => {
          expect(apiMock.calls.aiRunApprovalDecide).toHaveLength(1)
        })
        expect(apiMock.calls.aiRunApprovalDecide[0]).toEqual({
          runId: 'run-test-1',
          approvalId: 'approval-1',
          approved: false,
          reason: 'denied_in_chat_ui'
        })
        assertions.push({ id: 'approval-deny-dispatched', pass: true })
      }
    })
  })
})
