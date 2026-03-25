import { test } from 'vitest'
import {
  buildDeliveryModeFallbackMarkdown,
  buildDeliveryModePromptExample,
  buildDeliveryModePromptRules,
  extractContextNoteReusableEvidence
} from '../../../../src/main/services/ai/human/shared/deliveryContracts'
import { buildMouthPromptContext } from '../../../../src/main/services/ai/human/prompts/mouth'
import {
  renderHumanEvidenceLines,
  renderHumanFactLines,
  renderHumanOpenQuestionLines
} from '../../../../src/main/services/ai/human/shared/memoryRenderers'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
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
      action: 'mouth'
    }
  }
  state.lastParallelCallToolResults = [
    {
      toolName: 'docx_render_preview',
      ok: true,
      code: 'ok',
      summary: '已生成预览文件。',
      data: {
        previewPath: '/tmp/review-preview.docx'
      }
    }
  ]
  state.runtimeArtifacts.push({
    kind: 'file',
    capability: 'docx',
    path: '/tmp/review-preview.docx',
    fileName: 'review-preview.docx',
    operation: 'created',
    artifactRole: 'preview',
    summary: '预览已生成。'
  })
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
        factLines: renderHumanFactLines(state, 'brain_prompt'),
        evidenceLines: renderHumanEvidenceLines(state, 'mouth_prompt'),
        questionLines: renderHumanOpenQuestionLines(state, 'brain_prompt'),
        taskHandoffMarkdown: buildDeliveryModeFallbackMarkdown({
          state,
          mode: 'task_handoff',
          summary: '已整理交付。'
        }),
        contextNoteMarkdown: buildDeliveryModeFallbackMarkdown({
          state,
          mode: 'context_note',
          summary: '已补充上下文。'
        }),
        userAnswerMarkdown: buildDeliveryModeFallbackMarkdown({
          state,
          mode: 'user_answer',
          summary: '已整理最终答复。'
        }),
        taskHandoffRules: buildDeliveryModePromptRules('task_handoff'),
        contextNoteRules: buildDeliveryModePromptRules('context_note'),
        contextNoteExample: buildDeliveryModePromptExample('context_note'),
        mouthPromptUser: buildMouthPromptContext({
          state,
          deliveryMode: 'task_handoff'
        }).user,
        extractedReusableEvidence: extractContextNoteReusableEvidence(
          buildDeliveryModeFallbackMarkdown({
            state,
            mode: 'context_note',
            summary: '已补充上下文。'
          })
        )
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
          result.taskHandoffMarkdown.includes('review-preview.docx') &&
          result.taskHandoffMarkdown.includes('## 建议下一步') &&
          result.contextNoteMarkdown.includes('# 上下文补充结果') &&
          result.contextNoteMarkdown.includes('## 可复用证据') &&
          result.userAnswerMarkdown.includes('## 产物与引用'),
        {
          name: 'render-delivery-markdown-headings',
          message:
            'fallback delivery markdown should keep the existing task_handoff/context_note headings stable and expose runtime artifacts when present',
          data: {
            taskHandoffMarkdown: result.taskHandoffMarkdown,
            contextNoteMarkdown: result.contextNoteMarkdown,
            userAnswerMarkdown: result.userAnswerMarkdown
          }
        }
      )

      runtime.assertThat(
        result.taskHandoffRules.includes('# 子任务交付') &&
          result.taskHandoffRules.includes('## 建议下一步') &&
          result.contextNoteRules.includes('# 上下文补充结果') &&
          result.contextNoteRules.includes('## 可复用证据') &&
          result.contextNoteExample.includes('# 上下文补充结果'),
        {
          name: 'render-delivery-contract-rules',
          message:
            'delivery prompt rules and examples should come from the shared structured delivery contract definitions',
          data: {
            taskHandoffRules: result.taskHandoffRules,
            contextNoteRules: result.contextNoteRules,
            contextNoteExample: result.contextNoteExample
          }
        }
      )

      runtime.assertThat(
        result.extractedReusableEvidence.length === 1 &&
          result.extractedReusableEvidence[0] ===
            'kb_hybrid_search_chunks: 知识库显示发布前需执行复核。 (tool_result#1)',
        {
          name: 'render-context-note-evidence-extraction',
          message:
          'context_note evidence extraction should read from the same shared delivery contract headings as fallback markdown',
          data: result.extractedReusableEvidence
        }
      )

      runtime.assertThat(
        result.mouthPromptUser.includes('<recent_tool_results>') &&
          result.mouthPromptUser.includes('docx_render_preview') &&
          result.mouthPromptUser.includes('<runtime_artifacts>') &&
          result.mouthPromptUser.includes('review-preview.docx'),
        {
          name: 'render-mouth-prompt-runtime-context',
          message:
            'mouth prompt context should expose recent tool results and runtime artifacts so delivery can accurately mention produced files',
          data: result.mouthPromptUser
        }
      )
    }
  })
})
