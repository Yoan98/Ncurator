import React from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChatPage from '../../../../src/renderer/src/pages/ChatPage'
import { workbenchSelectors } from '../../../../src/renderer/src/testing/selectors'
import type { ChatSession, DraftReviewDetail } from '../../../../src/shared/types'
import { createDesktopApiMock } from '../../../harness/renderer/apiMock'
import type { UiAssertion } from '../../../harness/e2e/reporter'
import { runRendererCase } from '../../../harness/renderer/case'
import { renderWithDesktopApi } from '../../../harness/renderer/renderPage'

const session: ChatSession = {
  id: 'session-1',
  title: '带草稿审阅的会话',
  created_at: 1
}

const draftReview: DraftReviewDetail = {
  review: {
    id: 'review-1',
    session_id: 'session-1',
    run_id: 'run-1',
    status: 'review_pending',
    title: '文档修改审阅',
    document_count: 1,
    change_count: 2,
    pending_change_count: 2,
    accepted_change_count: 0,
    rejected_change_count: 0,
    created_at: 1,
    updated_at: 1,
    completed_at: 1
  },
  documents: [
    {
      id: 'draft-doc-1',
      review_id: 'review-1',
      source_document_id: 'doc-1',
      source_path: '/tmp/demo.docx',
      source_name: 'demo.docx',
      format: 'docx',
      latest_draft_snapshot_id: 'draft-snapshot-1',
      preview_artifact_path: '/tmp/demo-preview.docx',
      draft_artifact_path: '/tmp/demo-draft.docx',
      source_version: {},
      total_change_count: 2,
      pending_change_count: 2,
      accepted_change_count: 0,
      rejected_change_count: 0,
      created_at: 1,
      updated_at: 1
    }
  ],
  changes: [
    {
      id: 'change-1',
      review_id: 'review-1',
      document_id: 'draft-doc-1',
      order_index: 1,
      change_kind: 'block',
      title: '修改标题',
      summary: '把标题改成新的版本',
      decision: 'pending',
      before_text: '旧标题',
      after_text: '新标题',
      locator: { blockId: 'block-1' },
      created_at: 1,
      updated_at: 1
    },
    {
      id: 'change-2',
      review_id: 'review-1',
      document_id: 'draft-doc-1',
      order_index: 2,
      change_kind: 'block',
      title: '补充结论段',
      summary: '在末尾新增结论段落',
      decision: 'pending',
      before_text: '',
      after_text: '这是新的结论。',
      locator: { blockId: 'block-2' },
      created_at: 1,
      updated_at: 1
    }
  ],
  commit_jobs: []
}

describe('chat.draft-review-flow', () => {
  it('restores a persisted draft review, supports bulk accept, and commits after validation', async () => {
    const userActionSequence: string[] = []
    const selectorFailures: string[] = []
    const assertions: UiAssertion[] = []
    const notes: string[] = []
    const apiMock = createDesktopApiMock({
      sessions: [session],
      draftReviews: [draftReview],
      draftCommitResponse: {
        success: true,
        job: {
          id: 'commit-job-1',
          review_id: 'review-1',
          status: 'completed',
          document_count: 1,
          results: [
            {
              draft_document_id: 'draft-doc-1',
              output_path: '/tmp/demo.docx',
              operation: 'updated',
              byte_size: 512
            }
          ],
          started_at: 2,
          completed_at: 3
        }
      }
    })
    const user = userEvent.setup()
    renderWithDesktopApi({
      apiMock,
      ui: <ChatPage />
    })

    await runRendererCase({
      suite: 'renderer-chat-contract',
      caseId: 'chat-draft-review-flow',
      apiMock,
      userActionSequence,
      selectorFailures,
      assertions,
      notes,
      route: '#/',
      expectedOutcome: 'success',
      scenarioTags: ['renderer', 'chat', 'draft-review'],
      taskGoal:
        'Restore draft review state, bulk-accept pending changes, and commit the accepted blocks from the unified workbench.',
      body: async () => {
        await screen.findByTestId(workbenchSelectors.reviewCenter)
        const validationNode = await screen.findByTestId(workbenchSelectors.reviewValidation)
        expect(validationNode.getAttribute('data-ready')).toBe('false')
        assertions.push({ id: 'draft-review-restored', pass: true })

        await user.click(await screen.findByTestId(workbenchSelectors.reviewAcceptAllButton))
        userActionSequence.push('click:workbench-review-accept-all-button')

        await waitFor(() => {
          expect(apiMock.calls.draftReviewSetDecision).toHaveLength(2)
        })
        await waitFor(() => {
          expect(screen.getByTestId(workbenchSelectors.reviewValidation).getAttribute('data-ready')).toBe(
            'true'
          )
        })
        assertions.push({ id: 'draft-review-bulk-accepted', pass: true })

        await user.click(await screen.findByTestId(workbenchSelectors.reviewCommitButton))
        userActionSequence.push('click:workbench-review-commit-button')

        await waitFor(() => {
          expect(apiMock.calls.draftReviewCommit).toHaveLength(1)
        })
        expect(apiMock.calls.draftReviewCommit[0]).toEqual({
          reviewId: 'review-1',
          overwrite: true
        })
        const commitResultsNode = await screen.findByTestId(workbenchSelectors.reviewCommitResults)
        await waitFor(() => {
          expect(commitResultsNode.textContent).toContain('/tmp/demo.docx')
        })
        assertions.push({ id: 'draft-review-commit-finished', pass: true })
      }
    })
  })
})
