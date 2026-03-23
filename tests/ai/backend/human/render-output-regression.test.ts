import { test } from 'vitest'
import { buildFallbackDeliveryMarkdown } from '../../../../src/main/services/ai/human/node/mouthNode/deliveryMarkdown'
import {
  renderEvidenceLines,
  renderFactLines,
  renderOpenQuestionLines
} from '../../../../src/main/services/ai/human/prompts/contextRenderers'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/utils/state'
import { renderLineList, renderNamedSections } from '../../../../src/main/services/ai/utils/render'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

const buildState = () => {
  const state = createInitialHumanState({
    taskId: 'render-regression',
    userInput: '整理风险并输出结论'
  })
  state.brainMemory.inside.facts.push({
    id: 'fact-1',
    summary: '需要在发布前完成复核。',
    evidenceIds: ['evidence-1']
  })
  state.brainMemory.inside.evidences.push({
    id: 'evidence-1',
    toolName: 'kb_hybrid_search_chunks',
    summary: '知识库显示发布前需执行复核。',
    sourceType: 'tool_result',
    rawRef: 'tool_result#1'
  })
  state.brainMemory.inside.openQuestions.push('是否已有最终批准')
  state.lastBrainDecision = {
    memoryOps: [],
    decision: {
      summary: '当前已经可以输出结论',
      reason: '关键事实和证据都已收敛。',
      expectedOutcome: '整理交付结果。'
    },
    nextAction: {
      action: 'mouth',
      status: 'completed'
    }
  }
  return state
}

test('render-output-regression', async () => {
  await runBackendCase({
    caseId: 'render-output-regression',
    caseType: 'basic',
    domain: 'ai',
    layer: 'backend',
    suite: 'human',
    description:
      'shared render helpers and fallback delivery markdown keep existing placeholders, evidence/fact rendering, and markdown section titles stable.',
    fixtures: [],
    runMode: 'repeatable',
    execute: async () => {
      const state = buildState()
      return {
        emptyPromptSections: renderNamedSections(
          [{ label: '用户输入', value: '' }],
          {
            fallback: '(none)',
            style: 'plain'
          }
        ),
        emptyBulletList: renderLineList([], {
          fallback: '无',
          style: 'bullet'
        }),
        factLines: renderFactLines(state, 'brain'),
        evidenceLines: renderEvidenceLines(state, 'mouth'),
        questionLines: renderOpenQuestionLines(state),
        taskHandoffMarkdown: buildFallbackDeliveryMarkdown({
          state,
          deliveryMode: 'task_handoff',
          finalStatus: 'completed',
          summary: '已整理交付。'
        }),
        contextNoteMarkdown: buildFallbackDeliveryMarkdown({
          state,
          deliveryMode: 'context_note',
          finalStatus: 'completed',
          summary: '已补充上下文。'
        })
      }
    },
    assert: async (result, runtime) => {
      runtime.assertThat(result.emptyPromptSections === '用户输入:\n(none)', {
        name: 'render-empty-sections',
        message: 'shared section renderer should keep the existing plain-section fallback format',
        data: result.emptyPromptSections
      })

      runtime.assertThat(result.emptyBulletList === '无', {
        name: 'render-empty-bullets',
        message: 'shared list renderer should keep the configured empty placeholder intact',
        data: result.emptyBulletList
      })

      runtime.assertThat(
        result.factLines.includes('事实 fact-1') &&
          result.evidenceLines.includes('kb_hybrid_search_chunks') &&
          result.questionLines.includes('是否已有最终批准'),
        {
          name: 'render-facts-evidence-questions',
          message: 'fact/evidence/open-question rendering should stay stable after helper extraction',
          data: {
            factLines: result.factLines,
            evidenceLines: result.evidenceLines,
            questionLines: result.questionLines
          }
        }
      )

      runtime.assertThat(
        result.taskHandoffMarkdown.includes('# 子任务交付') &&
          result.taskHandoffMarkdown.includes('## 关键事实') &&
          result.taskHandoffMarkdown.includes('## 关键证据') &&
          result.taskHandoffMarkdown.includes('## 建议下一步') &&
          result.contextNoteMarkdown.includes('# 上下文补充结果') &&
          result.contextNoteMarkdown.includes('## 可复用证据'),
        {
          name: 'render-delivery-markdown-headings',
          message:
            'fallback delivery markdown should keep the existing task_handoff and context_note headings stable',
          data: {
            taskHandoffMarkdown: result.taskHandoffMarkdown,
            contextNoteMarkdown: result.contextNoteMarkdown
          }
        }
      )
    }
  })
})
