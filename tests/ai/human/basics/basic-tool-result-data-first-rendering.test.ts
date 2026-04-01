import { describe, it } from 'vitest'
import { buildBrainPromptContext } from '../../../../src/main/services/ai/human/prompts/brain'
import { renderHumanRecentToolResultLines } from '../../../../src/main/services/ai/human/shared/runtimeRenderers'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import type { HumanState } from '../../../../src/main/services/ai/human/types'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

describe('ai human basics backend', () => {
  it('basic-tool-result-data-first-rendering', async () => {
    await runBackendCase({
      caseId: 'basic-tool-result-data-first-rendering',
      domain: 'ai',
      suite: 'human',
      groups: ['basics'],
      description:
        '验证 brain prompt 与 fallback 展示都基于 ToolCallResult.data 渲染，不再依赖 tool summary。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const ctx = runtime.createAiRunContext()
        const initialState = createInitialHumanState({
          taskId: runtime.taskId,
          userInput: '请根据最近工具结果继续判断。'
        })
        const state: HumanState = {
          ...initialState,
          lastParallelCallToolResults: [
            {
              toolName: 'terminal_run_command',
              ok: true,
              code: 'ok',
              data: {
                ok: true,
                code: 'ok',
                outputPreview: 'Weekly risk summary: pending follow-up.',
                stdoutPreview: 'Weekly risk summary: pending follow-up.',
                stderrPreview: ''
              }
            },
            {
              toolName: 'kb_hybrid_search_chunks',
              ok: false,
              code: 'failed',
              data: {
                items: [],
                total: 0,
                error: 'search backend timeout'
              }
            }
          ]
        }

        const prompt = buildBrainPromptContext({
          state,
          ctx
        })

        return {
          promptUser: prompt.user,
          fallbackToolLines: renderHumanRecentToolResultLines(state, 'fallback_markdown')
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.promptUser.includes('Weekly risk summary: pending follow-up.') &&
            result.promptUser.includes('search backend timeout') &&
            !result.promptUser.includes('undefined'),
          {
            name: 'brain-prompt-renders-readable-preview-from-tool-data',
            message:
              'brain prompt 应从 ToolCallResult.data 中提取可读预览，让模型直接看到最近工具返回的正文或错误信息。',
            data: {
              promptUser: result.promptUser
            }
          }
        )

        runtime.assertThat(
          result.fallbackToolLines.includes('调用工具 terminal_run_command（成功）') &&
            result.fallbackToolLines.includes('调用工具 kb_hybrid_search_chunks（失败）'),
          {
            name: 'fallback-tool-lines-use-generic-success-failure-copy',
            message:
              'fallback/trace 对工具调用的展示应统一为通用成功失败文案，不再依赖 tool summary。',
            data: {
              fallbackToolLines: result.fallbackToolLines
            }
          }
        )
      }
    })
  })
})
