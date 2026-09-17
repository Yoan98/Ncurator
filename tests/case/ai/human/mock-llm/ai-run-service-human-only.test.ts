import { describe, it } from 'vitest'
import { AiRunService } from '../../../../../src/main/services/ai/AiRunService'
import { AiFileChangeService } from '../../../../../src/main/services/ai/fileChanges/AiFileChangeService'
import { terminalSessionManager } from '../../../../../src/main/services/ai/human/tools/terminal/TerminalSessionManager'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { createScriptedStructuredOutputDriver } from '../../../../harness/backend/scriptedStructuredOutputDriver'
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
        const aiFileChangeService = new AiFileChangeService(runtime.storageService.aiFileChange)
        await runtime.chatStore.savePartner({
          id: 'human-only-session',
          name: 'human only session',
          avatar_shape: 'circle',
          avatar_color: 'blue',
          created_at: Date.now(),
          updated_at: Date.now(),
          last_viewed_at: Date.now(),
          pinned: false,
          pinned_at: null
        })
        const result = await AiRunService.getInstance().run(
          {
            runId: runtime.runId,
            partnerId: 'human-only-session',
            input: '请学习一个 skill，调用一次工具，然后直接给出最终答复。',
            mainModel: {
              configId: 'mock-llm-scripted',
              modelName: 'scripted-llm'
            },
            partnerName: '测试伙伴',
            workspaceRoots: [runtime.workspaceRoot]
          },
          {
            runtimeSettings,
            llmStore: runtime.llmStore,
            partnerStore: runtime.chatStore,
            chatMessageLogStore: runtime.storageService.chatMessageLog,
            documentsStore: runtime.documentsStore,
            embeddingService: runtime.embeddingService,
            ensureEmbeddingReady: async () => {
              await runtime.ensureEmbeddingReady()
            },
            docxApplyService: runtime.docxApplyService,
            saveFileChangeRecord: async (record) => {
              await aiFileChangeService.saveRecord(record)
            },
            listFileChangeRecords: async (request) =>
              (await aiFileChangeService.listRecords(request)).items,
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
                    summary: '已验证 run 入口直接进入 human。',
                    deliveryMarkdown: '# Human Only\n\nAiRunService 已直接进入 human 并完成最终交付。'
                  })
                }
              ]
            })
          }
        )
        await terminalSessionManager.closeByChatSession('human-only-session')

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
        const processGroupStartedEvents = filterAiRunEventsByType(
          result.events,
          'assistant_process_group_started'
        )
        const processGroupCompletedEvents = filterAiRunEventsByType(
          result.events,
          'assistant_process_group_completed'
        )
        const processItemStartedEvents = filterAiRunEventsByType(
          result.events,
          'assistant_process_item_started'
        )
        const processItemCompletedEvents = filterAiRunEventsByType(
          result.events,
          'assistant_process_item_completed'
        )
        const processThoughtEvents = filterAiRunEventsByType(
          result.events,
          'assistant_process_thought'
        )
        const stages = new Set(humanSteps.map((event) => event.stage))

        runtime.assertThat(
          result.result.status === 'completed' &&
            result.result.finalDeliveryMarkdown?.includes('Human Only') === true &&
            stages.has('human_brain') &&
            stages.has('human_learning') &&
            stages.has('human_hand'),
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

        runtime.assertThat(answerCompletedEvents.length === 1 && runCompletedEvents.length === 0, {
          name: 'ai-run-service-leaves-run-lifecycle-to-ipc-layer',
          message: 'AiRunService 本身应只产出 human 结果，不直接发 run_completed 事件。',
          data: {
            answerCompletedCount: answerCompletedEvents.length,
            runCompletedCount: runCompletedEvents.length
          }
        })

        const learningItemStarted = processItemStartedEvents.find(
          (event) => event.display.kind === 'tool' && event.display.toolName === 'learn_skill'
        )
        const learningGroupStarted = processGroupStartedEvents.find(
          (event) => event.groupId === learningItemStarted?.groupId
        )
        const learningGroupCompleted = processGroupCompletedEvents.find(
          (event) => event.groupId === learningItemStarted?.groupId
        )
        const learningStartedIndex = learningGroupStarted
          ? result.events.indexOf(learningGroupStarted)
          : -1
        const learningCompletedIndex = learningGroupCompleted
          ? result.events.indexOf(learningGroupCompleted)
          : -1
        const terminalGroupStarted = processGroupStartedEvents.find(
          (event) =>
            event.kind === 'skill' &&
            event.display.kind === 'tool' &&
            event.display.toolName === 'terminal_run'
        )
        const terminalItemStarted = processItemStartedEvents.find(
          (event) => event.display.kind === 'tool' && event.display.toolName === 'terminal_run'
        )
        const terminalItemCompleted = processItemCompletedEvents.find(
          (event) => event.itemId === terminalItemStarted?.itemId
        )
        const thinkingStartedEvents = processGroupStartedEvents.filter(
          (event) => event.display.kind === 'thinking'
        )
        const thinkingCompletedEvents = processGroupCompletedEvents.filter(
          (event) => event.display?.kind === 'thinking'
        )
        const thoughtsHaveClosedThinking = processThoughtEvents.every((thoughtEvent) => {
          const thoughtIndex = result.events.indexOf(thoughtEvent)
          let lastThinkingStartedIndex = -1
          let lastThinkingCompletedIndex = -1
          for (let index = 0; index < thoughtIndex; index += 1) {
            const event = result.events[index]
            if (
              event.type === 'assistant_process_group_started' &&
              event.display.kind === 'thinking'
            ) {
              lastThinkingStartedIndex = index
            }
            if (
              event.type === 'assistant_process_group_completed' &&
              event.display?.kind === 'thinking'
            ) {
              lastThinkingCompletedIndex = index
            }
          }
          return (
            lastThinkingStartedIndex >= 0 && lastThinkingCompletedIndex > lastThinkingStartedIndex
          )
        })

        runtime.assertThat(
          learningStartedIndex >= 0 &&
            learningCompletedIndex > learningStartedIndex &&
            Boolean(terminalGroupStarted) &&
            Boolean(terminalItemStarted) &&
            Boolean(terminalItemCompleted) &&
            thinkingStartedEvents.length === thinkingCompletedEvents.length &&
            thinkingCompletedEvents.length >= processThoughtEvents.length &&
            thoughtsHaveClosedThinking &&
            processThoughtEvents.some((event) => event.text.includes('先学习 docx-read')) &&
            processItemStartedEvents.every((event) => event.display.kind === 'tool'),
          {
            name: 'assistant-process-events-follow-human-lifecycle',
            message:
              'Assistant process 协议应按 human 生命周期发出公开思路、learn_skill 与 hand 工具组/工具项事件，最终交付不作为过程项展示。',
            data: {
              processThoughts: processThoughtEvents.map((event) => ({
                thoughtId: event.thoughtId,
                text: event.text
              })),
              processGroupStarted: processGroupStartedEvents.map((event) => ({
                groupId: event.groupId,
                kind: event.kind,
                display: event.display
              })),
              processGroupCompleted: processGroupCompletedEvents.map((event) => ({
                groupId: event.groupId,
                display: event.display
              })),
              thinkingStartedCount: thinkingStartedEvents.length,
              thinkingCompletedCount: thinkingCompletedEvents.length,
              processItemsStarted: processItemStartedEvents.map((event) => ({
                groupId: event.groupId,
                itemId: event.itemId,
                display: event.display
              })),
              processItemsCompleted: processItemCompletedEvents.map((event) => ({
                groupId: event.groupId,
                itemId: event.itemId,
                display: event.display
              }))
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
