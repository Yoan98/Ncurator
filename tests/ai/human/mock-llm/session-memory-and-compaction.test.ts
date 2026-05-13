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
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { createScriptedStructuredOutputDriver } from '../../../harness/backend/scriptedStructuredOutputDriver'
import {
  buildCompleteTaskDecision,
  buildLearnSkillsDecision,
  buildToolDecision,
  filterAiRunEventsByType
} from '../testUtils'

describe('ai human mock-llm backend', () => {
  it('session-memory-update-and-prompt', async () => {
    await runBackendCase({
      caseId: 'session-memory-update-and-prompt',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证 run 完成后写入新的 ChatSessionMemory，并在下一次 brain prompt 中渲染 session_memory。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const sessionId = 'memory-session'
        const startedAt = Date.now()
        await runtime.seedChatHistory({
          sessionId,
          messages: [
            {
              id: 'm1',
              role: 'user',
              content: '上一轮：请检查发布清单。',
              timestamp: startedAt
            },
            {
              id: 'm2',
              role: 'assistant',
              content: '上一轮完成：清单缺少回滚负责人。',
              timestamp: startedAt + 1,
              artifacts: [
                {
                  kind: 'file',
                  capability: 'docx',
                  artifactRole: 'draft',
                  path: '/workspace/rollback-owner.docx',
                  fileName: 'rollback-owner.docx',
                  operation: 'created',
                  summary: '回滚负责人草稿'
                }
              ]
            }
          ],
          memory: {
            rollingSummary: '用户正在连续处理发布准备事项；上一轮发现缺少回滚负责人。'
          }
        })

        await updateSessionMemoryAfterRun({
          runId: runtime.runId,
          sessionId,
          userInput: '请继续检查风险项。',
          assistantOutput: '已确认风险项需要补充回滚负责人。',
          artifacts: [
            {
              kind: 'file',
              capability: 'docx',
              artifactRole: 'draft',
              path: '/workspace/risk.docx',
              fileName: 'risk.docx',
              operation: 'created',
              summary: '风险项草稿'
            }
          ],
          runtimeSettings: await runtime.storageService.aiRuntimeSettings.get(),
          chatStore: runtime.chatStore,
          llmStore: runtime.llmStore,
          modelName: 'scripted-llm',
          sendEvent: (event) => runtime.eventCollector.add(event),
          recordLlmIo: (record) => runtime.eventCollector.addLlmIo(record),
          llmDriver: createScriptedStructuredOutputDriver({
            'session.memory': [
              ({ user }) => {
                const parsed = JSON.parse(user) as {
                  previousRollingSummary?: string
                  latestUserMessage?: string
                  latestArtifacts?: Array<{ summary?: string }>
                }
                return {
                  rollingSummary: [
                    parsed.previousRollingSummary,
                    parsed.latestUserMessage,
                    parsed.latestArtifacts?.[0]?.summary
                  ].filter(Boolean).join(' / ')
                }
              }
            ]
          })
        })

        const savedMemory = await runtime.chatStore.getSessionMemory(sessionId)
        let promptContainsSessionMemory = false
        const runner = createHumanTestRunner(runtime, {
          sessionId,
          structuredOutputScript: {
            'human.brain': [
              ({ user }) => {
                promptContainsSessionMemory =
                  user.includes('<session_memory>') &&
                  user.includes('用户正在连续处理发布准备事项') &&
                  user.includes('<recent_conversation>') &&
                  user.includes('上一轮完成：清单缺少回滚负责人。') &&
                  user.includes('回滚负责人草稿')
                return buildCompleteTaskDecision({
                  summary: '已读取 session memory。'
                })
              }
            ],
            'human.mouth': [
              {
                text: '# Session Memory\n\n已读取 session memory。'
              }
            ]
          }
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '基于上次任务继续说明下一步。'
        })

        return {
          output,
          savedMemory,
          promptContainsSessionMemory
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.output.status === 'completed' &&
            Boolean(result.savedMemory?.rollingSummary.includes('请继续检查风险项')) &&
            result.promptContainsSessionMemory,
          {
            name: 'session-memory-uses-new-shape-and-enters-brain-prompt',
            message: 'session memory 应只保存 rollingSummary，并在下一次 brain prompt 中与 recent_conversation 一起出现。',
            data: {
              savedMemory: result.savedMemory,
              promptContainsSessionMemory: result.promptContainsSessionMemory
            }
          }
        )
      }
    })
  }, 15_000)

  it('context-compaction-history-block', async () => {
    await runBackendCase({
      caseId: 'context-compaction-history-block',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '用低上下文窗口触发压缩，验证事件流出现压缩状态且后续 prompt 使用 compact_blocks。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        let compactedPromptSeen = false
        const runner = createHumanTestRunner(runtime, {
          humanRuntimeOverrides: {
            modelContextWindowTokens: 5_000
          },
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['docx-read'],
                  summary: '先学习 docx-read 以产生可压缩历史。'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'terminal_run',
                  args: {
                    command: 'pwd'
                  },
                  summary: '再调用 terminal_run 以产生最新历史。'
                })
              },
              ({ user }) => {
                compactedPromptSeen =
                  user.includes('<compact_blocks>') &&
                  user.includes('已压缩：学习 docx-read 的较早过程。') &&
                  !user.includes('先学习 docx-read 以产生可压缩历史。')
                return buildCompleteTaskDecision({
                  summary: '压缩后继续完成。'
                })
              }
            ],
            'human.memory_compaction': [
              {
                text: '已压缩：学习 docx-read 的较早过程。'
              }
            ],
            'human.mouth': [
              {
                text: '# Compaction\n\n压缩后继续完成。'
              }
            ]
          }
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请先学习能力，再调用一次工具，然后完成一个需要压缩上下文的长任务。'.repeat(60)
        })
        const events = runtime.eventCollector.snapshot()

        return {
          output,
          events,
          llmIoRecords: runtime.eventCollector.snapshotLlmIo(),
          compactedPromptSeen
        }
      },
      assert: async (result, runtime) => {
        const startedEvents = filterAiRunEventsByType(result.events, 'context_compaction_started')
        const completedEvents = filterAiRunEventsByType(result.events, 'context_compaction_completed')
        const compactionCalls = result.llmIoRecords.filter(
          (record) => record.caller === 'human.memory_compaction'
        )

        runtime.assertThat(
          result.output.status === 'completed' &&
            startedEvents.length === 1 &&
            completedEvents.length === 1 &&
            compactionCalls.length === 1 &&
            result.compactedPromptSeen,
          {
            name: 'context-compaction-routes-through-history-compact-block',
            message: '低阈值应触发 memory_compaction，并在后续 brain prompt 中以 compact_blocks 继续渲染。',
            data: {
              startedEvents,
              completedEvents,
              compactionCallCount: compactionCalls.length,
              compactedPromptSeen: result.compactedPromptSeen
            }
          }
        )
      }
    })
  }, 15_000)

  it('context-compaction-rolls-history-block-forward', async () => {
    await runBackendCase({
      caseId: 'context-compaction-rolls-history-block-forward',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证多轮压缩时会把旧 history compact summary 与新历史一起输入，并始终只保留一个 history compact block。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const ctx = runtime.createAiRunContext({
          humanRuntimeOverrides: {
            modelContextWindowTokens: 5_000
          },
        })
        const cache = createHumanRuntimeCache()
        const compactionNode = createMemoryCompactionNode({ ctx, cache })
        const baseState = createInitialHumanState({
          taskId: runtime.taskId,
          userInput: '请完成一个会触发两次历史压缩的长任务。'
        })
        const stateWithRound1 = {
          ...baseState,
          execution: {
            ...baseState.execution,
            contextBudget: {
              tokenEstimate: 6_000,
              contextWindowTokens: 7_000,
              triggerTokens: 5_600
            }
          },
          memory: {
            ...baseState.memory,
            history: appendRoundRecord({
              state: baseState,
              thought: {
                thought: {
                  summary: '第一轮先学习。'
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
        const stateWithRound2 = {
          ...stateWithRound1,
          memory: {
            ...stateWithRound1.memory,
            history: appendRoundRecord({
              state: stateWithRound1,
              thought: {
                thought: {
                  summary: '第二轮执行一次工具。'
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
                      outputPreview: runtime.workspaceRoot,
                      cwd: runtime.workspaceRoot,
                      command: 'pwd',
                      exitCode: 0,
                      timedOut: false,
                      truncated: false
                    }
                  }
                ]
              }),
              createdAt: 2
            })
          }
        }
        const stateWithLatestRound = {
          ...stateWithRound2,
          memory: {
            ...stateWithRound2.memory,
            history: appendRoundRecord({
              state: stateWithRound2,
              thought: {
                thought: {
                  summary: '第三轮再执行一次工具，制造第二次压缩。'
                },
                nextAction: {
                  action: 'hand',
                  toolUsePlan: {
                    mode: 'serial',
                    calls: [
                      {
                        toolName: 'terminal_run',
                        args: {
                          command: 'ls'
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
                        command: 'ls'
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
                      outputPreview: '(no output)',
                      cwd: runtime.workspaceRoot,
                      command: 'ls',
                      exitCode: 0,
                      timedOut: false,
                      truncated: false
                    }
                  }
                ]
              }),
              createdAt: 3
            })
          }
        }

        const compactionInputs: string[] = []
        let index = 0
        const originalChatText = ctx.chatText
        ctx.chatText = async (input) => {
          if (input.caller === 'human.memory_compaction') {
            compactionInputs.push(input.user)
            index += 1
            return index === 1
              ? '第一次压缩摘要：已完成学习阶段。'
              : '第二次压缩摘要：已完成学习阶段，并执行过 pwd。'
          }
          return await originalChatText(input)
        }

        const compactedOnce = await compactionNode(stateWithRound2)
        const compactedTwice = await compactionNode({
          ...stateWithLatestRound,
          memory: {
            ...stateWithLatestRound.memory,
            history: {
              ...stateWithLatestRound.memory.history,
              compactBlocks: compactedOnce.memory.history.compactBlocks
            }
          }
        })

        return {
          compactionInputs,
          compactedTwice
        }
      },
      assert: async (result, runtime) => {
        const secondPrompt = result.compactionInputs[1] || ''
        const historyBlocks = result.compactedTwice.memory.history.compactBlocks
        const historyBlock = historyBlocks.find((block) => block.kind === 'history')

        runtime.assertThat(
          result.compactionInputs.length === 2 &&
            secondPrompt.includes('第一次压缩摘要：已完成学习阶段。') &&
            historyBlocks.length === 1 &&
            historyBlock?.summary === '第二次压缩摘要：已完成学习阶段，并执行过 pwd。' &&
            historyBlock.source.roundIds.join(',') === '1,2' &&
            result.compactedTwice.memory.history.roundHistory.length === 1,
          {
            name: 'context-compaction-rolling-merge-keeps-single-history-block',
            message: '第二轮压缩应带入第一轮摘要，且最终 prompt 中只保留最新的单个 history compact block。',
            data: {
              compactionInputs: result.compactionInputs,
              compactBlocks: historyBlocks,
              remainingRounds: result.compactedTwice.memory.history.roundHistory
            }
          }
        )
      }
    })
  }, 15_000)
})
