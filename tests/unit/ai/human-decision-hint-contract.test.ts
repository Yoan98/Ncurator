import { describe, expect, it } from 'vitest'
import { HUMAN_DECISION_HINT_CODES } from '../../../src/main/services/ai/human/constants'
import {
  renderDecisionHintDetail,
  renderDecisionHintForBrain
} from '../../../src/main/services/ai/human/prompts/decisionHints'
import { humanDecisionHintSchema } from '../../../src/main/services/ai/human/schema'
import type { HumanDecisionHint } from '../../../src/main/services/ai/human/types'

const HINT_FIXTURES: Record<(typeof HUMAN_DECISION_HINT_CODES)[number], HumanDecisionHint> = {
  learning_no_effect: {
    code: 'learning_no_effect',
    detail: {
      requestedSkillIds: ['docx-read'],
      duplicateSkillIds: ['docx-read'],
      unknownSkillIds: []
    }
  },
  terminal_approval_blocked: {
    code: 'terminal_approval_blocked',
    detail: {
      allowedCommands: ['pwd'],
      blockedCommands: ['mkdir blocked-dir'],
      guidance: [
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
      offendingToolNames: ['terminal_run', 'docx_outline', 'docx_read_blocks', 'kb_search', 'docx_create', 'docx_outline'],
      callCount: 6,
      limit: 5
    }
  },
  hand_docx_single_file_write_limit_exceeded: {
    code: 'hand_docx_single_file_write_limit_exceeded',
    detail: {
      offendingToolNames: ['docx_paragraph_edit', 'docx_table_edit'],
      sourcePaths: ['report.docx']
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
      toolName: 'docx_outline',
      estimatedTokens: 6049,
      limit: 6000
    }
  },
  hand_docx_positioned_write_blocked: {
    code: 'hand_docx_positioned_write_blocked',
    detail: {
      targetDescription: '在 graphics.docx 中，你刚才尝试插入表格的那处位置',
      sourcePath: 'graphics.docx'
    }
  },
  brain_output_schema_invalid: {
    code: 'brain_output_schema_invalid',
    detail: {
      area: 'nextAction.calls',
      summary: 'hand plan 输出结构不合法',
      issues: [
        {
          path: 'nextAction.calls[0].args',
          message: 'Expected object, received string'
        }
      ],
      guidance: '请改为严格符合 tool schema 的 args 结构。'
    }
  },
  brain_todolist_incomplete: {
    code: 'brain_todolist_incomplete',
    detail: {
      pendingItems: ['检查是否已经满足用户诉求并能进入最终交付']
    }
  }
}

describe('ai unit human decision hint contract', () => {
  it.each(HUMAN_DECISION_HINT_CODES)(
    'accepts and renders %s without throwing',
    (code) => {
      const fixture = HINT_FIXTURES[code]
      const parsed = humanDecisionHintSchema.parse(fixture)
      const summary = renderDecisionHintForBrain(parsed)
      const detail = renderDecisionHintDetail(parsed)

      expect(parsed).toEqual(fixture)
      expect(typeof summary).toBe('string')
      expect(summary.length).toBeGreaterThan(0)
      expect(detail).toEqual(fixture.detail)
    }
  )
})
