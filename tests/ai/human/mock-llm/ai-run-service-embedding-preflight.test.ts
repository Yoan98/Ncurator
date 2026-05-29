import { describe, it } from 'vitest'
import { AiRunService } from '../../../../src/main/services/ai/AiRunService'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { createScriptedStructuredOutputDriver } from '../../../harness/backend/scriptedStructuredOutputDriver'
import { writeTestDocxFile } from '../../../harness/backend/aiToolHarness'
import type { DocxSearchResult } from '../../tool/docx/testUtils'
import {
  buildCompleteTaskDecision,
  buildLearnSkillsDecision,
  buildToolDecision,
  filterAiRunEventsByType,
  readLatestToolResultDataFromEvents
} from '../testUtils'

describe('ai human mock-llm backend', () => {
  it('ai-run-service-embedding-preflight', async () => {
    await runBackendCase({
      caseId: 'ai-run-service-embedding-preflight',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证 AiRunService 会在进入 human 前完成 embedding preflight，并支撑后续 docx 读取。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'semantic-docx.docx', [
          {
            type: 'paragraph',
            text: '反走样是在采样不足时出现的锯齿现象。'
          }
        ])

        let ensureReadyCalls = 0
        const initialEmbeddingStatus = runtime.embeddingService.getStatus()
        const runtimeSettings = await runtime.storageService.aiRuntimeSettings.get()
        const result = await AiRunService.getInstance().run(
          {
            runId: runtime.runId,
            sessionId: 'embedding-preflight-session',
            input: '请读取 docx，找到反走样相关内容。',
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
              ensureReadyCalls += 1
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
                    toolName: 'docx_search',
                    args: {
                      sourcePath: 'semantic-docx.docx',
                      query: '边缘锯齿怎么处理',
                      mode: 'semantic'
                    },
                    summary: '做语义搜索'
                  })
                },
                {
                  output: buildCompleteTaskDecision({
                    summary: 'embedding preflight 已验证。'
                  })
                }
              ],
              'human.mouth': [
                {
                  output: {
                    summary: 'embedding preflight 已验证。',
                    deliveryMarkdown: '# Embedding Preflight\n\ndocx 读取链路已可用。'
                  }
                }
              ]
            })
          }
        )

        return {
          result,
          ensureReadyCalls,
          initialEmbeddingStatus,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const docxSearchResult = readLatestToolResultDataFromEvents<DocxSearchResult>(
          result.events,
          'docx_search'
        )

        runtime.assertThat(
            result.initialEmbeddingStatus === 'uninitialized' &&
            result.ensureReadyCalls === 1 &&
            result.result.status === 'completed' &&
            docxSearchResult.mode === 'semantic' &&
            docxSearchResult.matches.length >= 1 &&
            typeof docxSearchResult.matches[0]?.score === 'number',
          {
            name: 'ai-run-service-preflights-embedding-before-human',
            message: 'AiRunService 应在进入 human 前完成 embedding preflight，并让后续 docx semantic 搜索直接可用。',
            data: {
              initialEmbeddingStatus: result.initialEmbeddingStatus,
              ensureReadyCalls: result.ensureReadyCalls,
              docxSearchResult,
              finalStatus: result.result.status
            }
          }
        )
      }
    })
  })

  it('ai-run-service-embedding-preflight-failure', async () => {
    await runBackendCase({
      caseId: 'ai-run-service-embedding-preflight-failure',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证 embedding preflight 失败时，AiRunService 会在进入 human 前直接失败收口。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const runtimeSettings = await runtime.storageService.aiRuntimeSettings.get()
        const result = await AiRunService.getInstance().run(
          {
            runId: runtime.runId,
            sessionId: 'embedding-preflight-failure-session',
            input: '这轮不应该进入 human。',
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
              throw new Error('embedding preflight failed for test')
            },
            docxApplyService: runtime.docxApplyService,
            isCancelled: () => false,
            sendEvent: (event) => runtime.eventCollector.add(event),
            recordLlmIo: (record) => runtime.eventCollector.addLlmIo(record),
            requestApprovalBatch: async () => ({ accepted: true, decisions: [] }),
            llmDriver: createScriptedStructuredOutputDriver({})
          }
        )

        return {
          result,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const humanSteps = filterAiRunEventsByType(result.events, 'human_step')

        runtime.assertThat(
          result.result.status === 'failed' &&
            result.result.error?.includes('embedding preflight failed for test') === true &&
            humanSteps.length === 0,
          {
            name: 'ai-run-service-aborts-before-human-on-preflight-failure',
            message: 'embedding preflight 失败时，run 应直接失败，且不进入任何 human stage。',
            data: {
              status: result.result.status,
              error: result.result.error,
              humanStepCount: humanSteps.length
            }
          }
        )
      }
    })
  })
})
