import { describe, expect, it } from 'vitest'
import {
  findApprovalReviewForProcessItem,
  formatApprovalReviewHoverText,
  projectApprovalReviews,
  type AssistantApprovalReview
} from '../../../../src/shared/workbench/approvalReview'

describe('approval review projection', () => {
  const reviews: AssistantApprovalReview[] = [
    {
      toolCallId: 'call-approve',
      toolName: 'terminal_run',
      command: 'mkdir demo',
      action: 'approve'
    },
    {
      toolCallId: 'call-reject',
      toolName: 'terminal_run',
      command: 'rm -rf /tmp/x',
      action: 'reject'
    },
    {
      toolCallId: 'call-guide',
      toolName: 'terminal_run',
      command: 'npm install',
      action: 'guide',
      message: '先检查 package.json'
    },
    {
      toolCallId: 'call-browser',
      toolName: 'browser_use',
      command: '打开网页：https://example.com',
      action: 'approve'
    }
  ]

  it('formats hover text for three decision actions', () => {
    expect(formatApprovalReviewHoverText(reviews[0])).toBe('已允许执行')
    expect(formatApprovalReviewHoverText(reviews[1])).toBe('已拒绝执行')
    expect(formatApprovalReviewHoverText(reviews[2])).toBe('已反馈：先检查 package.json')
  })

  it('matches process items by toolCallId or terminal command', () => {
    expect(
      findApprovalReviewForProcessItem({
        itemId: 'call-approve',
        toolName: 'terminal_run',
        itemInput: { command: 'mkdir demo' },
        reviews
      })?.action
    ).toBe('approve')

    expect(
      findApprovalReviewForProcessItem({
        itemId: 'live-random-id',
        toolName: 'terminal_run',
        itemInput: { command: 'rm -rf /tmp/x' },
        reviews
      })?.action
    ).toBe('reject')
  })

  it('matches browser_use by reconstructed approval text', () => {
    expect(
      findApprovalReviewForProcessItem({
        itemId: 'other-id',
        toolName: 'browser_use',
        itemInput: { action: 'navigate', url: 'https://example.com' },
        reviews
      })?.toolCallId
    ).toBe('call-browser')
  })

  it('projects approval_batch_resolved annotations from message log', () => {
    const projected = projectApprovalReviews({
      records: [
        {
          entry: {
            kind: 'annotation',
            eventType: 'approval_batch_resolved',
            payload: {
              batchId: 'batch-1',
              items: [
                {
                  toolCallId: 'call-1',
                  toolName: 'terminal_run',
                  command: 'mkdir a',
                  action: 'approve'
                },
                {
                  toolCallId: 'call-2',
                  toolName: 'terminal_run',
                  command: 'mkdir b',
                  action: 'guide',
                  message: '改到 docs'
                }
              ]
            }
          }
        }
      ]
    })
    expect(projected).toEqual([
      {
        toolCallId: 'call-1',
        toolName: 'terminal_run',
        command: 'mkdir a',
        action: 'approve',
        message: undefined
      },
      {
        toolCallId: 'call-2',
        toolName: 'terminal_run',
        command: 'mkdir b',
        action: 'guide',
        message: '改到 docs'
      }
    ])
  })
})
