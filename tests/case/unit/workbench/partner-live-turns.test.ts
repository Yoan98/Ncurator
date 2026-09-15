import { describe, expect, it } from 'vitest'
import {
  resumeAssistantTurnFromLive,
  type AssistantTurnViewModel
} from '../../../harness/core/partnerLiveTurns'

const createTurn = (
  overrides: Partial<AssistantTurnViewModel> = {}
): AssistantTurnViewModel => ({
  messageId: 'msg-1',
  runId: 'run-1',
  status: 'running',
  runFinished: false,
  isBrainThinking: false,
  processThoughts: [],
  processGroups: [],
  finalAnswerMarkdown: '',
  streamingMarkdown: '',
  streamingRole: 'answer',
  plan: [],
  artifacts: [],
  applyTargets: [],
  waitingApproval: false,
  pendingApprovalItems: [],
  approvalReviews: [],
  ...overrides
})

describe('resumeAssistantTurnFromLive', () => {
  it('keeps snapshot when live is missing or either side already finished', () => {
    const snapshot = createTurn({ isBrainThinking: false })
    expect(resumeAssistantTurnFromLive(snapshot, undefined)).toBe(snapshot)
    expect(
      resumeAssistantTurnFromLive(createTurn({ runFinished: true }), createTurn({ isBrainThinking: true }))
        .isBrainThinking
    ).toBe(false)
  })

  it('restores in-memory thinking when snapshot log has not opened the window yet', () => {
    const snapshot = createTurn({ isBrainThinking: false, streamingMarkdown: '' })
    const live = createTurn({ isBrainThinking: true, streamingMarkdown: '' })
    expect(resumeAssistantTurnFromLive(snapshot, live).isBrainThinking).toBe(true)
  })
})
