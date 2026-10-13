import path from 'node:path'
import fs from 'node:fs/promises'
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
        const literalText = '首行\n\n  \t单元格\t\n```text\n后文：这是原文\n```\n   '
        const excelSnapshot = JSON.stringify({
          display: [
            ['Excel确认时的值', '24'],
            ['', '']
          ],
          cells: [
            [
              { value: 'Excel确认时的值', formula: null },
              { value: 24, formula: '=B2*2' }
            ],
            [
              { value: null, formula: null },
              { value: null, formula: null }
            ]
          ],
          merges: [{ startRow: 2, endRow: 2, startColumn: 1, endColumn: 2 }]
        })
        await fs.writeFile(path.join(runtime.workspaceRoot, 'human-input.txt'), literalText)
        const formats: DocumentSelectionNode[] = [
          {
            ...selection,
            id: 'text',
            number: 1,
            filePath: path.join(runtime.workspaceRoot, 'human-input.txt'),
            selectedText: literalText,
            children: [{ kind: 'text', text: '解释文本' }],
            anchor: {
              kind: 'text',
              start: 0,
              end: literalText.length,
              startLine: 1,
              endLine: 7,
              sourceText: literalText
            }
          },
          {
            ...selection,
            id: 'pdf',
            number: 1,
            filePath: path.join(runtime.workspaceRoot, '学习笔记/深度学习.pdf'),
            children: [{ kind: 'text', text: '解释 PDF' }],
            anchor: { kind: 'pdf', startPage: 1, endPage: 2, start: 0, end: 5 }
          },
          {
            ...selection,
            id: 'excel',
            number: 1,
            filePath: path.join(runtime.workspaceRoot, '经营周报.xlsx'),
            selectedText: excelSnapshot,
            contextBefore: 'Excel前文快照',
            contextAfter: 'Excel后文快照',
            children: [{ kind: 'text', text: '填入公式' }],
            anchor: {
              kind: 'excel',
              sheetId: 'sheet-1',
              sheetName: 'Data',
              range: 'B2:C3',
              startRow: 1,
              endRow: 2,
              startColumn: 1,
              endColumn: 2
            }
          },
          {
            ...selection,
            id: 'ppt',
            number: 1,
            filePath: path.join(runtime.workspaceRoot, '品牌策略提案.pptx'),
            selectedText: 'PPT确认时的文字快照',
            contextBefore: 'PPT前文快照',
            contextAfter: 'PPT后文快照',
            children: [{ kind: 'text', text: '解释图片' }],
            anchor: {
              kind: 'ppt',
              slideId: 'ppt/slides/slide1.xml',
              page: 1,
              elementId: 'ppt/slides/slide1.xml#3',
              mode: 'element',
              revision: 'snapshot-1'
            }
          }
        ]
        const pptSlide: DocumentSelectionNode = {
          ...formats[3],
          id: 'ppt-slide',
          number: 2,
          children: [{ kind: 'text', text: '解释当前页' }],
          anchor: {
            kind: 'ppt',
            slideId: 'ppt/slides/slide1.xml',
            page: 1,
            mode: 'slide',
            revision: 'snapshot-1'
          }
        }
        const nodes: ChatMessageContentNode[] = [
          { kind: 'text', text: '先看 ' },
          { kind: 'reference', reference },
          { kind: 'text', text: '\n' },
          selection,
          { kind: 'text', text: '\n' },
          second,
          { kind: 'text', text: '\n同时参考 ' },
          { kind: 'reference', reference: web },
          ...formats,
          pptSlide
        ]
        const createService = () =>
          new ChatRunService({
            partnerStore: storage.partner,
            chatMessageLogStore: storage.chatMessageLog,
            subagentStore: storage.subagent,
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
        const oversized: DocumentSelectionNode = {
          ...formats[2],
          anchor: {
            kind: 'excel',
            sheetId: 'sheet-1',
            sheetName: 'Data',
            range: 'A1:A10001',
            startRow: 0,
            endRow: 10000,
            startColumn: 0,
            endColumn: 0
          }
        }
        const invalid: DocumentSelectionNode[] = [
          oversized,
          {
            ...formats[3],
            anchor: {
              kind: 'ppt',
              slideId: 'ppt/slides/slide1.xml',
              page: 0,
              mode: 'slide',
              revision: 'snapshot-1'
            }
          },
          {
            ...formats[3],
            anchor: {
              kind: 'ppt',
              slideId: 'ppt/slides/slide1.xml',
              elementId: 'ppt/slides/slide2.xml#3',
              page: 1,
              mode: 'element',
              revision: 'snapshot-1'
            }
          }
        ]
        const rejected: boolean[] = []
        for (const node of invalid) {
          try {
            const response = await service.submit({
              ...request,
              contentNodes: [node]
            })
            rejected.push(!response.success && !!response.error)
          } catch (error) {
            rejected.push(error instanceof Error && error.message === '文档选区无效，请重新选择')
          }
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
        const queued = await service.submit({
          ...request,
          contentNodes: [second, formats[2]]
        })
        const pending = (await storage.aiRun.getRun(accepted.run.id))?.pendingMessages?.[0]
        await createService().failInterruptedRuns()
        const restored = await createService().listPartnerMessages(partnerId)
        const restoredRecords = await storage.chatMessageLog.list(partnerId)
        const restoredUser = restoredRecords.find(
          (record) =>
            record.entry.kind === 'user' &&
            record.entry.context?.contentNodes?.length === 2 &&
            record.entry.context.contentNodes[0].kind === 'document_selection' &&
            record.entry.context.contentNodes[0].id === second.id
        )?.entry
        return {
          rejected,
          completed: output.status === 'completed',
          frozen: brainContent === user.content,
          userCount: afterBrain.filter((record) => record.entry.kind === 'user').length,
          body: user.content,
          literalText,
          excelSnapshot,
          restoredBody: restoredUser?.kind === 'user' ? restoredUser.content : '',
          originalUnchanged: restoredRecords.some(
            (record) => record.entry.kind === 'user' && record.entry.content === user.content
          ),
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
          result.rejected.every(Boolean) &&
            result.completed &&
            result.frozen &&
            result.userCount === 1 &&
            selections.length === 7 &&
            selections.every((node) => node.knowledge?.kbAvailability === 'not_indexed') &&
            result.body.includes('<用户引用的文档>') &&
            result.body.startsWith('<用户诉求>\n') &&
            result.body.includes('</用户诉求>\n\n<默认用户工作区>') &&
            result.body.includes('</默认用户工作区>\n\n<用户引用的文档>') &&
            result.body.includes('</用户引用的文档>\n\n<当前时间>') &&
            !result.body.includes('<偏好>') &&
            !result.body.includes('<用户添加的附件>') &&
            result.body.includes('Hello') &&
            result.body.includes(' from fixture') &&
            result.body.includes('Hello from ') &&
            result.body.includes('引用内容：整个资源') &&
            result.body.includes('引用内容：整个资源\n<用户选中片段1>') &&
            result.body.includes('</用户选中片段1>\n<用户选中片段2>') &&
            !/<\/用户选中片段\d+>\n\n<用户选中片段/.test(result.body) &&
            !result.body.includes('知识库文档ID：无\n\n<用户选中片段') &&
            result.body.includes('<用户选中片段1>\n<选中内容>\nHello\n</选中内容>') &&
            result.body.includes('<选中内容>\n' + result.literalText + '\n</选中内容>') &&
            result.body.includes(
              '<定位信息>\n<选中内容的后文>\n from fixture\n</选中内容的后文>\n</定位信息>'
            ) &&
            result.body.includes('<选中内容的前文>\nHello from \n</选中内容的前文>') &&
            result.body.includes('<定位信息>\n行号：第 1–7 行\n') &&
            result.body.includes('<定位信息>\n页码：第 1–2 页\n') &&
            !result.body.includes('不属于选中内容') &&
            !result.body.includes('以下片段仅用于定位。') &&
            !result.body.includes('</选中内容>\n\n<定位信息>') &&
            !result.body.includes('<前文>') &&
            !result.body.includes('<后文>') &&
            result.body.split('[sample-edit.docx · 1]').length === 2 &&
            result.body.split('[sample-edit.docx · 2]').length === 2 &&
            !result.body.includes('以下选中片段') &&
            result.body.match(/<用户选中片段\d+>/g)?.length === selections.length &&
            !result.body.includes('<源文件片段>') &&
            !result.body.includes('类型：') &&
            !result.body.includes('stale-id') &&
            result.body.split('解释这段文字').length === 2 &&
            result.body.split('资源地址：').length === 8 &&
            result.body.includes('知识库文档ID：web-document') &&
            !result.body.includes('stale-directory-id') &&
            result.body.includes(
              '<用户选中片段1>\n<定位信息>\n工作表：Data\n选中单元格范围：B2:C3\n</定位信息>\n</用户选中片段1>'
            ) &&
            !result.body.includes(result.excelSnapshot) &&
            !result.body.includes('Excel确认时的值') &&
            !result.body.includes('Excel前文快照') &&
            !result.body.includes('Excel后文快照') &&
            !result.body.includes('merges') &&
            selections.find((node) => node.id === 'excel')?.selectedText === result.excelSnapshot &&
            result.body.includes(
              '<用户选中片段1>\n<定位信息>\n页码：第 1 页\n选中元素：ppt/slides/slide1.xml#3\n</定位信息>\n</用户选中片段1>'
            ) &&
            result.body.includes(
              '<用户选中片段2>\n<定位信息>\n页码：第 1 页\n选中页面：ppt/slides/slide1.xml\n</定位信息>\n</用户选中片段2>'
            ) &&
            !result.body.includes('PPT确认时的文字快照') &&
            !result.body.includes('PPT前文快照') &&
            !result.body.includes('PPT后文快照') &&
            !result.body.includes('页面标识：') &&
            !result.body.includes('选中时的画面：') &&
            selections.find((node) => node.id === 'ppt')?.anchor?.kind === 'ppt' &&
            selections.find((node) => node.id === 'ppt-slide')?.anchor?.kind === 'ppt' &&
            result.queued &&
            result.originalUnchanged &&
            result.restoredBody.includes('<用户选中片段2>\n<选中内容>\nfixture\n</选中内容>') &&
            result.restoredBody.includes(
              '<定位信息>\n<选中内容的前文>\nHello from \n</选中内容的前文>\n</定位信息>'
            ) &&
            result.restoredBody.includes('工作表：Data\n选中单元格范围：B2:C3') &&
            !result.restoredBody.includes(result.excelSnapshot) &&
            result.pendingNodes.length === 2 &&
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
