import { describe, it } from 'vitest'
import { createBrainNode } from '../../../../src/main/services/ai/human/node/brainNode'
import { createHandNode } from '../../../../src/main/services/ai/human/node/handNode'
import { createLearningNode } from '../../../../src/main/services/ai/human/node/learningNode'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

describe('ai human basics backend', () => {
  it('basic-brain-memory-write-boundary', async () => {
    await runBackendCase({
      caseId: 'basic-brain-memory-write-boundary',
      domain: 'ai',
      suite: 'human',
      groups: ['basics'],
      description: '验证 brainMemory.inside 只由 brain 的 memoryOps 修改，hand 仅更新工具结果、artifact 和 trace。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const ctx = runtime.createAiRunContext({
          humanReasonOverrides: [
            {
              output: {
                memoryOps: [
                  {
                    op: 'add',
                    field: 'evidences',
                    value: {
                      id: 'evidence-1',
                      toolName: 'kb_hybrid_search_chunks',
                      summary: '第一轮 brain 已写入基础证据。',
                      sourceType: 'tool_result',
                      rawRef: 'seed-evidence'
                    }
                  },
                  {
                    op: 'add',
                    field: 'facts',
                    value: {
                      id: 'fact-1',
                      summary: '第一轮 brain 已确认一条事实。',
                      evidenceIds: ['evidence-1']
                    }
                  },
                  {
                    op: 'add',
                    field: 'openQuestions',
                    value: '还需要确认 terminal 产物是否已生成。'
                  }
                ],
                decision: {
                  summary: '先写入一轮初始记忆，再学习 workspace-cli。',
                  reason: '验证 inside 记忆先由 brain 建立，再由后续节点消费。',
                  expectedOutcome: '学习 skill 后准备调用 terminal 工具。'
                },
                nextAction: {
                  action: 'learning',
                  wantLearnSkillIds: ['workspace-cli']
                }
              }
            },
            {
              output: {
                action: 'invoke_tool',
                toolName: 'terminal_run_command',
                args: {
                  command: 'touch memory-boundary.txt',
                  expectedArtifacts: [
                    {
                      path: 'memory-boundary.txt',
                      operation: 'created'
                    }
                  ]
                },
                rationale: '调用一次会产生 artifact 的 terminal 工具，验证 hand 只改写工具结果和 runtimeArtifacts。',
                publicNarrative: '创建一个测试文件产物'
              }
            },
            {
              output: {
                memoryOps: [
                  {
                    op: 'add',
                    field: 'evidences',
                    value: {
                      id: 'evidence-2',
                      toolName: 'terminal_run_command',
                      summary: '第二轮 brain 根据上轮 terminal 结果补充了新证据。',
                      sourceType: 'tool_result',
                      rawRef: 'memory-boundary.txt'
                    }
                  },
                  {
                    op: 'add',
                    field: 'facts',
                    value: {
                      id: 'fact-2',
                      summary: '第二轮 brain 已确认 terminal 产物存在。',
                      evidenceIds: ['evidence-2']
                    }
                  },
                  {
                    op: 'edit',
                    field: 'openQuestions',
                    index: 0,
                    value: 'terminal 产物已确认，当前仅剩最终交付。'
                  }
                ],
                decision: {
                  summary: '消费 hand 的结果后，补充第二轮记忆并准备结束。',
                  reason: '验证只有进入下一轮 brain 时，inside 记忆才会继续变化。',
                  expectedOutcome: '最终进入 mouth 交付。'
                },
                nextAction: {
                  action: 'mouth'
                }
              }
            }
          ]
        })
        const cache = createHumanRuntimeCache()
        const task = {
          taskId: runtime.taskId,
          userInput: '请验证 brainMemory.inside 的写入边界。'
        }
        const brainNode = createBrainNode({ ctx, cache })
        const learningNode = createLearningNode({ ctx, cache })
        const handNode = createHandNode({ ctx, cache })

        const initialState = createInitialHumanState(task)
        const afterFirstBrain = await brainNode(initialState)
        const afterLearning = await learningNode(afterFirstBrain)
        const beforeHand = await brainNode(afterLearning)
        const afterHand = await handNode(beforeHand)
        const afterSecondBrain = await brainNode(afterHand)

        return {
          afterFirstBrain,
          afterLearning,
          beforeHand,
          afterHand,
          afterSecondBrain
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.afterFirstBrain.brainMemory.inside.evidences.length === 1 &&
            result.afterFirstBrain.brainMemory.inside.facts.length === 1 &&
            result.afterFirstBrain.brainMemory.inside.openQuestions.length === 1 &&
            result.afterLearning.brainMemory.outside.learnedSkillIds.includes('workspace-cli'),
          {
            name: 'first-brain-round-populates-inside-and-learning-keeps-it',
            message: '第一轮 brain 应建立 inside 记忆，learning 只扩展 learnedSkillIds，不应改写 inside 记忆。',
            data: {
              afterFirstBrainInside: result.afterFirstBrain.brainMemory.inside,
              afterLearningInside: result.afterLearning.brainMemory.inside,
              learnedSkillIds: result.afterLearning.brainMemory.outside.learnedSkillIds
            }
          }
        )

        runtime.assertThat(
          JSON.stringify(result.afterHand.brainMemory.inside) ===
            JSON.stringify(result.beforeHand.brainMemory.inside) &&
            result.afterHand.lastParallelCallToolResults?.[0]?.toolName === 'terminal_run_command' &&
            result.afterHand.runtimeArtifacts.length === 1 &&
            result.afterHand.trace.steps.length === result.beforeHand.trace.steps.length + 1,
          {
            name: 'hand-only-updates-tool-results-artifacts-and-trace',
            message: 'hand 执行工具后，inside 记忆应保持不变，只允许更新 lastParallelCallToolResults、runtimeArtifacts 和 trace。',
            data: {
              beforeHandInside: result.beforeHand.brainMemory.inside,
              afterHandInside: result.afterHand.brainMemory.inside,
              lastParallelCallToolResults: result.afterHand.lastParallelCallToolResults,
              runtimeArtifacts: result.afterHand.runtimeArtifacts
            }
          }
        )

        runtime.assertThat(
          result.afterSecondBrain.brainMemory.inside.evidences.length === 2 &&
            result.afterSecondBrain.brainMemory.inside.facts.length === 2 &&
            result.afterSecondBrain.brainMemory.inside.openQuestions[0] ===
              'terminal 产物已确认，当前仅剩最终交付。',
          {
            name: 'inside-memory-changes-only-after-next-brain-round',
            message: '只有回到下一轮 brain 后，facts、evidences 和 openQuestions 才应继续发生变化。',
            data: {
              afterHandInside: result.afterHand.brainMemory.inside,
              afterSecondBrainInside: result.afterSecondBrain.brainMemory.inside
            }
          }
        )
      }
    })
  })
})
