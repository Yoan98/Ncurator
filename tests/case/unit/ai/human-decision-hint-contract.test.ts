import { describe, expect, it } from 'vitest'
import { HUMAN_DECISION_HINT_CODES } from '../../../../src/main/services/ai/human/constants'
import {
  renderDecisionHintDetail,
  renderDecisionHintForBrain
} from '../../../../src/main/services/ai/human/prompts/decisionHints'
import { humanDecisionHintSchema } from '../../../../src/main/services/ai/human/schema'
import type { HumanDecisionHint } from '../../../../src/main/services/ai/human/types'

const HINT_FIXTURES: Record<(typeof HUMAN_DECISION_HINT_CODES)[number], HumanDecisionHint> = {
  learning_no_effect: {
    code: 'learning_no_effect',
    detail: {
      requestedSkillIds: ['docx-read'],
      duplicateSkillIds: ['docx-read'],
      unknownSkillIds: []
    }
  },
  run_resumed_after_interruption: {
    code: 'run_resumed_after_interruption',
    detail: {
      reason: 'timeout'
    }
  },
  terminal_approval_blocked: {
    code: 'terminal_approval_blocked',
    detail: {
      allowedCommands: ['pwd'],
      blockedCommands: ['mkdir blocked-dir'],
      notes: [
        {
          command: 'mkdir blocked-dir',
          message: '请改为只读检查，不要落目录。'
        }
      ]
    }
  },
  hand_call_limit_exceeded: {
    code: 'hand_call_limit_exceeded',
    detail: {
      offendingToolNames: [
        'terminal_run',
        'docx_read_outline',
        'docx_read_blocks',
        'kb_search',
        'docx_edit',
        'docx_read_outline'
      ],
      callCount: 6,
      limit: 5
    }
  },
  legacy_doc_edit_unsupported: {
    code: 'legacy_doc_edit_unsupported',
    detail: {
      instruction: '禁止继续尝试编辑或转换旧版 .doc 文件，请提示用户转换为 .docx 后再编辑。'
    }
  },
  hand_docx_edit_failed: {
    code: 'hand_docx_edit_failed',
    detail: {
      toolName: 'docx_edit',
      sourcePath: 'report.docx',
      action: 'insert_blocks',
      error: 'cannot resolve anchorBlockId=b:99 in current active snapshot'
    }
  },
  hand_docx_positioned_write_blocked: {
    code: 'hand_docx_positioned_write_blocked',
    detail: {
      toolName: 'docx_edit',
      sourcePath: 'graphics.docx',
      action: 'insert_blocks',
      error: '当前命中复杂定位排版区域：包含“达到反走样。”的区域，暂不支持自动编辑'
    }
  },
  hand_tool_limit_near_exhausted: {
    code: 'hand_tool_limit_near_exhausted',
    detail: {
      toolCallCount: 24,
      limit: 40
    }
  },
  hand_tool_limit_exceeded: {
    code: 'hand_tool_limit_exceeded',
    detail: {
      toolCallCount: 41,
      limit: 40
    }
  },
  hand_tool_result_too_large: {
    code: 'hand_tool_result_too_large',
    detail: {
      toolName: 'docx_read_outline',
      estimatedTokens: 6049,
      limit: 6000
    }
  },
  hand_tool_result_unusable: {
    code: 'hand_tool_result_unusable',
    detail: {
      toolName: 'terminal_run',
      totalChars: 1200,
      nulCount: 3,
      replacementCharCount: 40,
      replacementCharRatio: 0.0333,
      controlCharCount: 420,
      controlCharRatio: 0.35,
      matchedSignatures: ['PK_HEADER', 'OFFICE_WORD_XML']
    }
  },
  brain_output_schema_invalid: {
    code: 'brain_output_schema_invalid',
    detail: {
      issues: [
        {
          path: 'nextAction.calls[0].args',
          message: 'Expected object, received string'
        }
      ]
    }
  },
  hand_call_invalid: {
    code: 'hand_call_invalid',
    detail: {
      invalidCalls: [
        {
          callIndex: 0,
          toolName: 'terminal_run',
          message: 'tool call schema invalid\ncalls[0].args.command: Required'
        }
      ]
    }
  },
  brain_todolist_incomplete: {
    code: 'brain_todolist_incomplete',
    detail: {
      pendingItems: ['检查是否已经满足用户诉求并能进入最终交付']
    }
  },
  brain_content_safety: {
    code: 'brain_content_safety',
    detail: {
      message: '当前请求无法继续执行。'
    }
  }
}

describe('ai unit human decision hint contract', () => {
  it.each(HUMAN_DECISION_HINT_CODES)('accepts and renders %s without throwing', (code) => {
    const fixture = HINT_FIXTURES[code]
    const parsed = humanDecisionHintSchema.parse(fixture)
    const summary = renderDecisionHintForBrain(parsed)
    const detail = renderDecisionHintDetail(parsed)

    expect(parsed).toEqual(fixture)
    expect(typeof summary).toBe('string')
    expect(summary.length).toBeGreaterThan(0)
    expect(detail).toEqual(fixture.detail)
  })

  it('renders a docx edit error once', () => {
    const rendered = renderDecisionHintForBrain({
      code: 'hand_docx_edit_failed',
      detail: {
        toolName: 'docx_edit',
        sourcePath: 'report.docx',
        action: 'insert_blocks',
        error: 'docx_edit(insert_blocks) cannot find anchor block: b:99'
      }
    })

    expect(rendered).toContain('错误：docx_edit(insert_blocks) cannot find anchor block: b:99。')
    expect(
      rendered.match(/docx_edit\(insert_blocks\) cannot find anchor block: b:99/g)
    ).toHaveLength(1)
  })

  it('renders legacy DOC guidance exactly', () => {
    expect(
      renderDecisionHintForBrain({
        code: 'legacy_doc_edit_unsupported',
        detail: {
          instruction: '禁止继续尝试编辑或转换旧版 .doc 文件，请提示用户转换为 .docx 后再编辑。'
        }
      })
    ).toBe('禁止继续尝试编辑或转换旧版 .doc 文件，请提示用户转换为 .docx 后再编辑。')
  })
})
