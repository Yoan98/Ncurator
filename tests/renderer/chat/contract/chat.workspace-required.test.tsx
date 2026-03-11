import React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChatPage from '../../../../src/renderer/src/pages/ChatPage'
import { chatSelectors } from '../../../../src/renderer/src/testing/selectors'
import type { ChatSession, SourceScopeSelection } from '../../../../src/shared/types'
import type { UiAssertion } from '../../../harness/e2e/reporter'
import { createDesktopApiMock } from '../../../harness/renderer/apiMock'
import { runRendererCase } from '../../../harness/renderer/case'
import { renderWithDesktopApi } from '../../../harness/renderer/renderPage'

const session: ChatSession = {
  id: 'session-1',
  title: '测试会话',
  created_at: 1
}

const workspaceScope: SourceScopeSelection = {
  scopeType: 'workspace',
  sourceType: 'workspace',
  sourceId: 'workspace-1',
  label: '测试工作空间',
  documentIds: [],
  hasUnpreparedFiles: false,
  preparedDocumentCount: 0,
  unpreparedFileCount: 0,
  workspace: {
    workspaceId: 'workspace-1',
    rootPath: '/tmp/workspace'
  }
}

describe('chat.workspace-required', () => {
  it('restarts the request after a workspace-required interruption when a workspace scope is selected', async () => {
    const userActionSequence: string[] = []
    const selectorFailures: string[] = []
    const assertions: UiAssertion[] = []
    const notes: string[] = []
    const apiMock = createDesktopApiMock({
      sessions: [session],
      sourceScopes: [workspaceScope]
    })
    const user = userEvent.setup()
    renderWithDesktopApi({
      apiMock,
      ui: <ChatPage />
    })

    await screen.findByText('测试会话')

    const scopeField = screen.getByTestId(chatSelectors.sourceScopeField)
    const scopeSelect = scopeField.querySelector('select')
    expect(scopeSelect).not.toBeNull()
    await user.selectOptions(scopeSelect as HTMLSelectElement, ['workspace:workspace-1:workspace:root'])
    userActionSequence.push('select:workspace:workspace-1')

    fireEvent.change(screen.getByTestId(chatSelectors.input), {
      target: { value: '继续处理需要工作区的请求' }
    })
    await user.click(screen.getByTestId(chatSelectors.sendButton))
    userActionSequence.push('click:chat-send-button')

    await waitFor(() => {
      expect(apiMock.calls.aiRunStart).toHaveLength(1)
    })

    apiMock.emitAiRunEvent({
      type: 'workspace_required',
      runId: 'run-test-1',
      taskId: 'task-workspace',
      reason: '需要工作区上下文',
      requiredFields: ['workspaceId', 'rootPath'],
      createdAt: Date.now()
    })

    await screen.findByTestId(chatSelectors.workspaceBanner)
    await runRendererCase({
      suite: 'renderer-chat-contract',
      caseId: 'chat-workspace-required',
      apiMock,
      userActionSequence,
      selectorFailures,
      assertions,
      notes,
      route: '#/',
      expectedOutcome: 'success',
      scenarioTags: ['renderer', 'chat', 'workspace-required'],
      taskGoal: 'Resume a Chat run after workspace_required by selecting a workspace scope and replaying the request.',
      body: async () => {
        await user.click(screen.getByTestId(chatSelectors.workspaceContinueButton))
        userActionSequence.push('click:chat-workspace-continue-button')

        await waitFor(() => {
          expect(apiMock.calls.aiRunStart).toHaveLength(2)
        })
        expect(apiMock.calls.aiRunStart[1]).toMatchObject({
          sessionId: 'session-1',
          input: '继续处理需要工作区的请求',
          selectedSourceScopes: [workspaceScope],
          allowNonLocal: false
        })
        assertions.push({ id: 'workspace-request-restarted', pass: true })
      }
    })
  })
})
