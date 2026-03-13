import { describe, test } from 'vitest'
import { buildHumanBrainPrompt } from '../../../../src/main/services/ai/prompts/human/brain'
import { buildHumanResponsePrompt } from '../../../../src/main/services/ai/prompts/human/response'
import { recordAssertion } from '../../../harness/main/assertions'
import { runRuntimeCase } from '../../../harness/main/capabilityCase'

const CASE_METADATA = {
  description: '验证 human brain/response prompt 持续携带 local-first 与非本地权限约束。',
  taskGoal: '确认 human brain 与 response prompt 继续要求 local-first，并正确表达非本地信息权限边界。',
  scenarioTags: ['runtime', 'prompt', 'local-first', 'contract'],
  expectedOutcome: 'success',
  requiredFixtures: [],
  retentionTier: 'canonical',
  lifecycle: 'active',
  runPolicy: 'gating',
  capabilityArea: 'ai-runtime'
} as const

describe('main/ai/runtime/prompts', () => {
  test('prompt contracts should keep local-first and non-local permission constraints', async () => {
    await runRuntimeCase({
      caseId: 'prompt-local-first-contract',
      description: CASE_METADATA.description,
      caseMetadata: CASE_METADATA,
      expectedOutcome: CASE_METADATA.expectedOutcome,
      scenarioTags: CASE_METADATA.scenarioTags,
      requiredFixtures: CASE_METADATA.requiredFixtures,
      fixtureCopies: [],
      buildExecutionOutcome: () => ({
        status: 'completed',
        resultCode: 'ok',
        summary: 'prompt local-first contract completed'
      }),
      execute: async () => {
        const finalResponsePromptWithoutPermission = buildHumanResponsePrompt({
          objective: '请总结这个目录里的规范并直接输出最终答复',
          deliveryKind: 'final',
          selectedScopeSummary: '1. workspace:docs | prepared=1 | unprepared=1',
          allowNonLocal: false,
          summary: '已完成本地检索，但还有范围外信息待确认。',
          resultCode: 'ok',
          resultDataText: '无',
          lastObservationText: '本地资料仅覆盖目录内规范。',
          stepHistoryText: 'step=1 | action=invoke_tool | summary=已完成本地检索'
        })
        const finalResponsePromptWithPermission = buildHumanResponsePrompt({
          objective: '请继续补充范围外信息并输出最终答复',
          deliveryKind: 'final',
          selectedScopeSummary: '1. workspace:docs | prepared=1 | unprepared=1',
          allowNonLocal: true,
          summary: '需要结合范围外材料补充说明。',
          resultCode: 'ok',
          resultDataText: '无',
          lastObservationText: '本地资料覆盖有限。',
          stepHistoryText: 'step=1 | action=invoke_tool | summary=已完成本地检索'
        })
        const humanPrompt = buildHumanBrainPrompt({
          objective: '根据已选资料完成规范总结',
          stepIndex: 1,
          maxSteps: 6,
          selectedScopeSummary: '1. file:spec.docx | prepared=1 | unprepared=0',
          availableSkillCardsText: 'docx, retrieval',
          loadedSkillsText: 'retrieval',
          activeToolsText: 'kb_hybrid_search_chunks',
          lastObservationText: 'none',
          stepHistoryText: 'none'
        })

        return {
          finalResponsePromptWithoutPermission,
          finalResponsePromptWithPermission,
          humanPrompt
        }
      },
      assert: async (result, runtime) => {
        recordAssertion(runtime.assertions, {
          id: 'prompt.response-demands-non-local-permission',
          pass:
            result.finalResponsePromptWithoutPermission.system.includes(
              '用户尚未允许使用非本地信息'
            ) &&
            result.finalResponsePromptWithoutPermission.system.includes(
              '必须在答复中明确说明本地资料不足并询问是否允许继续使用非本地信息'
            ),
          details: result.finalResponsePromptWithoutPermission.system
        })
        recordAssertion(runtime.assertions, {
          id: 'prompt.response-recognizes-allowed-non-local-path',
          pass:
            result.finalResponsePromptWithPermission.system.includes('用户已允许使用非本地信息') &&
            result.finalResponsePromptWithPermission.system.includes('只有在本地确实不足时才可补充'),
          details: result.finalResponsePromptWithPermission.system
        })
        recordAssertion(runtime.assertions, {
          id: 'prompt.human-brain-keeps-local-first-constraints',
          pass:
            result.humanPrompt.system.includes('【local-first】') &&
            result.humanPrompt.system.includes('【范围不足】'),
          details: result.humanPrompt.system
        })
        recordAssertion(runtime.assertions, {
          id: 'prompt.human-brain-demands-result-convergence',
          pass:
            result.humanPrompt.system.includes('【结果收敛】') &&
            result.humanPrompt.system.includes('resultData 字段') &&
            result.humanPrompt.system.includes('不要再做“再次确认”式工具调用'),
          details: result.humanPrompt.system
        })
      }
    })
  })
})
