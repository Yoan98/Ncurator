import { describe, it } from 'vitest'
import { updateSessionMemoryAfterRun } from '../../../../src/main/services/ai/memory'
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
              timestamp: startedAt + 1
            }
          ],
          memory: {
            rollingSummary: '用户正在连续处理发布准备事项；上一轮发现缺少回滚负责人。',
            recentTaskSummaries: []
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
                  newTask?: {
                    userInput?: string
                    artifacts?: Array<{ summary?: string }>
                  }
                }
                return {
                  rollingSummary: [
                    parsed.previousRollingSummary,
                    parsed.newTask?.userInput,
                    parsed.newTask?.artifacts?.[0]?.summary
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
                  user.includes('请继续检查风险项') &&
                  user.includes('风险项草稿')
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
            result.savedMemory?.recentTaskSummaries.length === 1 &&
            result.savedMemory.recentTaskSummaries[0].artifacts[0]?.summary === '风险项草稿' &&
            result.promptContainsSessionMemory,
          {
            name: 'session-memory-uses-new-shape-and-enters-brain-prompt',
            message: 'session memory 应保存 rollingSummary + recentTaskSummaries，并在下一次 brain prompt 中出现。',
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
})
