import fs from 'node:fs/promises'
import { describe, it } from 'vitest'
import { createBrainNode } from '../../../../src/main/services/ai/human/node/brainNode'
import { createHandNode } from '../../../../src/main/services/ai/human/node/handNode'
import { createLearningNode } from '../../../../src/main/services/ai/human/node/learningNode'
import { createMouthNode } from '../../../../src/main/services/ai/human/node/mouthNode'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import type { AiRunContextWithHumanOverrides } from '../../../../src/main/services/ai/human/types'
import { writeTestDocxFile } from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { createTestDocumentRecord, createTestSearchResult } from '../../tool/testHelpers'
import type {
  DocxApplyOpsResult,
  DocxOpenResult,
  DocxPreviewResult,
  DocxSearchResult
} from '../../tool/docx/testUtils'
import {
  buildHumanTaskOutputFromState,
  buildCompleteTaskDecision,
  buildLearnSkillsDecision,
  buildToolDecision,
  createCapturingDeliveryOverride,
  filterAiRunEventsByType,
  readToolCallInput,
  readSingleToolResultData,
  summarizeHumanSteps
} from '../testUtils'

type KbListDocumentsResult = {
  items: Array<{
    id: string
    name: string
  }>
  total: number
}

type KbSearchRow = {
  id: string
  text: string
  document_id?: string
  document_name: string
}

describe('ai human scenarios backend', () => {
  it('multi-tool-collaboration-simulated', async () => {
    await runBackendCase({
      caseId: 'multi-tool-collaboration-simulated',
      domain: 'ai',
      suite: 'human',
      groups: ['scenarios'],
      description: '验证 human 在单任务内联动 kb 与 docx 多类工具，完成资料检索后继续编辑文档。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'multi-tool-collaboration.docx', [
          {
            type: 'heading',
            text: 'Weekly Sync',
            level: 1
          },
          {
            type: 'paragraph',
            text: 'Weekly risk summary: TODO'
          }
        ])

        const documents = [
          createTestDocumentRecord({
            id: 'doc-1',
            name: 'Risk Playbook.md'
          }),
          createTestDocumentRecord({
            id: 'doc-2',
            name: 'Release Checklist.md'
          }),
          createTestDocumentRecord({
            id: 'doc-3',
            name: 'Out of Scope Notes.md'
          })
        ]
        const kbRows = [
          createTestSearchResult({
            id: 'chunk-1',
            text: 'approval blocked items must stay marked as pending follow-up',
            documentId: 'doc-1',
            documentName: 'Risk Playbook.md'
          }),
          createTestSearchResult({
            id: 'chunk-2',
            text: 'release checklist evidence should be cited when changing document status',
            documentId: 'doc-2',
            documentName: 'Release Checklist.md'
          }),
          createTestSearchResult({
            id: 'chunk-3',
            text: 'this row should stay out of scope',
            documentId: 'doc-3',
            documentName: 'Out of Scope Notes.md'
          })
        ]

        const delivery = createCapturingDeliveryOverride({
          summary: 'KB 检索与 docx 编辑协作链路已完成，并产出了预览。',
          buildMarkdown: ({ summary, state }) =>
            [
              '# 处理结果',
              '',
              summary,
              '',
              '## 当前产物',
              ...(
                state.runtimeArtifacts.length > 0
                  ? state.runtimeArtifacts.map((artifact) => `- ${artifact.summary}`)
                  : ['- 无']
              )
            ].join('\n')
        })
        const ctx = runtime.createAiRunContext({
          selectedDocumentIds: ['doc-1', 'doc-2'],
          humanDeliveryOverride: delivery.override,
          documentsStoreOverrides: {
            listDocuments: async () => ({
              items: documents,
              total: documents.length
            }),
            hybridSearch: async (_vec, _queryText, _limit, _sourceType, scopedDocumentIds) => {
              if (!Array.isArray(scopedDocumentIds) || scopedDocumentIds.length === 0) {
                return kbRows
              }
              const allowed = new Set(scopedDocumentIds)
              return kbRows.filter((row) => row.document_id && allowed.has(row.document_id))
            }
          }
        }) as AiRunContextWithHumanOverrides
        const cache = createHumanRuntimeCache()
        const brainNode = createBrainNode({ ctx, cache })
        const learningNode = createLearningNode({ ctx, cache })
        const handNode = createHandNode({ ctx, cache })
        const mouthNode = createMouthNode({
          ctx,
          cache,
          deliveryMode: 'user_answer',
          streamAnswer: false,
          internalDelivery: false
        })
        let state = createInitialHumanState({
          taskId: runtime.taskId,
          userInput: '先从资料里找风险结论，再把它写进周报文档并给我预览。'
        })

        ctx.resolveBrainDecisionOverride = () =>
          buildLearnSkillsDecision({
            skillIds: [
              'kb-document-discovery',
              'kb-evidence-query',
              'docx-read',
              'docx-write',
              'docx-delivery'
            ],
            summary: '先学习 KB 与 docx 相关 skill，准备做多工具协作。',
            reason: '该任务要先找资料，再落回文档编辑，因此需要同时掌握两类工具。',
            expectedOutcome: '开始列出可用资料。'
          })
        state = await brainNode(state)
        state = await learningNode(state)

        ctx.resolveBrainDecisionOverride = () =>
          buildToolDecision({
            toolName: 'kb_list_documents',
            args: {},
            summary: '先确认当前可用资料范围。',
            reason: '资料范围不清时应先通过 document discovery 收窄来源。',
            expectedOutcome: '找到候选文档后继续检索关键证据。'
          })
        state = await brainNode(state)
        state = await handNode(state)
        const listed = readSingleToolResultData<KbListDocumentsResult>(state, 'kb_list_documents')

        ctx.resolveBrainDecisionOverride = () =>
          buildToolDecision({
            toolName: 'kb_hybrid_search_chunks',
            args: {
              queryText: 'approval blocked risk summary',
              limit: 5,
              documentIds: ['doc-1', 'doc-3']
            },
            summary: '基于候选文档检索与风险总结相关的证据。',
            reason: '需要先拿到可直接落进文档的具体表述。',
            expectedOutcome: '拿到可复用证据后开始编辑 docx。'
          })
        state = await brainNode(state)
        state = await handNode(state)
        const kbPreview = readSingleToolResultData<KbSearchRow[]>(state, 'kb_hybrid_search_chunks')
        const replacement =
          kbPreview[0]?.text || 'approval blocked items must stay marked as pending follow-up'

        ctx.resolveBrainDecisionOverride = () =>
          buildToolDecision({
            toolName: 'docx_open',
            args: {
              sourcePath: 'multi-tool-collaboration.docx'
            },
            summary: '打开待更新的周报文档。',
            reason: '开始写入前需要先建立 docId。',
            expectedOutcome: '定位 TODO 占位符并准备替换。'
          })
        state = await brainNode(state)
        state = await handNode(state)
        const opened = readSingleToolResultData<DocxOpenResult>(state, 'docx_open')

        ctx.resolveBrainDecisionOverride = () =>
          buildToolDecision({
            toolName: 'docx_search',
            args: {
              docId: opened.docId,
              query: 'TODO',
              mode: 'literal'
            },
            summary: '定位周报中的 TODO 占位符。',
            reason: '需要确认当前占位是否存在，避免盲写。',
            expectedOutcome: '定位成功后使用 KB 结果完成替换。'
          })
        state = await brainNode(state)
        state = await handNode(state)
        const firstSearch = readSingleToolResultData<DocxSearchResult>(state, 'docx_search')

        ctx.resolveBrainDecisionOverride = () =>
          buildToolDecision({
            toolName: 'docx_apply_ops',
            args: {
              docId: opened.docId,
              ops: [
                {
                  type: 'replace_text',
                  query: 'TODO',
                  replace: replacement
                }
              ]
            },
            summary: '把 KB 检索结果写回 docx 占位符。',
            reason: '多工具协作的关键在于让 KB 中间结果可以继续被 docx 写入动作消费。',
            expectedOutcome: '写入完成后验证替换结果。'
          })
        state = await brainNode(state)
        state = await handNode(state)
        const applied = readSingleToolResultData<DocxApplyOpsResult>(state, 'docx_apply_ops')
        const applyInputFromEvents = readToolCallInput<{
          docId: string
          ops: Array<{
            type: string
            query?: string
            replace?: string
          }>
        }>(runtime.eventCollector.snapshot(), 'docx_apply_ops')

        ctx.resolveBrainDecisionOverride = () =>
          buildToolDecision({
            toolName: 'docx_search',
            args: {
              docId: applied.newDocId,
              query: 'pending follow-up',
              mode: 'literal'
            },
            summary: '回查文档，确认 KB 结果已被继续消费。',
            reason: '需要验证中间检索结果没有在 docx 链路中断掉。',
            expectedOutcome: '确认命中后进入 validate 与 preview。'
          })
        state = await brainNode(state)
        state = await handNode(state)
        const secondSearch = readSingleToolResultData<DocxSearchResult>(state, 'docx_search')

        ctx.resolveBrainDecisionOverride = () =>
          buildToolDecision({
            toolName: 'docx_validate',
            args: {
              docId: applied.newDocId
            },
            summary: '校验多工具协作后的文档结果。',
            reason: '写入后的文档必须保持结构稳定。',
            expectedOutcome: '校验通过后生成交付预览。'
          })
        state = await brainNode(state)
        state = await handNode(state)

        ctx.resolveBrainDecisionOverride = () =>
          buildToolDecision({
            toolName: 'docx_render_preview',
            args: {
              docId: applied.newDocId,
              format: 'html'
            },
            summary: '生成多工具协作后的文档预览。',
            reason: '场景任务必须完成到可回看的交付物。',
            expectedOutcome: '拿到 preview 后进入最终交付。'
          })
        state = await brainNode(state)
        state = await handNode(state)
        const preview = readSingleToolResultData<DocxPreviewResult>(state, 'docx_render_preview')

        ctx.resolveBrainDecisionOverride = () =>
          buildCompleteTaskDecision({
            summary: 'KB 检索与 docx 编辑协作链路已完成，并产出了预览。',
            reason: '多工具联动链路已经完整闭环。',
            expectedOutcome: '进入最终交付。'
          })
        state = await brainNode(state)
        state = await mouthNode(state)
        const events = runtime.eventCollector.snapshot()

        return {
          output: buildHumanTaskOutputFromState(state),
          events,
          previewExists: await fs
            .access(preview.previewPath)
            .then(() => true)
            .catch(() => false),
          listed,
          kbPreview,
          firstSearch,
          secondSearch,
          applyInput: applyInputFromEvents
        }
      },
      assert: async (result, runtime) => {
        const stepToolNames = filterAiRunEventsByType(result.events, 'human_step')
          .map((event) => event.toolName)
          .filter((value): value is string => Boolean(value))

        runtime.assertThat(
          result.output.status === 'completed' &&
            result.listed.total === 2 &&
            result.kbPreview.length === 1 &&
            result.kbPreview[0]?.document_id === 'doc-1' &&
            result.firstSearch.matches.length === 1 &&
            result.secondSearch.matches.length === 1,
          {
            name: 'multi-tool-scenario-keeps-kb-scope-and-docx-followup',
            message: 'multi-tool-collaboration-simulated 应先在当前资料范围内拿到 KB 证据，再成功回查 docx 的替换结果。',
            data: {
              listedIds: result.listed.items.map((item) => item.id),
              kbPreview: result.kbPreview,
              firstSearch: result.firstSearch.matches,
              secondSearch: result.secondSearch.matches
            }
          }
        )

        runtime.assertThat(
          ['kb_list_documents', 'kb_hybrid_search_chunks', 'docx_open', 'docx_search', 'docx_apply_ops', 'docx_validate', 'docx_render_preview'].every(
            (toolName) => stepToolNames.includes(toolName)
          ) &&
            result.applyInput.ops[0]?.replace === result.kbPreview[0]?.text &&
            result.previewExists &&
            result.output.artifacts?.some(
              (artifact) =>
                artifact.kind === 'file' &&
                artifact.capability === 'docx' &&
                artifact.artifactRole === 'preview'
            ) === true,
          {
            name: 'multi-tool-scenario-pipes-kb-output-into-docx-edit',
            message: 'multi-tool-collaboration-simulated 应把 KB 中间结果继续喂给 docx_apply_ops，并最终稳定产出 preview artifact。',
            data: {
              applyInput: result.applyInput,
              kbPreview: result.kbPreview,
              artifacts: result.output.artifacts,
              steps: summarizeHumanSteps(result.events)
            }
          }
        )
      }
    })
  })
})
