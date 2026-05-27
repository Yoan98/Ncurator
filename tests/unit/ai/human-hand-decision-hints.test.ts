import { describe, expect, it } from 'vitest'
import {
  buildHandCallInvalidHint,
  buildHandToolRuntimeFailedHint,
  buildHandWorkspaceBoundaryBlockedHint,
  deriveGroupedHandFailureHints
} from '../../../src/main/services/ai/human/node/handNode/decisionHints'

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
        toolName: 'docx_create',
        message: 'tool call schema invalid\ncalls[2].args.blocks: Required'
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
            toolName: 'docx_create',
            message: 'tool call schema invalid\ncalls[2].args.blocks: Required'
          }
        ]
      }
    })
  })

  it('groups workspace boundary and runtime failures separately', () => {
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
          diagnostic: {
            message: 'workspace boundary check failed: relative path escapes workspace boundary: ../secret.txt'
          },
          data: {
            error: 'workspace boundary check failed: relative path escapes workspace boundary: ../secret.txt'
          }
        },
        {
          toolName: 'docx_read_blocks',
          ok: false,
          diagnostic: {
            message: 'ENOENT: no such file or directory, open missing.docx'
          },
          data: {
            error: 'ENOENT: no such file or directory, open missing.docx'
          }
        }
      ]
    })

    expect(grouped.workspaceBoundaryHint).toEqual(
      buildHandWorkspaceBoundaryBlockedHint([
        {
          callIndex: 0,
          toolName: 'terminal_run',
          message: 'workspace boundary check failed: relative path escapes workspace boundary: ../secret.txt'
        }
      ])
    )
    expect(grouped.toolRuntimeFailedHint).toEqual(
      buildHandToolRuntimeFailedHint([
        {
          callIndex: 1,
          toolName: 'docx_read_blocks',
          message: 'ENOENT: no such file or directory, open missing.docx'
        }
      ])
    )
  })
})
