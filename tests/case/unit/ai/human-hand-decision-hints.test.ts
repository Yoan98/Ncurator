import { describe, expect, it } from 'vitest'
import {
  deriveHandFollowupSignals,
  shouldStopSerialHandPlan
} from '../../../../src/main/services/ai/human/node/handNode/followupSignals'
import {
  buildHandCallInvalidHint,
  deriveGroupedHandFailureHints
} from '../../../../src/main/services/ai/human/node/handNode/decisionHints'

describe('ai unit hand decision hints', () => {
  it('aggregates multiple invalid calls into one hand_call_invalid hint', () => {
    const hint = buildHandCallInvalidHint([
      {
        callIndex: 0,
        toolName: 'terminal_run',
        message: 'tool call schema invalid\ncalls[0].args.command: Required'
      },
      {
        callIndex: 2,
        toolName: 'docx_edit',
        message: 'tool call schema invalid\ncalls[2].args.action: Required'
      }
    ])

    expect(hint).toEqual({
      code: 'hand_call_invalid',
      detail: {
        invalidCalls: [
          {
            callIndex: 0,
            toolName: 'terminal_run',
            message: 'tool call schema invalid\ncalls[0].args.command: Required'
          },
          {
            callIndex: 2,
            toolName: 'docx_edit',
            message: 'tool call schema invalid\ncalls[2].args.action: Required'
          }
        ]
      }
    })
  })

  it('does not convert external path failures into a workspace boundary hint', () => {
    const grouped = deriveGroupedHandFailureHints({
      calls: [
        {
          toolName: 'terminal_run',
          args: {
            command: 'cat ../secret.txt'
          }
        },
        {
          toolName: 'docx_read_blocks',
          args: {
            sourcePath: 'missing.docx',
            fromBlockIndex: 0,
            toBlockIndex: 1
          }
        }
      ],
      results: [
        {
          toolName: 'terminal_run',
          ok: false,
          data: {
            error: 'workspace boundary check failed: relative path escapes workspace boundary: ../secret.txt'
          }
        },
        {
          toolName: 'docx_read_blocks',
          ok: false,
          data: {
            error: 'ENOENT: no such file or directory, open missing.docx'
          }
        }
      ]
    })

    expect(grouped).not.toHaveProperty('workspaceBoundaryHint')
    expect(grouped).not.toHaveProperty('toolRuntimeFailedHint')
  })

  it('promotes unusable terminal output hint to the next brain round', () => {
    const decisionHint = {
      code: 'hand_tool_result_unusable' as const,
      detail: {
        toolName: 'terminal_run',
        totalChars: 200,
        nulCount: 1,
        replacementCharCount: 0,
        replacementCharRatio: 0,
        controlCharCount: 80,
        controlCharRatio: 0.4,
        matchedSignatures: ['PK_HEADER']
      }
    }
    const input = {
      calls: [
        {
          toolName: 'terminal_run',
          args: {
            command: 'cat report.docx'
          }
        }
      ],
      results: [
        {
          toolName: 'terminal_run',
          ok: false,
          data: {
            error: 'terminal result unusable',
            decisionHint
          }
        }
      ]
    }

    expect(deriveHandFollowupSignals(input).decisionHint).toEqual(decisionHint)
    expect(shouldStopSerialHandPlan(input)).toBe(true)
  })
})
