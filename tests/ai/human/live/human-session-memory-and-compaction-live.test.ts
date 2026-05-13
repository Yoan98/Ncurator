import { describe, it } from 'vitest'
import { updateSessionMemoryAfterRun } from '../../../../src/main/services/ai/memory'
import {
  appendRoundRecord,
  buildHandExecution,
  buildLearningExecution
} from '../../../../src/main/services/ai/human/memory/roundHistory'
import { createMemoryCompactionNode } from '../../../../src/main/services/ai/human/node/memoryCompactionNode'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import { loadLiveLlmConfigFromEnv, hasLiveLlmConfigInEnv } from '../../../harness/backend/llmConfig'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { filterAiRunEventsByType } from '../testUtils'

describe('ai human live backend', () => {
  it('human-session-memory-and-compaction-live', async () => {
    await runBackendCase({
      caseId: 'human-session-memory-and-compaction-live',
      harnessMode: 'live',
      domain: 'ai',
      suite: 'human',
      groups: ['live'],
      description: '验证 live 模式下 session memory 总结与 human history 压缩节点都能真实调用模型并写回结构化结果。',
      fixtures: [],
      runMode: 'single',
      runtimeModelName: hasLiveLlmConfigInEnv() ? loadLiveLlmConfigFromEnv().model_name : null,
      execute: async (runtime) => {
        if (!hasLiveLlmConfigInEnv()) {
          return {
            skipped: true,
            savedRollingSummary: '',
            compactBlockCount: 0,
            remainingRoundCount: 0,
            events: []
          }
        }

        const liveConfig = loadLiveLlmConfigFromEnv()
        await runtime.seedLlmConfig(liveConfig)
        const sessionId = 'live-memory-session'
        await runtime.seedChatHistory({
          sessionId,
          messages: [
            {
              id: 'live-user-1',
              role: 'user',
              content: '请记录发布准备事项。',
              timestamp: Date.now()
            }
          ],
          memory: {
            rollingSummary: '用户正在围绕发布准备事项连续推进。'
          }
        })

        await updateSessionMemoryAfterRun({
          runId: runtime.runId,
          sessionId,
          userInput: '第一轮确认：发布前还缺少回滚负责人。',
          assistantOutput: '已确认发布前需要补齐回滚负责人。',
          artifacts: [],
          runtimeSettings: await runtime.storageService.aiRuntimeSettings.get(),
          chatStore: runtime.chatStore,
          llmStore: runtime.llmStore,
          modelName: liveConfig.model_name,
          sendEvent: (event) => runtime.eventCollector.add(event),
          recordLlmIo: (record) => runtime.eventCollector.addLlmIo(record)
        })

        const savedMemory = await runtime.chatStore.getSessionMemory(sessionId)
        const ctx = runtime.createAiRunContext({
          sessionId,
          modelName: liveConfig.model_name
        })
        const cache = createHumanRuntimeCache()
        const compactionNode = createMemoryCompactionNode({ ctx, cache })
        const initialState = createInitialHumanState({
          taskId: runtime.taskId,
          userInput: '请继续推进发布准备事项。'
        })
        const stateWithOneRound = {
          ...initialState,
          memory: {
            ...initialState.memory,
            history: appendRoundRecord({
              state: initialState,
              thought: {
                thought: {
                  next: '先学习 docx-read，确认文档读取能力。'
                },
                nextAction: {
                  action: 'learning',
                  wantLearnSkillIds: ['docx-read']
                }
              },
              execution: buildLearningExecution({
                learningOutcome: {
                  requestedSkillIds: ['docx-read'],
                  loadedSkillIds: ['docx-read'],
                  skippedDuplicateSkillIds: [],
                  skippedUnknownSkillIds: [],
                  evictedSkillIds: [],
                  activeToolCount: 4
                }
              }),
              createdAt: 1
            })
          }
        }
        const stateWithHistory = {
          ...stateWithOneRound,
          execution: {
            ...stateWithOneRound.execution,
            contextBudget: {
              tokenEstimate: 7_000,
              contextWindowTokens: 8_000,
              triggerTokens: 6_400
            }
          },
          memory: {
            ...stateWithOneRound.memory,
            history: appendRoundRecord({
              state: stateWithOneRound,
              thought: {
                thought: {
                  next: '再读取工作区路径，确认执行边界。'
                },
                nextAction: {
                  action: 'hand',
                  toolUsePlan: {
                    mode: 'serial',
                    calls: [
                      {
                        toolName: 'terminal_run',
                        args: {
                          command: 'pwd'
                        }
                      }
                    ]
                  }
                }
              },
              execution: buildHandExecution({
                toolUsePlan: {
                  mode: 'serial',
                  calls: [
                    {
                      toolName: 'terminal_run',
                      args: {
                        command: 'pwd'
                      }
                    }
                  ]
                },
                toolResults: [
                  {
                    toolName: 'terminal_run',
                    ok: true,
                    code: 'ok',
                    data: {
                      ok: true,
                      code: 'ok',
                      outputPreview: runtime.workspaceRoot
                    }
                  }
                ]
              }),
              createdAt: 2
            })
          }
        }

        const compactedState = await compactionNode(stateWithHistory)

        return {
          skipped: false,
          savedRollingSummary: savedMemory?.rollingSummary || '',
          compactBlockCount: compactedState.memory.history.compactBlocks.length,
          remainingRoundCount: compactedState.memory.history.roundHistory.length,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        if (result.skipped) {
          runtime.assertThat(true, {
            name: 'live-config-not-provided',
            message: '未提供 live 模型配置，已跳过 human session memory 与 compaction live case。'
          })
          return
        }

        const startedEvents = filterAiRunEventsByType(result.events, 'context_compaction_started')
        const completedEvents = filterAiRunEventsByType(result.events, 'context_compaction_completed')
        runtime.assertThat(
          result.savedRollingSummary.trim().length > 0 &&
            result.compactBlockCount === 1 &&
            result.remainingRoundCount === 1 &&
            startedEvents.length === 1 &&
            completedEvents.length === 1,
          {
            name: 'human-live-session-memory-and-compaction-ai-calls-complete',
            message: 'live session memory 与 memory compaction 应真实调用模型，并写回 session memory / compact block。',
            data: {
              savedRollingSummary: result.savedRollingSummary,
              compactBlockCount: result.compactBlockCount,
              remainingRoundCount: result.remainingRoundCount,
              startedEvents,
              completedEvents
            }
          }
        )
      }
    })
  }, 120_000)
})
