import { describe, it } from 'vitest'
import { AiRunService } from '../../../../src/main/services/ai/AiRunService'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { createScriptedStructuredOutputDriver } from '../../../harness/backend/scriptedStructuredOutputDriver'
import {
  buildCompleteTaskDecision,
  buildLearnSkillsDecision,
  buildToolDecision,
  filterAiRunEventsByType,
  summarizeHumanSteps
} from '../testUtils'

describe('ai human mock-llm backend', () => {
  it('ai-run-service-human-only', async () => {
    await runBackendCase({
      caseId: 'ai-run-service-human-only',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证 AiRunService 会直接进入真实 human graph，而不再经过旧编排层。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const runtimeSettings = await runtime.storageService.aiRuntimeSettings.get()
        const result = await AiRunService.getInstance().run(
          {
            runId: runtime.runId,
            sessionId: 'human-only-session',
            input: '请学习一个 skill，调用一次工具，然后直接给出最终答复。',
            modelName: 'scripted-llm',
            workspace: {
              workspaceId: 'test-workspace',
              workspaceName: 'test-workspace',
              rootPath: runtime.workspaceRoot
            }
          },
          {
            runtimeSettings,
            llmStore: runtime.llmStore,
            chatStore: runtime.chatStore,
            documentsStore: runtime.documentsStore,
            embeddingService: runtime.embeddingService,
            ensureEmbeddingReady: async () => {
              await runtime.ensureEmbeddingReady()
            },
            docxApplyService: runtime.docxApplyService,
            isCancelled: () => false,
            sendEvent: (event) => runtime.eventCollector.add(event),
            recordLlmIo: (record) => runtime.eventCollector.addLlmIo(record),
            requestApprovalBatch: async () => ({ accepted: true, decisions: [] }),
            llmDriver: createScriptedStructuredOutputDriver({
              'human.brain': [
                {
                  output: buildLearnSkillsDecision({
                    skillIds: ['docx-read'],
                    summary: '先学习 docx-read'
                  })
                },
                {
                  output: buildToolDecision({
                    toolName: 'terminal_run',
                    args: {
                      command: 'pwd'
                    },
                    summary: '读取当前工作区路径'
                  })
                },
                {
                  output: buildCompleteTaskDecision({
                    summary: '已验证 run 入口直接进入 human。'
                  })
                }
              ],
              'human.mouth': [
                {
                  text: '# Human Only\n\nAiRunService 已直接进入 human 并完成最终交付。'
                }
              ]
            })
          }
        )

        return {
          result,
          events: runtime.eventCollector.snapshot(),
          llmIoRecords: runtime.eventCollector.snapshotLlmIo()
        }
      },
      assert: async (result, runtime) => {
        const humanSteps = filterAiRunEventsByType(result.events, 'human_step')
        const runCompletedEvents = filterAiRunEventsByType(result.events, 'run_completed')
        const answerCompletedEvents = filterAiRunEventsByType(result.events, 'answer_completed')
        const stages = new Set(humanSteps.map((event) => event.stage))

        runtime.assertThat(
          result.result.status === 'completed' &&
            result.result.finalDeliveryMarkdown?.includes('Human Only') === true &&
            stages.has('human_brain') &&
            stages.has('human_learning') &&
            stages.has('human_hand') &&
            stages.has('human_mouth'),
          {
            name: 'ai-run-service-goes-directly-through-human',
            message: 'AiRunService 应直接通过 human 完成 run，而不是依赖旧编排层。',
            data: {
              stages: Array.from(stages),
              finalDeliveryMarkdown: result.result.finalDeliveryMarkdown,
              steps: summarizeHumanSteps(result.events)
            }
          }
        )

        runtime.assertThat(
          answerCompletedEvents.length === 1 && runCompletedEvents.length === 0,
          {
            name: 'ai-run-service-leaves-run-lifecycle-to-ipc-layer',
            message: 'AiRunService 本身应只产出 human 结果，不直接发 run_completed 事件。',
            data: {
              answerCompletedCount: answerCompletedEvents.length,
              runCompletedCount: runCompletedEvents.length
            }
          }
        )

        runtime.assertThat(
          result.llmIoRecords.length >= 1 &&
            result.llmIoRecords.every((record) => record.model === 'scripted-llm'),
          {
            name: 'ai-run-service-uses-requested-runtime-model-name',
            message:
              'AiRunService 应使用 payload.modelName 构造运行时模型配置，而不是依赖持久配置中的模型字段。',
            data: {
              models: result.llmIoRecords.map((record) => record.model)
            }
          }
        )
      }
    })
  })
})
