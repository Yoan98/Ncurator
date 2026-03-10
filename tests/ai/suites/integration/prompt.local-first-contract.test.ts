import { describe, test } from 'vitest'
import { buildHumanBrainPrompt } from '../../../../src/main/services/ai/prompts/human/brain'
import { buildFinalizePrompt } from '../../../../src/main/services/ai/prompts/main/finalize'
import { recordAssertion } from '../../harness/assertions'
import { runIntegrationCase } from '../../harness/capabilityCase'

describe('integration/prompts', () => {
  test('prompt contracts should keep local-first and non-local permission constraints', async () => {
    await runIntegrationCase({
      caseId: 'prompt-local-first-contract',
      description: '验证 finalize/human prompt 持续携带 local-first 与非本地权限约束。',
      expectedOutcome: 'success',
      scenarioTags: ['prompt', 'local-first', 'contract'],
      requiredFixtures: [],
      fixtureCopies: [],
      buildExecutionOutcome: () => ({
        status: 'completed',
        resultCode: 'ok',
        summary: 'prompt local-first contract completed'
      }),
      execute: async () => {
        const finalizePromptWithoutPermission = buildFinalizePrompt({
          userInput: '请总结这个目录里的规范',
          evidenceText: 'evidence',
          taskSummary: 'task summary',
          knownOutput: '',
          selectedScopeSummary: '1. workspace:docs | prepared=1 | unprepared=1',
          allowNonLocal: false,
          hasSelectedLocalSources: true
        })
        const finalizePromptWithPermission = buildFinalizePrompt({
          userInput: '请继续补充范围外信息',
          evidenceText: 'evidence',
          taskSummary: 'task summary',
          knownOutput: '',
          selectedScopeSummary: '1. workspace:docs | prepared=1 | unprepared=1',
          allowNonLocal: true,
          hasSelectedLocalSources: true
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
          finalizePromptWithoutPermission,
          finalizePromptWithPermission,
          humanPrompt
        }
      },
      assert: async (result, runtime) => {
        recordAssertion(runtime.assertions, {
          id: 'prompt.finalize-demands-non-local-permission',
          pass:
            result.finalizePromptWithoutPermission.system.includes(
              'mode=request_non_local_permission'
            ) &&
            result.finalizePromptWithoutPermission.system.includes('用户尚未允许使用非本地信息'),
          details: result.finalizePromptWithoutPermission.system
        })
        recordAssertion(runtime.assertions, {
          id: 'prompt.finalize-recognizes-allowed-non-local-path',
          pass:
            result.finalizePromptWithPermission.system.includes('用户已允许使用非本地信息') &&
            !result.finalizePromptWithPermission.system.includes('用户尚未允许使用非本地信息'),
          details: result.finalizePromptWithPermission.system
        })
        recordAssertion(runtime.assertions, {
          id: 'prompt.human-brain-keeps-local-first-constraints',
          pass:
            result.humanPrompt.system.includes('【local-first】') &&
            result.humanPrompt.system.includes('【范围不足】'),
          details: result.humanPrompt.system
        })
      }
    })
  })
})
