import path from 'node:path'
import { describe, it } from 'vitest'
import { ChatRunService } from '../../../../../src/main/services/ai/ChatRunService'
import { AiFileChangeService } from '../../../../../src/main/services/ai/fileChanges/AiFileChangeService'
import { AiRunResourceManager } from '../../../../../src/main/services/ai/run/AiRunResourceManager'
import type {
  ChatMessageContentNode,
  DocumentSelectionNode,
  FileReference,
  DirectoryReference,
  WebReference
} from '../../../../../src/shared/types'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { buildCompleteTaskDecision } from '../testUtils'

describe('ai human mock-llm backend', () => {
  it('human-document-reference-context', async () => {
    await runBackendCase({
      caseId: 'human-document-reference-context',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      harnessMode: 'mock-llm',
      description: '真实提交、存储、brain 投影和重启恢复保留混合文档引用。',
      fixtures: ['tests/fixtures/workspace'],
      runMode: 'single',
      execute: async (runtime) => {
        const storage = runtime.storageService
        const partnerId = 'document-reference-partner'
        const now = Date.now()
        await storage.partner.savePartner({
          id: partnerId,
          name: '引用测试',
          avatar_shape: 'circle',
          avatar_color: 'blue',
          created_at: now,
          updated_at: now,
          last_viewed_at: now,
          pinned: false,
          pinned_at: null
        })
        await storage.workspace.saveWorkspace({
          id: 'reference-workspace',
          root_path: runtime.workspaceRoot,
          created_at: now,
          updated_at: now
        })
        const filePath = path.join(runtime.workspaceRoot, 'sample-edit.docx')
        const reference: FileReference = {
          kind: 'file',
          workspaceId: 'reference-workspace',
          nodeId: 'sample-edit.docx',
          relativePath: 'sample-edit.docx',
          absolutePath: filePath,
          name: 'sample-edit.docx',
          kbAvailability: 'indexed',
          kbDocumentIds: ['stale-id']
        }
        const directory: DirectoryReference = {
          kind: 'directory',
          workspaceId: 'reference-workspace',
          nodeId: 'root',
          name: '资料目录',
          relativePath: '',
          absolutePath: runtime.workspaceRoot,
          kbAvailability: 'indexed',
          kbDocumentIds: ['stale-directory-id'],
          indexedFileCount: 1,
          notIndexedFileCount: 0
        }
        await runtime.seedKb([
          {
            id: 'web-document',
            name: '引用规范',
            sourceType: 'web',
            sourceUrl: 'https://example.com/reference',
            chunks: [{ id: 'web-chunk', text: '引用时保留原文。' }]
          }
        ])
        await storage.webSource.saveWebSource({
          id: 'web-reference',
          identity_kind: 'normalized_url',
          normalized_url: 'https://example.com/reference',
          url: 'https://example.com/reference',
          title: '引用规范',
          document_id: 'web-document',
          index_status: 'indexed',
          created_at: now,
          updated_at: now
        })
        const web: WebReference = {
          kind: 'web',
          webSourceId: 'web-reference',
          name: '引用规范',
          url: 'https://example.com/reference',
          kbAvailability: 'not_indexed',
          kbDocumentIds: []
        }
        const selection: DocumentSelectionNode = {
          kind: 'document_selection',
          id: 'selection-1',
          number: 1,
          filePath,
          selectedText: 'Hello',
          contextBefore: '',
          contextAfter: ' from fixture',
          children: [
            { kind: 'text', text: '解释这段文字并参考 ' },
            { kind: 'reference', reference: directory },
            { kind: 'text', text: '。' }
          ]
        }
        const second: DocumentSelectionNode = {
          ...selection,
          id: 'selection-2',
          number: 2,
          selectedText: 'fixture',
          contextBefore: 'Hello from ',
          contextAfter: '',
          children: [{ kind: 'text', text: '改为更正式的表达' }]
        }
        const nodes: ChatMessageContentNode[] = [
          { kind: 'text', text: '先看 ' },
          { kind: 'reference', reference },
          { kind: 'text', text: '\n' },
          selection,
          { kind: 'text', text: '\n' },
          second,
          { kind: 'text', text: '\n同时参考 ' },
          { kind: 'reference', reference: web }
        ]
        const createService = () =>
          new ChatRunService({
            partnerStore: storage.partner,
            chatMessageLogStore: storage.chatMessageLog,
            aiRunStore: storage.aiRun,
            documentsStore: storage.documents,
            embeddingService: runtime.embeddingService,
            llmStore: storage.llm,
            workspaceStore: storage.workspace,
            workspaceIndexJobStore: storage.workspaceIndexJob,
            webSourceStore: storage.webSource,
            ensureEmbeddingReady: runtime.ensureEmbeddingReady,
            docxApplyService: runtime.docxApplyService,
            aiFileChangeService: new AiFileChangeService(storage.aiFileChange),
            runResourceManager: new AiRunResourceManager(),
            autoStartRuns: false
          })
        const service = createService()
        const request = {
          partnerId,
          preference: 'default' as const,
          executionPermission: 'review' as const,
          contentNodes: nodes,
          mainModel: { configId: 'mock-llm-scripted', modelName: 'scripted-llm' }
        }
        const accepted = await service.submit(request)
        if (!accepted.run || !accepted.userMessage) throw new Error(accepted.error || '提交未接收')
        const beforeBrain = await storage.chatMessageLog.list(partnerId)
        const user = beforeBrain.find((record) => record.entry.kind === 'user')?.entry
        if (user?.kind !== 'user') throw new Error('接收成功前未保存用户快照')
        const acceptedNodes = accepted.userMessage.contentNodes || []
        let brainContent = ''
        const runner = createHumanTestRunner(runtime, {
          partnerId,
          runId: accepted.run.id,
          userMessageId: accepted.userMessage.id,
          userInput: accepted.userMessage.content,
          contentNodes: acceptedNodes,
          chatToolsWrapper: (realChat) => async (chatRequest) => {
            if (chatRequest.caller === 'human.brain')
              brainContent = String(chatRequest.messages.at(-1)?.content || '')
            return realChat(chatRequest)
          },
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildCompleteTaskDecision({
                  summary: '引用读取完成',
                  deliveryMarkdown: '已理解引用。'
                })
              }
            ]
          }
        })
        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: accepted.userMessage.content
        })
        const afterBrain = await storage.chatMessageLog.list(partnerId)
        const queued = await service.submit({ ...request, contentNodes: [second] })
        const pending = (await storage.aiRun.getRun(accepted.run.id))?.pendingMessages?.[0]
        await createService().failInterruptedRuns()
        const restored = await createService().listPartnerMessages(partnerId)
        return {
          completed: output.status === 'completed',
          frozen: brainContent === user.content,
          userCount: afterBrain.filter((record) => record.entry.kind === 'user').length,
          body: user.content,
          contentNodes: acceptedNodes,
          queued: queued.success && queued.queued === true,
          pendingNodes: pending?.contentNodes || [],
          restoredNodes:
            restored.find((message) => message.id === queued.userMessage?.id)?.contentNodes || []
        }
      },
      assert: async (result, runtime) => {
        const selections = result.contentNodes.filter((node) => node.kind === 'document_selection')
        runtime.assertThat(
          result.completed &&
            result.frozen &&
            result.userCount === 1 &&
            selections.length === 2 &&
            selections.every((node) => node.knowledge?.kbAvailability === 'not_indexed') &&
            result.body.includes('用户引用的文档：') &&
            result.body.includes('Hello') &&
            result.body.includes(' from fixture') &&
            result.body.includes('Hello from ') &&
            result.body.includes('引用内容：整个资源') &&
            result.body.includes('选中片段1的原文：\n```text\nHello\n```') &&
            result.body.includes(
              '选中片段1的后文（上下文，仅供理解与定位）：\n```text\n from fixture\n```'
            ) &&
            result.body.includes(
              '选中片段2的前文（上下文，仅供理解与定位）：\n```text\nHello from \n```'
            ) &&
            result.body.split('[sample-edit.docx · 1]').length === 2 &&
            result.body.split('[sample-edit.docx · 2]').length === 2 &&
            !result.body.includes('以下选中片段') &&
            !result.body.includes('\n选中片段1\n') &&
            !result.body.includes('类型：') &&
            !result.body.includes('stale-id') &&
            result.body.split('解释这段文字').length === 2 &&
            result.body.split('资源地址：').length === 4 &&
            result.body.includes('知识库文档ID：web-document') &&
            !result.body.includes('stale-directory-id') &&
            result.queued &&
            result.pendingNodes.length === 1 &&
            JSON.stringify(result.restoredNodes) === JSON.stringify(result.pendingNodes),
          {
            name: 'document-reference-snapshot-and-projection',
            message:
              '混合正文应保持顺序，索引信息以接收时为准；brain 复用冻结快照；排队后重启保留选区。',
            data: result
          }
        )
      }
    })
  })
})
