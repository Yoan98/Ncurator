import { test } from 'vitest'
import { buildBrainPromptContext } from '../../../../src/main/services/ai/human/prompts/brain'
import { buildMouthPromptContext } from '../../../../src/main/services/ai/human/prompts/mouth'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import type { HumanState } from '../../../../src/main/services/ai/human/types'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

const buildState = (): HumanState => {
  const state = createInitialHumanState({
    taskId: 'human-prompt-render',
    userInput: '整理项目风险并给出结论'
  })

  state.brainMemory.inside.facts.push({
    id: 'fact-risk-1',
    summary: '项目上线前需要复核风险项。',
    evidenceIds: ['evidence-risk-1']
  })
  state.brainMemory.inside.evidences.push({
    id: 'evidence-risk-1',
    toolName: 'kb_hybrid_search_chunks',
    summary: '知识库结果显示上线前需完成风险复核。',
    sourceType: 'tool_result',
    rawRef: 'tool_result#1'
  })
  state.brainMemory.inside.openQuestions.push('是否已有最终审批记录')
  state.brainMemory.outside.learnedSkillIds.push('kb-evidence-query')
  state.brainMemory.outside.brainDecisions.push({
    createdAt: 1,
    memoryOps: [],
    decision: {
      summary: '先补充证据',
      reason: '当前还缺少可以直接引用的依据。',
      expectedOutcome: '拿到证据后收敛判断。'
    },
    nextAction: {
      action: 'hand',
      parallelCallToolParam: [
        {
          toolName: 'kb_hybrid_search_chunks',
          args: {
            queryText: '项目风险复核要求'
          }
        }
      ]
    }
  })
  state.lastParallelCallToolResults = [
    {
      toolName: 'kb_hybrid_search_chunks',
      ok: true,
      code: 'ok',
      summary: '检索到 2 条相关证据。'
    }
  ]
  state.lastBrainDecision = {
    memoryOps: [],
    decision: {
      summary: '已经可以给出结论',
      reason: '关键事实已经得到证据支撑。',
      expectedOutcome: '进入最终整理输出。'
    },
    nextAction: {
      action: 'mouth'
    }
  }

  return state
}

test('prompt-context-rendering', async () => {
  await runBackendCase({
    caseId: 'prompt-context-rendering',
    caseType: 'basic',
    domain: 'ai',
    layer: 'backend',
    suite: 'human',
    description: 'brain and mouth prompt contexts keep the expected memory, skill, and decision sections after renderer extraction.',
    fixtures: [],
    runMode: 'repeatable',
    execute: async () => {
      const state = buildState()
      return {
        brainPrompt: buildBrainPromptContext(state),
        mouthPrompt: buildMouthPromptContext({
          state,
          deliveryMode: 'task_handoff'
        })
      }
    },
    assert: async (result, runtime) => {
      runtime.assertThat(result.brainPrompt.user.includes('已确认的事实：'), {
        name: 'brain-memory-section',
        message: 'brain prompt should keep the memory snapshot section title',
        data: result.brainPrompt
      })

      runtime.assertThat(result.brainPrompt.user.includes('证据 evidence-risk-1'), {
        name: 'brain-evidence-render',
        message: 'brain prompt should render evidence lines with ids after context renderer extraction',
        data: result.brainPrompt
      })

      runtime.assertThat(result.brainPrompt.user.includes('当前可用技能目录摘要：'), {
        name: 'brain-skill-section',
        message: 'brain prompt should keep the skill catalog section',
        data: result.brainPrompt
      })

      runtime.assertThat(result.brainPrompt.user.includes('工具 kb_hybrid_search_chunks'), {
        name: 'brain-tool-spec-render',
        message: 'brain prompt should render learned tool usage summaries',
        data: result.brainPrompt
      })

      runtime.assertThat(
        result.brainPrompt.user.includes('必填参数=[queryText:string]') &&
          result.brainPrompt.system.includes('"queryText": "项目风险控制要求"') &&
          !result.brainPrompt.system.includes('"query": "项目风险控制要求"'),
        {
          name: 'brain-tool-contract-render',
          message:
            'brain prompt should render the current required arg names and keep the built-in KB example aligned with queryText',
          data: result.brainPrompt
        }
      )

      runtime.assertThat(result.brainPrompt.user.includes('最近几轮已经做过的正式判断摘要'), {
        name: 'brain-decision-history',
        message: 'brain prompt should keep the recent decision history block',
        data: result.brainPrompt
      })

      runtime.assertThat(
        result.brainPrompt.user.includes('下面是最近一轮工具调用刚带回来的新信息') &&
          result.brainPrompt.user.includes('检索到 2 条相关证据。'),
        {
          name: 'brain-recent-tool-results',
          message:
            'brain prompt should still render the recent tool result block after prompt view consolidation',
          data: result.brainPrompt
        }
      )

      runtime.assertThat(result.mouthPrompt.user.includes('<facts>'), {
        name: 'mouth-facts-section',
        message: 'mouth prompt should still include the facts section wrapper',
        data: result.mouthPrompt
      })

      runtime.assertThat(result.mouthPrompt.user.includes('项目上线前需要复核风险项。'), {
        name: 'mouth-facts-render',
        message: 'mouth prompt should render fact summaries for final delivery',
        data: result.mouthPrompt
      })

      runtime.assertThat(result.mouthPrompt.user.includes('最终决定：“已经可以给出结论”'), {
        name: 'mouth-final-decision',
        message: 'mouth prompt should preserve the final decision summary text',
        data: result.mouthPrompt
      })
    }
  })
})
