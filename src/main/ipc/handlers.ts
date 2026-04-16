import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { OpenDialogOptions } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { IngestionService } from '../services/ingestion/loader'
import { EmbeddingService } from '../services/vector/EmbeddingService'
import { ensureEmbeddingReady } from '../services/vector/ensureEmbeddingReady'
import { StorageService } from '../services/storage/StorageService'
import { ModelService } from '../services/model/ModelService'
import { AiRunService } from '../services/ai/AiRunService'
import { updateSessionMemoryAfterRun } from '../services/ai/memory'
import { DraftReviewService } from '../services/ai/human/tools/docx/review/DraftReviewService'
import {
  getDocxWorkerClient,
  releaseDocxRunSession
} from '../services/ai/human/tools/docx/worker/docxWorkerClient'
import type { AiLlmIoRecord } from '../../shared/types'
import {
  buildWebReferenceItem,
  buildWorkspaceReferenceItems,
  getWorkspaceScopeKey,
  referenceMatchesQuery,
  shouldIncludeReferenceInSearch
} from '../services/sourceScope/selection'
import { validateSelectedReferencesForRun } from '../services/sourceScope/validation'
import { WorkspaceSourceService } from '../services/workspace/WorkspaceSourceService'
import { WebSourceService } from '../services/web/WebSourceService'
import { v4 as uuidv4 } from 'uuid'
import type {
  SearchResult,
  DocumentListResponse,
  ChunkListResponse,
  ChatSession,
  ChatMessage,
  AiRuntimeSettings,
  LLMConfig,
  AiRunEvent,
  AiRunStartRequest,
  AiRunStartResponse,
  AiRunCancelResponse,
  AiRunApprovalDecisionRequest,
  AiRunApprovalDecisionResponse,
  CommitDraftReviewRequest,
  CommitDraftReviewResponse,
  CreateWorkspaceSourceRequest,
  DiscardDraftReviewRequest,
  DiscardDraftReviewResponse,
  DeleteWorkspaceSourceResponse,
  ListReferenceItemsRequest,
  ListDraftReviewsRequest,
  ListDraftReviewsResponse,
  ListWorkspaceNodesRequest,
  GetDraftReviewRequest,
  GetDraftReviewResponse,
  OpenPathWithApplicationRequest,
  OpenPathWithApplicationResponse,
  PickDirectoryResponse,
  PickApplicationResponse,
  ReferenceItemListResponse,
  ValidateDraftCommitRequest,
  ValidateDraftCommitResponse,
  ListWebSourcesRequest,
  RefreshWebSourceRequest,
  DeleteWebSourceRequest,
  SelectedReference,
  WebSourceListResponse,
  WebSourceMutationResponse,
  DeleteWebSourceResponse,
  WebSourceRecord,
  WorkspaceJobResponse,
  WorkspaceMutationResponse,
  WorkspaceNode,
  WorkspaceNodeListResponse,
  WorkspaceSource,
  WorkspaceListResponse
} from '../types/store'
import path from 'path'
import fs from 'fs'
import { WEB_INGEST_CONCURRENCY } from '../utils/constant'
import { Jieba } from '@node-rs/jieba'
import { dict } from '@node-rs/jieba/dict'
import { normalizeForIpc } from '../utils/serialization'
import {
  createE2EFixtureWorkspace,
  deleteE2EFixtureWebSource,
  deleteE2EFixtureWorkspace,
  getE2EFixtureSearchResponse,
  getE2EFixtureWebSourceList,
  getE2EFixtureWorkspaceList,
  getE2EFixtureWorkspaceDelayMs,
  getE2EFixtureWorkspaceNodes,
  getE2EFixtureReferenceItems,
  ingestE2EFixtureWebSource,
  ingestE2EFixtureWebSources,
  isE2EFixtureModeEnabled,
  matchE2EChatScenario,
  prepareE2EFixtureWorkspace,
  refreshE2EFixtureWebSource,
  scanE2EFixtureWorkspace
} from '../testing/e2eFixtures'

const jieba = Jieba.withDict(dict)
const execFileAsync = promisify(execFile)
const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const deriveWorkspaceStatus = (nodes: WorkspaceNode[]): WorkspaceSource['status'] => {
  if (nodes.some((node) => node.prepare_status === 'failed')) return 'failed'
  if (nodes.some((node) => node.prepare_status === 'stale')) return 'stale'
  if (nodes.some((node) => node.prepare_status === 'preparing')) return 'preparing'
  if (nodes.some((node) => node.prepare_status === 'prepared')) return 'prepared'
  return 'not_prepared'
}

const mergeScannedNodes = (params: {
  existingNodes: WorkspaceNode[]
  nextNodes: WorkspaceNode[]
  changedNodes: WorkspaceNode[]
  now: number
}): WorkspaceNode[] => {
  const existingMap = new Map(
    params.existingNodes.map((node) => [getWorkspaceScopeKey(node), node] as const)
  )
  const changedKeys = new Set(params.changedNodes.map((node) => getWorkspaceScopeKey(node)))

  return params.nextNodes.map((node) => {
    const existingNode = existingMap.get(getWorkspaceScopeKey(node))
    if (!existingNode) return node
    if (changedKeys.has(getWorkspaceScopeKey(node)) && node.kind === 'file') {
      return {
        ...node,
        document_id: existingNode.document_id,
        content_hash: node.content_hash || existingNode.content_hash,
        last_prepared_at: existingNode.last_prepared_at,
        last_error: existingNode.last_error,
        prepare_status: existingNode.document_id ? 'stale' : 'not_prepared',
        created_at: existingNode.created_at,
        updated_at: params.now
      }
    }
    return {
      ...node,
      content_hash: existingNode.content_hash,
      document_id: existingNode.document_id,
      last_prepared_at: existingNode.last_prepared_at,
      last_error: existingNode.last_error,
      prepare_status: existingNode.prepare_status,
      created_at: existingNode.created_at,
      updated_at: params.now
    }
  })
}

const toTrimmedStringList = (values: string[] | undefined): string[] =>
  Array.isArray(values) ? values.map((value) => String(value).trim()).filter(Boolean) : []

const normalizeKbAvailability = (
  value: string | undefined
): SelectedReference['kbAvailability'] =>
  value === 'indexed' || value === 'partial' || value === 'not_indexed' ? value : 'not_indexed'

const normalizeSelectedReferences = (
  references: AiRunStartRequest['selectedReferences']
): SelectedReference[] | undefined => {
  if (!Array.isArray(references)) return undefined

  const normalized = references
    .map((reference) => {
      if (reference.kind === 'web') {
        return {
          kind: 'web' as const,
          workspaceId: String(reference.workspaceId || '').trim(),
          webSourceId: String(reference.webSourceId || '').trim(),
          name: String(reference.name || '').trim(),
          url: String(reference.url || '').trim(),
          kbDocumentIds: toTrimmedStringList(reference.kbDocumentIds),
          kbAvailability: normalizeKbAvailability(reference.kbAvailability)
        }
      }

      if (reference.kind === 'directory') {
        return {
          kind: 'directory' as const,
          workspaceId: String(reference.workspaceId || '').trim(),
          nodeId: String(reference.nodeId || '').trim(),
          name: String(reference.name || '').trim(),
          relativePath: String(reference.relativePath || '').trim(),
          absolutePath: String(reference.absolutePath || '').trim(),
          kbDocumentIds: toTrimmedStringList(reference.kbDocumentIds),
          kbAvailability: normalizeKbAvailability(reference.kbAvailability),
          indexedFileCount: Math.max(0, Number(reference.indexedFileCount || 0)),
          notIndexedFileCount: Math.max(0, Number(reference.notIndexedFileCount || 0))
        }
      }

      return {
        kind: 'file' as const,
        workspaceId: String(reference.workspaceId || '').trim(),
        nodeId: String(reference.nodeId || '').trim(),
        name: String(reference.name || '').trim(),
        relativePath: String(reference.relativePath || '').trim(),
        absolutePath: String(reference.absolutePath || '').trim(),
        fileExt: reference.fileExt ? String(reference.fileExt).trim() : undefined,
        kbDocumentIds: toTrimmedStringList(reference.kbDocumentIds),
        kbAvailability: normalizeKbAvailability(reference.kbAvailability)
      }
    })
    .filter((reference) => {
      if (reference.kind === 'web') {
        return Boolean(reference.workspaceId && reference.webSourceId && reference.name && reference.url)
      }

      return Boolean(
        reference.workspaceId &&
          reference.nodeId &&
          reference.name &&
          reference.relativePath &&
          reference.absolutePath
      )
    })

  return normalized.length > 0 ? normalized : undefined
}

const normalizeReferenceKindFilters = (
  referenceKinds: ListReferenceItemsRequest['referenceKinds']
): Set<SelectedReference['kind']> | null => {
  if (!Array.isArray(referenceKinds) || referenceKinds.length === 0) return null
  const normalized = referenceKinds
    .map((referenceKind) => String(referenceKind || '').trim())
    .filter(
      (referenceKind): referenceKind is SelectedReference['kind'] =>
        referenceKind === 'directory' || referenceKind === 'file' || referenceKind === 'web'
    )
  return normalized.length > 0 ? new Set(normalized) : null
}

export function registerHandlers(services: {
  ingestionService: IngestionService
  embeddingService: EmbeddingService
  storageService: StorageService
  modelService: ModelService
  recordLlmIo?: (record: AiLlmIoRecord) => void
}) {
  const { ingestionService, embeddingService, storageService, modelService } = services
  const activeAiRuns = new Map<string, { cancelled: boolean; senderId: number }>()
  const activeWorkspacePrepareJobs = new Set<string>()
  const activeAiApprovals = new Map<
    string,
    Map<
      string,
      {
        taskId: string
        resolve: (decision: { approved: boolean; reason?: string }) => void
      }
    >
  >()
  const documentsStore = storageService.documents
  const chatStore = storageService.chat
  const llmStore = storageService.llm
  const aiRuntimeSettingsStore = storageService.aiRuntimeSettings
  const webSourceStore = storageService.webSource
  const workspaceStore = storageService.workspace
  const draftReviewService = new DraftReviewService(storageService.draftReview, documentsStore)
  const workspaceService = new WorkspaceSourceService()
  const webSourceService = new WebSourceService()

  const emitSourceListRefresh = (sender: Electron.WebContents) => {
    sender.send('source-list-refresh')
  }

  const pauseForE2EFixture = async (): Promise<void> => {
    await new Promise<void>((resolve) => setTimeout(resolve, 30))
  }

  const waitForE2EFixtureDelay = async (phase: 'scan' | 'prepare'): Promise<void> => {
    const durationMs = getE2EFixtureWorkspaceDelayMs(phase)
    if (durationMs <= 0) return
    await new Promise<void>((resolve) => setTimeout(resolve, durationMs))
  }

  const E2E_REVIEW_FIXTURE_SOURCE = path.resolve(
    process.cwd(),
    'tests',
    'fixtures',
    'ai',
    'docx',
    'sample-edit.docx'
  )

  const emitE2EChatArtifactFlow = async (input: {
    runId: string
    sendEvent: (event: AiRunEvent) => void
  }): Promise<void> => {
    input.sendEvent({
      type: 'human_step',
      runId: input.runId,
      taskId: input.runId,
      stepIndex: 1,
      action: 'call_tool',
      toolName: 'kb_search',
      publicNarrative: '执行检索并整理结果',
      learnedSkillIds: [],
      effectiveSkillIds: [],
      availableToolNames: ['kb_search'],
      summary: 'E2E fixture 开始执行检索。',
      createdAt: Date.now(),
      stage: 'human_hand'
    })
    await pauseForE2EFixture()

    input.sendEvent({
      type: 'tool_call_started',
      runId: input.runId,
      taskId: input.runId,
      toolCallId: 'tool-e2e-search',
      toolName: 'kb_search',
      input: {
        query: 'e2e fixture search'
      },
      createdAt: Date.now()
    })
    await pauseForE2EFixture()

    input.sendEvent({
      type: 'tool_call_result',
      runId: input.runId,
      taskId: input.runId,
      toolCallId: 'tool-e2e-search',
      toolName: 'kb_search',
      outputPreview: [
        {
          id: 'chunk-e2e-1',
          text: 'E2E 检索命中内容',
          document_name: 'E2E 文档'
        }
      ],
      completedAt: Date.now()
    })
    await pauseForE2EFixture()

    input.sendEvent({
      type: 'human_step',
      runId: input.runId,
      taskId: input.runId,
      stepIndex: 2,
      action: 'deliver_result',
      publicNarrative: '生成文件产物并整理最终结果',
      learnedSkillIds: [],
      effectiveSkillIds: [],
      availableToolNames: [],
      summary: 'E2E fixture 已生成文件产物。',
      createdAt: Date.now(),
      stage: 'human_mouth'
    })
    await pauseForE2EFixture()

    input.sendEvent({
      type: 'file_artifact',
      runId: input.runId,
      taskId: input.runId,
      artifactId: 'artifact-e2e-1',
      capability: 'docx',
      path: '/tmp/ncurator-e2e-result.docx',
      fileName: 'ncurator-e2e-result.docx',
      operation: 'created',
      summary: 'E2E 生成测试文档',
      createdAt: Date.now()
    })
  }

  const stageE2EDraftReviewDocument = async (input: {
    runId: string
    draftReviewService: DraftReviewService
    sourceFileName: string
    acceptedReplace: string
    rejectedReplace: string
  }) => {
    const workspaceRootPath = path.join('/tmp', 'ncurator-e2e-review-workspace', input.runId)
    const sourcePath = path.join(workspaceRootPath, input.sourceFileName)
    await fs.promises.mkdir(workspaceRootPath, { recursive: true })
    await fs.promises.copyFile(E2E_REVIEW_FIXTURE_SOURCE, sourcePath)

    const client = getDocxWorkerClient()
    const openResponse = await client.call({
      runId: input.runId,
      action: 'open',
      payload: {
        sourcePath
      }
    })
    if (!openResponse.ok || openResponse.payload.action !== 'open') {
      throw new Error(openResponse.ok ? 'e2e review open worker mismatch' : openResponse.error)
    }

    input.draftReviewService.registerDocxOpen({
      runId: input.runId,
      docId: openResponse.payload.docId,
      sourcePath
    })

    const acceptedOp = {
      type: 'replace_text' as const,
      query: 'Hello',
      replace: input.acceptedReplace,
      replaceAll: true
    }
    const rejectedOp = {
      type: 'replace_text' as const,
      query: 'fixture',
      replace: input.rejectedReplace,
      replaceAll: true
    }

    const applyAcceptedResponse = await client.call({
      runId: input.runId,
      action: 'apply_ops',
      payload: {
        docId: openResponse.payload.docId,
        ops: [acceptedOp]
      }
    })
    if (!applyAcceptedResponse.ok || applyAcceptedResponse.payload.action !== 'apply_ops') {
      throw new Error(
        applyAcceptedResponse.ok
          ? 'e2e review apply accepted worker mismatch'
          : applyAcceptedResponse.error
      )
    }

    input.draftReviewService.registerDocxChanges({
      runId: input.runId,
      previousDocId: openResponse.payload.docId,
      nextDocId: applyAcceptedResponse.payload.newDocId,
      op: acceptedOp,
      changedBlocks: applyAcceptedResponse.payload.changedBlocks
    })

    const applyRejectedResponse = await client.call({
      runId: input.runId,
      action: 'apply_ops',
      payload: {
        docId: applyAcceptedResponse.payload.newDocId,
        ops: [rejectedOp]
      }
    })
    if (!applyRejectedResponse.ok || applyRejectedResponse.payload.action !== 'apply_ops') {
      throw new Error(
        applyRejectedResponse.ok
          ? 'e2e review apply rejected worker mismatch'
          : applyRejectedResponse.error
      )
    }

    input.draftReviewService.registerDocxChanges({
      runId: input.runId,
      previousDocId: applyAcceptedResponse.payload.newDocId,
      nextDocId: applyRejectedResponse.payload.newDocId,
      op: rejectedOp,
      changedBlocks: applyRejectedResponse.payload.changedBlocks
    })

    return {
      sourcePath,
      workspaceRootPath
    }
  }

  const createE2EDraftReviews = async (input: {
    runId: string
    draftReviewService: DraftReviewService
    conflict: boolean
    multiple: boolean
    primaryDocument?: {
      sourceFileName: string
      acceptedReplace: string
      rejectedReplace: string
    }
    secondaryDocument?: {
      sourceFileName: string
      acceptedReplace: string
      rejectedReplace: string
    }
  }) => {
    const stagedSources: string[] = []

    const primaryDocument = input.primaryDocument || {
      sourceFileName: input.conflict ? 'e2e-review-conflict.docx' : 'e2e-review-source-a.docx',
      acceptedReplace: input.multiple ? 'E2E accepted paragraph A' : 'E2E accepted paragraph',
      rejectedReplace: input.multiple ? 'E2E rejected paragraph A' : 'E2E rejected paragraph'
    }
    const firstDocument = await stageE2EDraftReviewDocument({
      runId: input.runId,
      draftReviewService: input.draftReviewService,
      sourceFileName: primaryDocument.sourceFileName,
      acceptedReplace: primaryDocument.acceptedReplace,
      rejectedReplace: primaryDocument.rejectedReplace
    })
    stagedSources.push(firstDocument.sourcePath)

    if (input.multiple) {
      const secondaryDocument = input.secondaryDocument || {
        sourceFileName: 'e2e-review-source-b.docx',
        acceptedReplace: 'E2E accepted paragraph B',
        rejectedReplace: 'E2E rejected paragraph B'
      }
      const secondDocument = await stageE2EDraftReviewDocument({
        runId: input.runId,
        draftReviewService: input.draftReviewService,
        sourceFileName: secondaryDocument.sourceFileName,
        acceptedReplace: secondaryDocument.acceptedReplace,
        rejectedReplace: secondaryDocument.rejectedReplace
      })
      stagedSources.push(secondDocument.sourcePath)
    }

    const details = await input.draftReviewService.finalizeRunReview({
      runId: input.runId,
      workspaceRootPath: firstDocument.workspaceRootPath
    })
    if (details.length === 0) {
      throw new Error('e2e review details missing after finalize')
    }

    if (input.conflict) {
      const conflictSourcePath = stagedSources[0]
      if (!conflictSourcePath) {
        throw new Error('e2e conflict source path missing')
      }
      const sourceStat = await fs.promises.stat(conflictSourcePath)
      const nextTime = new Date(sourceStat.mtimeMs + 120_000)
      await fs.promises.utimes(conflictSourcePath, nextTime, nextTime)
    }

    return details
  }

  const emitE2EEditReviewFlow = async (input: {
    runId: string
    sendEvent: (event: AiRunEvent) => void
    draftReviewService: DraftReviewService
    conflict: boolean
    multiple: boolean
    primaryDocument?: {
      sourceFileName: string
      acceptedReplace: string
      rejectedReplace: string
    }
    secondaryDocument?: {
      sourceFileName: string
      acceptedReplace: string
      rejectedReplace: string
    }
    answerText?: string
  }): Promise<void> => {
    input.sendEvent({
      type: 'human_step',
      runId: input.runId,
      taskId: input.runId,
      stepIndex: 1,
      action: 'call_tool',
      toolName: 'docx_text_edit',
      publicNarrative: '生成草稿并建立审阅集合',
      learnedSkillIds: [],
      effectiveSkillIds: [],
      availableToolNames: ['docx_text_edit'],
      summary: 'E2E fixture 开始准备草稿审阅。',
      createdAt: Date.now(),
      stage: 'human_hand'
    })
    await pauseForE2EFixture()

    const details = await createE2EDraftReviews({
      runId: input.runId,
      draftReviewService: input.draftReviewService,
      conflict: input.conflict,
      multiple: input.multiple,
      primaryDocument: input.primaryDocument,
      secondaryDocument: input.secondaryDocument
    })

    details.forEach((detail) => {
      detail.documents.forEach((document) => {
        if (!document.confirm_artifact_path) return
        input.sendEvent({
          type: 'file_artifact',
          runId: input.runId,
          taskId: input.runId,
          artifactId: uuidv4(),
          capability: 'docx',
          path: document.confirm_artifact_path,
          fileName: path.basename(document.confirm_artifact_path),
          operation: 'created',
          artifactRole: 'draft',
          reviewId: detail.review.id,
          draftDocumentId: document.id,
          draftSnapshotId: document.latest_draft_snapshot_id,
          summary: `confirm doc ready: ${document.source_name}`,
          createdAt: Date.now()
        })
      })
    })
    await pauseForE2EFixture()

    input.sendEvent({
      type: 'human_step',
      runId: input.runId,
      taskId: input.runId,
      stepIndex: 2,
      action: 'deliver_result',
      publicNarrative: '暴露审阅结果并等待用户确认',
      learnedSkillIds: [],
      effectiveSkillIds: [],
      availableToolNames: [],
      summary: 'E2E fixture 已准备好审阅结果。',
      createdAt: Date.now(),
      stage: 'human_mouth'
    })
    await pauseForE2EFixture()

    details.forEach((detail) => {
      input.sendEvent({
        type: 'draft_review_ready',
        runId: input.runId,
        review: {
          reviewId: detail.review.id,
          documentCount: detail.review.document_count,
          changeCount: detail.review.change_count
        },
        createdAt: Date.now()
      })
    })
    await pauseForE2EFixture()

    details.forEach((detail) => {
      detail.documents.forEach((document) => {
        if (!document.effective_draft_artifact_path) return
        input.sendEvent({
          type: 'file_artifact',
          runId: input.runId,
          taskId: input.runId,
          artifactId: uuidv4(),
          capability: 'docx',
          path: document.effective_draft_artifact_path,
          fileName: path.basename(document.effective_draft_artifact_path),
          operation: 'created',
          artifactRole: 'draft',
          reviewId: detail.review.id,
          draftDocumentId: document.id,
          draftSnapshotId: document.latest_draft_snapshot_id,
          summary: `draft ready: ${document.source_name}`,
          createdAt: Date.now()
        })
      })
    })
    input.sendEvent({
      type: 'answer_completed',
      runId: input.runId,
      text:
        input.answerText ||
        (input.conflict
          ? 'E2E fixture 已生成草稿审阅，并在提交前制造了源文件冲突。'
          : input.multiple
            ? 'E2E fixture 已生成两个确认文档，可分别确认。'
            : 'E2E fixture 已生成草稿审阅，可继续逐块确认并提交。')
    })
    input.sendEvent({
      type: 'run_completed',
      runId: input.runId
    })
  }

  const waitForE2EApprovalDecision = async (input: {
    runId: string
    taskId: string
    sendEvent: (event: AiRunEvent) => void
  }): Promise<boolean> => {
    const approvals = activeAiApprovals.get(input.runId)
    if (!approvals) return false

    const approvalId = 'approval-e2e-1'

    input.sendEvent({
      type: 'approval_required',
      runId: input.runId,
      taskId: input.taskId,
      approvalId,
      command: 'rm -rf /tmp/ncurator-e2e',
      riskLevel: 'high',
      reason: 'E2E fixture 需要审批才能继续',
      createdAt: Date.now()
    })

    return await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        approvals.delete(approvalId)
        input.sendEvent({
          type: 'approval_decision',
          runId: input.runId,
          taskId: input.taskId,
          approvalId,
          approved: false,
          reason: 'e2e_fixture_timeout',
          decidedAt: Date.now()
        })
        resolve(false)
      }, 10_000)

      approvals.set(approvalId, {
        taskId: input.taskId,
        resolve: (decision) => {
          clearTimeout(timeout)
          approvals.delete(approvalId)
          input.sendEvent({
            type: 'approval_decision',
            runId: input.runId,
            taskId: input.taskId,
            approvalId,
            approved: Boolean(decision.approved),
            reason: decision.reason,
            decidedAt: Date.now()
          })
          resolve(Boolean(decision.approved))
        }
      })
    })
  }

  const maybeHandleE2EFixtureRun = async (input: {
    runId: string
    inputText: string
    workspace?: {
      workspaceId: string
      workspaceName: string
      rootPath: string
      policyProfile?: string
    }
    sendEvent: (event: AiRunEvent) => void
    draftReviewService: DraftReviewService
  }): Promise<boolean> => {
    if (!isE2EFixtureModeEnabled()) return false

    const scenario = matchE2EChatScenario(input.inputText)
    if (!scenario) return false

    const taskId = input.runId

    if (scenario === 'chat-artifact-flow') {
      await emitE2EChatArtifactFlow({
        runId: input.runId,
        sendEvent: input.sendEvent
      })
      input.sendEvent({
        type: 'answer_completed',
        runId: input.runId,
        text: 'E2E fixture 已生成过程结果与文件产物。'
      })
      input.sendEvent({
        type: 'run_completed',
        runId: input.runId
      })
      return true
    }

    if (scenario === 'chat-approval') {
      const approved = await waitForE2EApprovalDecision({
        runId: input.runId,
        taskId,
        sendEvent: input.sendEvent
      })

      if (!approved) {
        input.sendEvent({
          type: 'runtime_issue',
          runId: input.runId,
          code: 'approval_denied',
          message: 'E2E fixture 审批被拒绝',
          taskId,
          createdAt: Date.now()
        })
        input.sendEvent({
          type: 'run_completed',
          runId: input.runId
        })
        return true
      }

      await emitE2EChatArtifactFlow({
        runId: input.runId,
        sendEvent: input.sendEvent
      })
      input.sendEvent({
        type: 'answer_completed',
        runId: input.runId,
        text: '审批通过，E2E fixture 已继续执行。'
      })
      input.sendEvent({
        type: 'run_completed',
        runId: input.runId
      })
      return true
    }

    if (scenario === 'chat-workspace') {
      if (!input.workspace?.rootPath) {
        input.sendEvent({
          type: 'workspace_required',
          runId: input.runId,
          taskId,
          reason: 'E2E fixture 需要工作区上下文才能继续',
          requiredFields: ['workspaceId', 'rootPath'],
          createdAt: Date.now()
        })
        return true
      }

      await emitE2EChatArtifactFlow({
        runId: input.runId,
        sendEvent: input.sendEvent
      })
      input.sendEvent({
        type: 'answer_completed',
        runId: input.runId,
        text: '工作区已补充，E2E fixture 已继续执行。'
      })
      input.sendEvent({
        type: 'run_completed',
        runId: input.runId
      })
      return true
    }

    if (scenario === 'chat-edit-review') {
      await emitE2EEditReviewFlow({
        runId: input.runId,
        sendEvent: input.sendEvent,
        draftReviewService: input.draftReviewService,
        conflict: false,
        multiple: false
      })
      return true
    }

    if (scenario === 'chat-edit-review-b') {
      await emitE2EEditReviewFlow({
        runId: input.runId,
        sendEvent: input.sendEvent,
        draftReviewService: input.draftReviewService,
        conflict: false,
        multiple: false,
        primaryDocument: {
          sourceFileName: 'e2e-review-source-b.docx',
          acceptedReplace: 'E2E accepted paragraph B',
          rejectedReplace: 'E2E rejected paragraph B'
        },
        answerText: 'E2E fixture 已生成 B 文件的草稿审阅。'
      })
      return true
    }

    if (scenario === 'chat-multi-review') {
      await emitE2EEditReviewFlow({
        runId: input.runId,
        sendEvent: input.sendEvent,
        draftReviewService: input.draftReviewService,
        conflict: false,
        multiple: true
      })
      return true
    }

    if (scenario === 'chat-review-conflict') {
      await emitE2EEditReviewFlow({
        runId: input.runId,
        sendEvent: input.sendEvent,
        draftReviewService: input.draftReviewService,
        conflict: true,
        multiple: false
      })
      return true
    }

    return false
  }

  const ensureWebSourcesHydrated = async (): Promise<void> => {
    const existingSources = await webSourceStore.listWebSources()
    const existingByDocumentId = new Map(
      existingSources
        .filter((source) => source.document_id)
        .map((source) => [source.document_id || '', source] as const)
    )
    const webDocuments = (
      await documentsStore.listDocuments({ page: 1, pageSize: 2000 })
    ).items.filter((document) => document.source_type === 'web')

    for (const document of webDocuments) {
      if (existingByDocumentId.has(document.id)) continue
      const workspaceId = String(document.workspace_id || '').trim()
      if (!workspaceId) continue
      const rawUrl = String(document.source_url || document.file_path || document.name || '').trim()
      if (!rawUrl) continue
      try {
        const { url, normalizedUrl } = webSourceService.normalizeUrl(rawUrl)
        const existing = await webSourceStore.getWebSourceByNormalizedUrl(normalizedUrl, workspaceId)
        const now = Date.now()
        if (existing) {
          await webSourceStore.updateWebSource(existing.id, {
            workspace_id: workspaceId,
            url,
            title: document.source_title || document.name,
            document_id: document.id,
            import_status: document.import_status,
            fetched_at: document.fetched_at || document.created_at,
            last_error: document.last_error,
            updated_at: now
          })
          continue
        }
        const source = webSourceService.createWebSource({
          workspaceId,
          url,
          normalizedUrl,
          title: document.source_title || document.name,
          documentId: document.id,
          importStatus: document.import_status,
          fetchedAt: document.fetched_at || document.created_at,
          lastError: document.last_error,
          now
        })
        await webSourceStore.saveWebSource(source)
      } catch (error) {
        void error
      }
    }
  }

  const refreshWebSourceRecord = async (
    event: Electron.IpcMainInvokeEvent,
    source: WebSourceRecord
  ): Promise<{ source: WebSourceRecord; chunkCount: number }> => {
    const now = Date.now()
    const nextDocumentId = source.document_id || uuidv4()
    const nextPendingSource: WebSourceRecord = {
      ...source,
      document_id: nextDocumentId,
      import_status: 1,
      last_error: undefined,
      updated_at: now
    }
    await webSourceStore.saveWebSource(nextPendingSource)

    const existingDocument = source.document_id
      ? await documentsStore.getDocumentById(source.document_id)
      : null
    if (existingDocument) {
      await documentsStore.updateDocumentById(existingDocument.id, {
        name: source.title || source.url,
        file_path: source.url,
        source_type: 'web',
        workspace_id: source.workspace_id
      })
      await documentsStore.updateDocumentImportStatus(existingDocument.id, 1)
      await documentsStore.deleteChunksByDocumentIds([existingDocument.id])
    } else {
      await documentsStore.addDocument({
        id: nextDocumentId,
        name: source.title || source.url,
        source_type: 'web',
        workspace_id: source.workspace_id,
        file_path: source.url,
        created_at: now,
        import_status: 1,
        source_id: source.id,
        source_url: source.url,
        source_title: source.title,
        normalized_source_url: source.normalized_url
      })
    }

    emitSourceListRefresh(event.sender)

    try {
      const splitDocs = await ingestionService.processWebUrl({
        url: source.url,
        includeSelectors: source.include_selectors,
        excludeSelectors: source.exclude_selectors
      })
      const documentName = splitDocs.title?.trim() || source.url
      await documentsStore.updateDocumentById(nextDocumentId, {
        name: documentName,
        file_path: source.url,
        source_type: 'web',
        workspace_id: source.workspace_id
      })

      const allSplitDocs = [...splitDocs.bigSplitDocs, ...splitDocs.miniSplitDocs]
      const allChunkVectors: Float32Array[] = []
      for (const doc of allSplitDocs) {
        const { data: vector } = await embeddingService.embed(doc.pageContent)
        allChunkVectors.push(vector)
      }

      const chunks = allChunkVectors.map((_, index) => ({
        text: allSplitDocs[index].pageContent,
        id: uuidv4(),
        document_id: nextDocumentId,
        workspace_id: source.workspace_id,
        document_name: documentName,
        source_type: 'web',
        metadata: {
          page: 1
        }
      }))

      await documentsStore.addChunks({
        vectors: allChunkVectors,
        chunks
      })
      await documentsStore.updateDocumentImportStatus(nextDocumentId, 2)

      const refreshedSource: WebSourceRecord = {
        ...nextPendingSource,
        title: documentName,
        import_status: 2,
        fetched_at: Date.now(),
        last_error: undefined,
        updated_at: Date.now()
      }
      await webSourceStore.saveWebSource(refreshedSource)
      emitSourceListRefresh(event.sender)
      return { source: refreshedSource, chunkCount: chunks.length }
    } catch (error: unknown) {
      await documentsStore.updateDocumentImportStatus(nextDocumentId, 3).catch(() => {})
      const failedSource: WebSourceRecord = {
        ...nextPendingSource,
        import_status: 3,
        last_error: getErrorMessage(error),
        updated_at: Date.now()
      }
      await webSourceStore.saveWebSource(failedSource)
      emitSourceListRefresh(event.sender)
      throw error
    }
  }

  ipcMain.handle(
    'ingest-web',
    async (
      event,
      payload: { workspaceId: string; url: string; includeSelectors?: string[]; excludeSelectors?: string[] }
    ) => {
      try {
        const fixtureResponse = ingestE2EFixtureWebSource(payload)
        if (fixtureResponse) {
          emitSourceListRefresh(event.sender)
          return fixtureResponse
        }
        await ensureWebSourcesHydrated()
        const workspaceId = String(payload?.workspaceId || '').trim()
        const rawUrl = String(payload?.url || '').trim()
        if (!workspaceId) throw new Error('workspaceId 不能为空')
        if (!rawUrl) throw new Error('URL 不能为空')
        const workspace = await workspaceStore.getWorkspaceById(workspaceId)
        if (!workspace) throw new Error('工作区不存在')
        const { url, normalizedUrl } = webSourceService.normalizeUrl(rawUrl)
        const existing = await webSourceStore.getWebSourceByNormalizedUrl(normalizedUrl, workspaceId)
        const source =
          existing ||
          webSourceService.createWebSource({
            workspaceId,
            url,
            normalizedUrl,
            includeSelectors: payload.includeSelectors,
            excludeSelectors: payload.excludeSelectors,
            importStatus: 1
          })
        const nextSource: WebSourceRecord = {
          ...source,
          workspace_id: workspaceId,
          url,
          normalized_url: normalizedUrl,
          include_selectors: payload.includeSelectors,
          exclude_selectors: payload.excludeSelectors,
          updated_at: Date.now()
        }
        if (!existing) {
          await webSourceStore.saveWebSource(nextSource)
        } else {
          await webSourceStore.updateWebSource(existing.id, {
            url,
            include_selectors: payload.includeSelectors,
            exclude_selectors: payload.excludeSelectors,
            updated_at: nextSource.updated_at
          })
        }
        const refreshed = await refreshWebSourceRecord(event, nextSource)
        return {
          success: true,
          count: refreshed.chunkCount,
          source: refreshed.source
        }
      } catch (error: unknown) {
        console.error('❌ [INGEST-WEB] ERROR:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'ingest-webs',
    async (
      event,
      payload: Array<{
        workspaceId: string
        url: string
        includeSelectors?: string[]
        excludeSelectors?: string[]
      }>
    ) => {
      try {
        const fixtureResponse = ingestE2EFixtureWebSources(payload)
        if (fixtureResponse) {
          emitSourceListRefresh(event.sender)
          return fixtureResponse
        }
        await ensureWebSourcesHydrated()
        const items = Array.isArray(payload) ? payload : []
        const preparedSources: WebSourceRecord[] = []

        for (const item of items) {
          const workspaceId = String(item?.workspaceId || '').trim()
          const rawUrl = String(item?.url || '').trim()
          if (!workspaceId || !rawUrl) continue
          const workspace = await workspaceStore.getWorkspaceById(workspaceId)
          if (!workspace) continue
          const { url, normalizedUrl } = webSourceService.normalizeUrl(rawUrl)
          const existing = await webSourceStore.getWebSourceByNormalizedUrl(
            normalizedUrl,
            workspaceId
          )
          const source =
            existing ||
            webSourceService.createWebSource({
              workspaceId,
              url,
              normalizedUrl,
              includeSelectors: item.includeSelectors,
              excludeSelectors: item.excludeSelectors,
              importStatus: 1
            })
          const nextSource: WebSourceRecord = {
            ...source,
            workspace_id: workspaceId,
            url,
            normalized_url: normalizedUrl,
            include_selectors: item.includeSelectors,
            exclude_selectors: item.excludeSelectors,
            updated_at: Date.now()
          }
          if (!existing) {
            await webSourceStore.saveWebSource(nextSource)
          } else {
            await webSourceStore.updateWebSource(existing.id, {
              url,
              include_selectors: item.includeSelectors,
              exclude_selectors: item.excludeSelectors,
              updated_at: nextSource.updated_at
            })
          }
          preparedSources.push(nextSource)
        }

        emitSourceListRefresh(event.sender)

        const concurrency = Math.max(1, WEB_INGEST_CONCURRENCY)
        let index = 0
        const runOne = async () => {
          for (;;) {
            const current = preparedSources[index++]
            if (!current) return
            try {
              await refreshWebSourceRecord(event, current)
            } catch (error) {
              console.error('❌ [INGEST-WEBS] ERROR:', error)
            }
          }
        }

        await Promise.all(Array.from({ length: concurrency }, () => runOne()))
        return { success: true, created: preparedSources.length }
      } catch (error: unknown) {
        console.error('❌ [INGEST-WEBS] ERROR:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle('open-external', async (_event, url: string) => {
    try {
      const parsed = new URL(String(url))
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { success: false, error: '仅支持 http/https URL' }
      }
      if (isE2EFixtureModeEnabled()) {
        return { success: true }
      }
      await shell.openExternal(parsed.toString())
      return { success: true }
    } catch (error: unknown) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('open-path', async (_event, rawPath: string) => {
    try {
      const value = String(rawPath || '').trim()
      if (!value) return { success: false, error: 'path is required' }
      const resolved = path.resolve(value)
      if (!fs.existsSync(resolved)) return { success: false, error: 'path not found' }
      const err = await shell.openPath(resolved)
      if (err) return { success: false, error: err }
      return { success: true }
    } catch (error: unknown) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle(
    'open-path-with-application',
    async (
      _event,
      payload: OpenPathWithApplicationRequest
    ): Promise<OpenPathWithApplicationResponse> => {
      try {
        const filePath = path.resolve(String(payload?.filePath || '').trim())
        const appPath = path.resolve(String(payload?.appPath || '').trim())
        if (!filePath || !appPath) {
          return { success: false, error: 'filePath and appPath are required' }
        }
        if (!fs.existsSync(filePath)) return { success: false, error: 'file path not found' }
        if (!fs.existsSync(appPath)) return { success: false, error: 'application not found' }
        if (process.platform !== 'darwin') {
          return { success: false, error: 'open with application currently supports macOS only' }
        }

        await execFileAsync('/usr/bin/open', ['-a', appPath, filePath])
        return { success: true }
      } catch (error: unknown) {
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle('reveal-path', async (_event, rawPath: string) => {
    try {
      const value = String(rawPath || '').trim()
      if (!value) return { success: false, error: 'path is required' }
      const resolved = path.resolve(value)
      if (!fs.existsSync(resolved)) return { success: false, error: 'path not found' }
      shell.showItemInFolder(resolved)
      return { success: true }
    } catch (error: unknown) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('pick-directory', async (event): Promise<PickDirectoryResponse> => {
    try {
      const dialogOptions: OpenDialogOptions = {
        title: '选择工作空间目录',
        buttonLabel: '选择此目录',
        properties: ['openDirectory', 'createDirectory', 'dontAddToRecent']
      }
      let result
      try {
        const ownerWindow = BrowserWindow.fromWebContents(event.sender)
        result = ownerWindow
          ? await dialog.showOpenDialog(ownerWindow, dialogOptions)
          : await dialog.showOpenDialog(dialogOptions)
      } catch {
        result = await dialog.showOpenDialog(dialogOptions)
      }
      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true }
      }
      return { canceled: false, path: result.filePaths[0] }
    } catch (error: unknown) {
      return { canceled: true, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('pick-application', async (event): Promise<PickApplicationResponse> => {
    try {
      if (process.platform !== 'darwin') {
        return { canceled: true, error: 'pick application currently supports macOS only' }
      }
      const dialogOptions: OpenDialogOptions = {
        title: '选择要打开确认文档的应用',
        buttonLabel: '选择此应用',
        defaultPath: '/Applications',
        properties: ['openFile', 'dontAddToRecent'],
        filters: [{ name: 'Applications', extensions: ['app'] }]
      }
      let result
      try {
        const ownerWindow = BrowserWindow.fromWebContents(event.sender)
        result = ownerWindow
          ? await dialog.showOpenDialog(ownerWindow, dialogOptions)
          : await dialog.showOpenDialog(dialogOptions)
      } catch {
        result = await dialog.showOpenDialog(dialogOptions)
      }
      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true }
      }
      return { canceled: false, appPath: result.filePaths[0] }
    } catch (error: unknown) {
      return { canceled: true, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('workspace-list', async (): Promise<WorkspaceListResponse> => {
    try {
      const fixtureList = getE2EFixtureWorkspaceList()
      if (fixtureList) return fixtureList
      const items = await workspaceStore.listWorkspaces()
      return { items, total: items.length }
    } catch (error: unknown) {
      console.error('❌ [WORKSPACE-LIST] ERROR:', error)
      return { items: [], total: 0 }
    }
  })

  ipcMain.handle(
    'workspace-create',
    async (event, payload: CreateWorkspaceSourceRequest): Promise<WorkspaceMutationResponse> => {
      try {
        const fixtureCreate = createE2EFixtureWorkspace({
          rootPath: payload.rootPath,
          name: payload.name
        })
        if (fixtureCreate) {
          emitSourceListRefresh(event.sender)
          return fixtureCreate
        }
        const existingWorkspaces = await workspaceStore.listWorkspaces()
        await workspaceService.assertNoNestedWorkspace(
          payload.rootPath,
          existingWorkspaces.map((workspace) => workspace.root_path)
        )

        const workspaceId = uuidv4()
        const scanResult = await workspaceService.scanWorkspace({
          workspaceId,
          rootPath: payload.rootPath,
          workspaceName: payload.name
        })
        await workspaceStore.saveWorkspace(scanResult.workspace)
        await workspaceStore.replaceWorkspaceNodes(workspaceId, scanResult.nodes)
        emitSourceListRefresh(event.sender)
        return { success: true, workspace: scanResult.workspace }
      } catch (error: unknown) {
        console.error('❌ [WORKSPACE-CREATE] ERROR:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'workspace-delete',
    async (event, workspaceId: string): Promise<DeleteWorkspaceSourceResponse> => {
      try {
        const fixtureResponse = deleteE2EFixtureWorkspace(String(workspaceId || '').trim())
        if (fixtureResponse) {
          emitSourceListRefresh(event.sender)
          return fixtureResponse
        }
        await workspaceStore.deleteWorkspace(String(workspaceId || '').trim())
        return { success: true, deletedWorkspaceId: String(workspaceId || '').trim() }
      } catch (error: unknown) {
        console.error('❌ [WORKSPACE-DELETE] ERROR:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'workspace-nodes',
    async (_event, payload: ListWorkspaceNodesRequest): Promise<WorkspaceNodeListResponse> => {
      try {
        const fixtureNodes = getE2EFixtureWorkspaceNodes(String(payload.workspaceId || '').trim())
        if (fixtureNodes) return fixtureNodes
        const items = await workspaceStore.listWorkspaceNodes({
          workspaceId: String(payload.workspaceId || '').trim(),
          parentId: payload.parentId ? String(payload.parentId).trim() : undefined,
          kind: payload.kind
        })
        return { items, total: items.length }
      } catch (error: unknown) {
        console.error('❌ [WORKSPACE-NODES] ERROR:', error)
        return { items: [], total: 0 }
      }
    }
  )

  ipcMain.handle(
    'workspace-scan',
    async (event, payload: { workspaceId: string }): Promise<WorkspaceJobResponse> => {
      try {
        await waitForE2EFixtureDelay('scan')
        const fixtureResponse = scanE2EFixtureWorkspace(String(payload.workspaceId || '').trim())
        if (fixtureResponse) {
          emitSourceListRefresh(event.sender)
          return fixtureResponse
        }
        const workspaceId = String(payload.workspaceId || '').trim()
        const currentWorkspace = await workspaceStore.getWorkspaceById(workspaceId)
        if (!currentWorkspace) {
          return { success: false, error: 'workspace not found' }
        }

        const existingNodes = await workspaceStore.listWorkspaceNodes({ workspaceId })
        const now = Date.now()
        const scanResult = await workspaceService.scanWorkspace({
          workspaceId,
          rootPath: currentWorkspace.root_path,
          workspaceName: currentWorkspace.name,
          now
        })
        const diff = await workspaceService.diffWorkspaceNodes({
          existingNodes,
          nextNodes: scanResult.nodes,
          mode: 'full'
        })
        const mergedNodes = mergeScannedNodes({
          existingNodes,
          nextNodes: scanResult.nodes,
          changedNodes: diff.changed,
          now
        })
        const nextStatus =
          diff.changed.length > 0 || diff.added.length > 0 || diff.removed.length > 0
            ? 'stale'
            : currentWorkspace.status
        const nextWorkspace: WorkspaceSource = {
          ...currentWorkspace,
          ...scanResult.workspace,
          status: nextStatus,
          created_at: currentWorkspace.created_at,
          last_prepare_at: currentWorkspace.last_prepare_at,
          last_error: currentWorkspace.last_error,
          updated_at: now
        }

        await workspaceStore.saveWorkspace(nextWorkspace)
        await workspaceStore.replaceWorkspaceNodes(workspaceId, mergedNodes)

        return {
          success: true,
          workspaceId,
          progress: {
            workspace_id: workspaceId,
            phase: 'scan',
            total: mergedNodes.length,
            completed: mergedNodes.length,
            added: diff.added.length,
            updated: diff.changed.length,
            removed: diff.removed.length
          }
        }
      } catch (error: unknown) {
        console.error('❌ [WORKSPACE-SCAN] ERROR:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'workspace-prepare',
    async (
      event,
      payload: { workspaceId: string; mode?: string }
    ): Promise<WorkspaceJobResponse> => {
      const workspaceId = String(payload.workspaceId || '').trim()
      const mode =
        payload.mode === 'presence_only' || payload.mode === 'changes_only' ? payload.mode : 'full'
      if (!workspaceId) return { success: false, error: 'workspaceId is required' }
      if (activeWorkspacePrepareJobs.has(workspaceId)) {
        return { success: false, error: 'workspace prepare already running' }
      }

      await waitForE2EFixtureDelay('prepare')
      const fixtureResponse = prepareE2EFixtureWorkspace(workspaceId, mode)
      if (fixtureResponse) {
        emitSourceListRefresh(event.sender)
        return fixtureResponse
      }

      activeWorkspacePrepareJobs.add(workspaceId)
      try {
        const currentWorkspace = await workspaceStore.getWorkspaceById(workspaceId)
        if (!currentWorkspace) {
          return { success: false, error: 'workspace not found' }
        }

        const existingNodes = await workspaceStore.listWorkspaceNodes({ workspaceId })
        const prepareStartedAt = Date.now()
        const scanResult = await workspaceService.scanWorkspace({
          workspaceId,
          rootPath: currentWorkspace.root_path,
          workspaceName: currentWorkspace.name,
          now: prepareStartedAt
        })
        const diff = await workspaceService.diffWorkspaceNodes({
          existingNodes,
          nextNodes: scanResult.nodes,
          mode
        })
        const mergedNodes = mergeScannedNodes({
          existingNodes,
          nextNodes: scanResult.nodes,
          changedNodes: diff.changed,
          now: prepareStartedAt
        })

        const nodeMap = new Map(
          mergedNodes.map((node) => [getWorkspaceScopeKey(node), node] as const)
        )
        const basePrepareTargets = [...diff.added, ...diff.changed].filter(
          (node) => node.kind === 'file'
        )
        const basePrepareKeys = new Set(
          basePrepareTargets.map((node) => getWorkspaceScopeKey(node))
        )
        const retryTargets = mergedNodes.filter(
          (node) =>
            node.kind === 'file' &&
            (node.prepare_status === 'not_prepared' ||
              node.prepare_status === 'failed' ||
              node.prepare_status === 'stale') &&
            !basePrepareKeys.has(getWorkspaceScopeKey(node))
        )
        const prepareTargets = [...basePrepareTargets, ...retryTargets]
        for (const target of prepareTargets) {
          const key = getWorkspaceScopeKey(target)
          const currentNode = nodeMap.get(key)
          if (!currentNode) continue
          nodeMap.set(key, {
            ...currentNode,
            prepare_status: 'preparing',
            last_error: undefined,
            updated_at: Date.now()
          })
        }

        await workspaceStore.saveWorkspace({
          ...currentWorkspace,
          ...scanResult.workspace,
          status: 'preparing',
          created_at: currentWorkspace.created_at,
          last_prepare_at: currentWorkspace.last_prepare_at,
          updated_at: prepareStartedAt,
          last_error: undefined
        })
        await workspaceStore.replaceWorkspaceNodes(workspaceId, Array.from(nodeMap.values()))

        const removedDocumentIds = diff.removed
          .filter((node) => node.kind === 'file' && node.document_id)
          .map((node) => node.document_id as string)
        if (removedDocumentIds.length > 0) {
          await documentsStore.deleteDocumentsByIds(removedDocumentIds)
        }

        let completed = 0
        let failed = 0
        for (const target of prepareTargets) {
          const key = getWorkspaceScopeKey(target)
          const currentNode = nodeMap.get(key)
          if (!currentNode) continue
          const documentId = currentNode.document_id || uuidv4()
          try {
            const existingDocument = await documentsStore.getDocumentById(documentId)
            if (existingDocument) {
              await documentsStore.updateDocumentById(documentId, {
                name: currentNode.name,
                file_path: currentNode.absolute_path,
                source_type: 'file'
              })
              await documentsStore.updateDocumentImportStatus(documentId, 1)
            } else {
              await documentsStore.addDocument({
                id: documentId,
                name: currentNode.name,
                source_type: 'file',
                workspace_id: workspaceId,
                file_path: currentNode.absolute_path,
                created_at: Date.now(),
                import_status: 1
              })
            }

            await documentsStore.deleteChunksByDocumentIds([documentId])
            const splitDocs = await ingestionService.processFile(currentNode.absolute_path)
            const allSplitDocs = [...splitDocs.bigSplitDocs, ...splitDocs.miniSplitDocs]
            const vectors: Float32Array[] = []
            for (const doc of allSplitDocs) {
              const { data: vector } = await embeddingService.embed(doc.pageContent)
              vectors.push(vector)
            }

            const chunks = vectors.map((_, index) => ({
              text: allSplitDocs[index].pageContent,
              id: uuidv4(),
              document_id: documentId,
              workspace_id: workspaceId,
              document_name: currentNode.name,
              source_type: 'file',
              metadata: {
                page: allSplitDocs[index].metadata.loc?.pageNumber || 1
              }
            }))

            await documentsStore.addChunks({ vectors, chunks })
            await documentsStore.updateDocumentImportStatus(documentId, 2)

            const preparedAt = Date.now()
            const contentHash = await workspaceService.computeContentHash(currentNode.absolute_path)
            const preparedNode: WorkspaceNode = {
              ...currentNode,
              document_id: documentId,
              content_hash: contentHash,
              prepare_status: 'prepared',
              last_prepared_at: preparedAt,
              last_error: undefined,
              updated_at: preparedAt
            }
            nodeMap.set(key, preparedNode)
            await workspaceStore.updateWorkspaceNode(preparedNode.id, {
              document_id: preparedNode.document_id,
              content_hash: preparedNode.content_hash,
              prepare_status: preparedNode.prepare_status,
              last_prepared_at: preparedNode.last_prepared_at,
              last_error: preparedNode.last_error,
              updated_at: preparedNode.updated_at
            })
            completed += 1
          } catch (error: unknown) {
            failed += 1
            await documentsStore.updateDocumentImportStatus(documentId, 3).catch(() => {})
            const failedAt = Date.now()
            const failedNode: WorkspaceNode = {
              ...currentNode,
              document_id: documentId,
              prepare_status: 'failed',
              last_error: getErrorMessage(error),
              updated_at: failedAt
            }
            nodeMap.set(key, failedNode)
            await workspaceStore.updateWorkspaceNode(failedNode.id, {
              document_id: failedNode.document_id,
              prepare_status: failedNode.prepare_status,
              last_error: failedNode.last_error,
              updated_at: failedNode.updated_at
            })
          }
        }

        const finalNodes = Array.from(nodeMap.values()).sort((a, b) =>
          a.relative_path.localeCompare(b.relative_path)
        )
        const finishedAt = Date.now()
        const nextWorkspace: WorkspaceSource = {
          ...currentWorkspace,
          ...scanResult.workspace,
          status: deriveWorkspaceStatus(finalNodes),
          created_at: currentWorkspace.created_at,
          last_scan_at: scanResult.workspace.last_scan_at,
          last_prepare_at: finishedAt,
          updated_at: finishedAt,
          last_error: failed > 0 ? `${failed} file(s) failed during prepare` : undefined
        }
        await workspaceStore.saveWorkspace(nextWorkspace)
        await workspaceStore.replaceWorkspaceNodes(workspaceId, finalNodes)
        emitSourceListRefresh(event.sender)

        return {
          success: true,
          workspaceId,
          progress: {
            workspace_id: workspaceId,
            mode,
            phase: 'complete',
            total: prepareTargets.length,
            completed,
            added: diff.added.length,
            updated: diff.changed.length,
            removed: diff.removed.length,
            failed
          }
        }
      } catch (error: unknown) {
        await workspaceStore.updateWorkspace(workspaceId, {
          status: 'failed',
          last_error: getErrorMessage(error),
          updated_at: Date.now()
        })
        return { success: false, error: getErrorMessage(error), workspaceId }
      } finally {
        activeWorkspacePrepareJobs.delete(workspaceId)
      }
    }
  )

  ipcMain.handle(
    'web-source-list',
    async (_event, payload: ListWebSourcesRequest): Promise<WebSourceListResponse> => {
    try {
      const workspaceId = String(payload?.workspaceId || '').trim()
      if (!workspaceId) return { items: [], total: 0 }
      const fixtureList = getE2EFixtureWebSourceList(workspaceId)
      if (fixtureList) return fixtureList
      await ensureWebSourcesHydrated()
      const items = await webSourceStore.listWebSources(workspaceId)
      return { items, total: items.length }
    } catch (error: unknown) {
      console.error('❌ [WEB-SOURCE-LIST] ERROR:', error)
      return { items: [], total: 0 }
    }
    }
  )

  ipcMain.handle('legacy-local-import-migration-status', async () => {
    return storageService.getLegacyLocalImportMigrationStatus()
  })

  ipcMain.handle(
    'web-source-refresh',
    async (event, payload: RefreshWebSourceRequest): Promise<WebSourceMutationResponse> => {
      try {
        const workspaceId = String(payload?.workspaceId || '').trim()
        const webSourceId = String(payload?.webSourceId || '').trim()
        const fixtureResponse = refreshE2EFixtureWebSource(workspaceId, webSourceId)
        if (fixtureResponse) {
          emitSourceListRefresh(event.sender)
          return fixtureResponse
        }
        await ensureWebSourcesHydrated()
        if (!workspaceId || !webSourceId) {
          return { success: false, error: 'workspaceId and webSourceId are required' }
        }
        const source = await webSourceStore.getWebSourceById(webSourceId, workspaceId)
        if (!source) {
          return { success: false, error: 'web source not found' }
        }
        const refreshed = await refreshWebSourceRecord(event, source)
        return { success: true, source: refreshed.source }
      } catch (error: unknown) {
        console.error('❌ [WEB-SOURCE-REFRESH] ERROR:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'web-source-delete',
    async (event, payload: DeleteWebSourceRequest): Promise<DeleteWebSourceResponse> => {
      try {
        const workspaceId = String(payload?.workspaceId || '').trim()
        const safeId = String(payload?.webSourceId || '').trim()
        const fixtureResponse = deleteE2EFixtureWebSource(workspaceId, safeId)
        if (fixtureResponse) {
          emitSourceListRefresh(event.sender)
          return fixtureResponse
        }
        await ensureWebSourcesHydrated()
        if (!workspaceId || !safeId) {
          return { success: false, error: 'workspaceId and webSourceId are required' }
        }
        const source = await webSourceStore.getWebSourceById(safeId, workspaceId)
        if (!source) {
          return { success: false, error: 'web source not found' }
        }
        if (source.document_id) {
          await documentsStore.deleteDocumentsByIds([source.document_id])
        }
        await webSourceStore.deleteWebSource(safeId, workspaceId)
        emitSourceListRefresh(event.sender)
        return { success: true, deletedWebSourceId: safeId }
      } catch (error: unknown) {
        console.error('❌ [WEB-SOURCE-DELETE] ERROR:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'reference-item-list',
    async (_event, payload: ListReferenceItemsRequest): Promise<ReferenceItemListResponse> => {
      try {
        const e2eReferences = getE2EFixtureReferenceItems(payload)
        if (e2eReferences) {
          return e2eReferences
        }

        await ensureWebSourcesHydrated()
        const workspaceIdFilter = String(payload.workspaceId || '').trim()
        const referenceKindFilters = normalizeReferenceKindFilters(payload.referenceKinds)
        const localReferences: SelectedReference[] = []

        if (workspaceIdFilter) {
          const workspace = await workspaceStore.getWorkspaceById(workspaceIdFilter)
          if (workspace) {
            const nodes = await workspaceStore.listWorkspaceNodes({ workspaceId: workspace.id })
            localReferences.push(...buildWorkspaceReferenceItems(workspace, nodes))
          }
        }

        const webReferences = workspaceIdFilter
          ? (await webSourceStore.listWebSources(workspaceIdFilter)).map(buildWebReferenceItem)
          : []

        const allReferences = [...localReferences, ...webReferences]
          .filter((reference) => referenceMatchesQuery(reference, payload.query))
          .filter((reference) =>
            referenceKindFilters ? referenceKindFilters.has(reference.kind) : true
          )
          .filter((reference) =>
            payload.mode === 'search' ? shouldIncludeReferenceInSearch(reference) : true
          )

        return { items: allReferences, total: allReferences.length }
      } catch (error: unknown) {
        console.error('❌ [REFERENCE-ITEM-LIST] ERROR:', error)
        return { items: [], total: 0 }
      }
    }
  )

  ipcMain.handle(
    'search',
    async (_event, query: string, sourceType?: 'all' | 'file' | 'web', documentIds?: string[]) => {
      try {
        const fixtureSearch = getE2EFixtureSearchResponse(query, documentIds)
        if (fixtureSearch) {
          return fixtureSearch
        }
        const { data: queryVector } = await embeddingService.embed(query)
        const filter = sourceType && sourceType !== 'all' ? sourceType : undefined
        const results = await documentsStore.search(
          queryVector,
          query,
          5,
          filter,
          undefined,
          documentIds
        )

        const tokens = jieba.cutForSearch(query, true)

        const finalResults = results.map(normalizeForIpc)

        return {
          results: finalResults,
          tokens
        }
      } catch (error: unknown) {
        console.error('❌ [SEARCH] ERROR:', error)
        throw error
      }
    }
  )

  ipcMain.handle(
    'fts-search',
    async (
      _event,
      query: string,
      sourceType?: 'all' | 'file' | 'web',
      documentIds?: string[]
    ): Promise<SearchResult[]> => {
      try {
        const filter = sourceType && sourceType !== 'all' ? sourceType : undefined
        const results = await documentsStore.ftsSearch(query, 20, filter, undefined, documentIds)
        const normalized = results.map(normalizeForIpc)
        // console.log('🔎 [FTS-SEARCH] RESULTS:', normalized)
        return normalized
      } catch (error: unknown) {
        console.error('❌ [FTS-SEARCH] ERROR:', error)
        return []
      }
    }
  )

  ipcMain.handle(
    'vector-search',
    async (
      _event,
      query: string,
      sourceType?: 'all' | 'file' | 'web',
      documentIds?: string[]
    ): Promise<SearchResult[]> => {
      try {
        const { data: queryVector } = await embeddingService.embed(query)
        const filter = sourceType && sourceType !== 'all' ? sourceType : undefined
        const results = await documentsStore.vectorSearch(
          queryVector,
          20,
          filter,
          undefined,
          documentIds
        )
        const normalized = results.map(normalizeForIpc)
        console.log('🔎 [VECTOR-SEARCH] RESULTS:', normalized)
        return normalized
      } catch (error: unknown) {
        console.error('❌ [VECTOR-SEARCH] ERROR:', error)
        return []
      }
    }
  )

  ipcMain.handle(
    'hybrid-search',
    async (
      _event,
      query: string,
      sourceType?: 'all' | 'file' | 'web',
      documentIds?: string[]
    ): Promise<SearchResult[]> => {
      try {
        const { data: queryVector } = await embeddingService.embed(query)
        const filter = sourceType && sourceType !== 'all' ? sourceType : undefined
        const results = await documentsStore.hybridSearch(
          queryVector,
          query,
          20,
          filter,
          undefined,
          documentIds
        )
        const normalized = results.map(normalizeForIpc)
        console.log('🔎 [HYBRID-SEARCH] RESULTS:', normalized)
        return normalized
      } catch (error: unknown) {
        console.error('❌ [HYBRID-SEARCH] ERROR:', error)
        return []
      }
    }
  )

  ipcMain.handle(
    'list-documents',
    async (
      _event,
      payload: { query?: string; page: number; pageSize: number }
    ): Promise<DocumentListResponse> => {
      try {
        const { query, page, pageSize } = payload
        const res = await documentsStore.listDocuments({ query, page, pageSize })
        return res
      } catch (error: unknown) {
        console.error('❌ [LIST-DOCUMENTS] ERROR:', error)
        return { items: [], total: 0 }
      }
    }
  )

  ipcMain.handle(
    'list-chunks',
    async (
      _event,
      payload: { query?: string; page: number; pageSize: number }
    ): Promise<ChunkListResponse> => {
      try {
        const { query, page, pageSize } = payload
        const res = await documentsStore.listChunks({ query, page, pageSize })
        const normalized = res.items.map(normalizeForIpc)
        return { items: normalized, total: res.total }
      } catch (error: unknown) {
        console.error('❌ [LIST-CHUNKS] ERROR:', error)
        return { items: [], total: 0 }
      }
    }
  )

  ipcMain.handle('drop-documents-table', async () => {
    try {
      const result = await documentsStore.dropDocumentsStorage()
      console.log('🗑️ [DROP-DOCUMENTS] DONE:', result)
      return { success: true, existed: result.existed }
    } catch (error: unknown) {
      console.error('❌ [DROP-DOCUMENTS] ERROR:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('delete-documents', async (event, ids: string[]) => {
    try {
      console.log('🗑️ [DELETE-DOCUMENTS] REQUEST:', ids)
      const res = await documentsStore.deleteDocumentsByIds(ids || [])
      console.log('🗑️ [DELETE-DOCUMENTS] DONE:', res)
      emitSourceListRefresh(event.sender)
      return res
    } catch (error: unknown) {
      console.error('❌ [DELETE-DOCUMENTS] ERROR:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('read-file', async (_event, filePath: string) => {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`)
      }
      const buffer = fs.readFileSync(filePath)
      return buffer
    } catch (error: unknown) {
      console.error('❌ [READ-FILE] ERROR:', error)
      throw error
    }
  })

  ipcMain.handle('download-model', async (event, repoId: string) => {
    try {
      const result = await modelService.downloadModel(repoId, (payload) => {
        event.sender.send('download-progress', payload)
      })
      // After successful download, re-initialize embedding service
      await embeddingService.initialize()
      return result
    } catch (error: unknown) {
      console.error('❌ [DOWNLOAD-MODEL] ERROR:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('get-models', async () => {
    try {
      return modelService.getModels()
    } catch (error: unknown) {
      console.error('❌ [GET-MODELS] ERROR:', error)
      return []
    }
  })

  ipcMain.handle('get-embedding-status', () => {
    return embeddingService.getStatus()
  })

  ipcMain.handle(
    'ai-run-start',
    async (event, payload: AiRunStartRequest): Promise<AiRunStartResponse> => {
      const sessionId = String(payload?.sessionId || '').trim()
      const input = String(payload?.input || '').trim()
      const modelConfigId = payload?.modelConfigId
        ? String(payload.modelConfigId).trim()
        : undefined
      const selectedReferences = normalizeSelectedReferences(payload?.selectedReferences)
      const workspace =
        payload?.workspace &&
        String(payload.workspace.workspaceId || '').trim() &&
        String(payload.workspace.workspaceName || '').trim() &&
        String(payload.workspace.rootPath || '').trim()
          ? {
              workspaceId: String(payload.workspace.workspaceId).trim(),
              workspaceName: String(payload.workspace.workspaceName).trim(),
              rootPath: String(payload.workspace.rootPath).trim(),
              policyProfile: payload.workspace.policyProfile
                ? String(payload.workspace.policyProfile)
                : undefined
            }
            : undefined
      const e2eFixtureScenario = isE2EFixtureModeEnabled() ? matchE2EChatScenario(input) : null
      if (!sessionId) return { success: false, error: 'sessionId is required' }
      if (!input) return { success: false, error: 'input is required' }

      const runId = uuidv4()
      activeAiRuns.set(runId, { cancelled: false, senderId: event.sender.id })
      activeAiApprovals.set(runId, new Map())

      const sendEvent = (evt: AiRunEvent) => {
        if (event.sender.isDestroyed()) return
        event.sender.send('ai-run-event', evt)
      }

      if (!e2eFixtureScenario) {
        const validation = await validateSelectedReferencesForRun({
          references: selectedReferences,
          workspaceStore,
          webSourceStore,
          sendEvent,
          runId
        })
        if (!validation.ok) {
          activeAiApprovals.delete(runId)
          activeAiRuns.delete(runId)
          return { success: false, error: validation.error }
        }
      }

      sendEvent({ type: 'run_started', runId, sessionId, createdAt: Date.now(), input })
      draftReviewService.beginRun({
        runId,
        sessionId,
        inputText: input
      })
      ;(async () => {
        try {
          const handledByE2EFixture = await maybeHandleE2EFixtureRun({
            runId,
            inputText: input,
            workspace,
            sendEvent,
            draftReviewService
          })
          if (handledByE2EFixture) {
            return
          }

          const runtimeSettings = await aiRuntimeSettingsStore.get()
          const result = await AiRunService.getInstance().run(
            {
              runId,
              sessionId,
              input,
              selectedReferences,
              modelConfigId,
              workspace
            },
            {
              runtimeSettings,
              llmStore,
              chatStore,
              documentsStore,
              embeddingService,
              ensureEmbeddingReady: async () => {
                await ensureEmbeddingReady({
                  embeddingService,
                  modelService
                })
              },
              draftReviewService,
              isCancelled: () => Boolean(activeAiRuns.get(runId)?.cancelled),
              sendEvent,
              recordLlmIo: services.recordLlmIo,
              requestApproval: async (request) => {
                const approvals = activeAiApprovals.get(runId)
                if (!approvals) return { approved: false, reason: 'run not active' }

                const approvalId = uuidv4()
                sendEvent({
                  type: 'approval_required',
                  runId,
                  taskId: request.taskId,
                  approvalId,
                  command: request.command,
                  riskLevel: request.riskLevel,
                  reason: request.reason,
                  createdAt: Date.now(),
                  internal: request.internal,
                  stage: request.stage
                })

                return await new Promise<{ approved: boolean; reason?: string }>((resolve) => {
                  const timeout = setTimeout(() => {
                    approvals.delete(approvalId)
                    sendEvent({
                      type: 'approval_decision',
                      runId,
                      taskId: request.taskId,
                      approvalId,
                      approved: false,
                      reason: 'approval timeout',
                      decidedAt: Date.now(),
                      internal: request.internal,
                      stage: request.stage
                    })
                    sendEvent({
                      type: 'runtime_issue',
                      runId,
                      code: 'approval_denied',
                      message: '审批超时，当前命令不会继续执行。',
                      taskId: request.taskId,
                      createdAt: Date.now(),
                      internal: request.internal,
                      stage: request.stage
                    })
                    resolve({ approved: false, reason: 'approval timeout' })
                  }, 60_000)

                  approvals.set(approvalId, {
                    taskId: request.taskId,
                    resolve: (decision) => {
                      clearTimeout(timeout)
                      approvals.delete(approvalId)
                      sendEvent({
                        type: 'approval_decision',
                        runId,
                        taskId: request.taskId,
                        approvalId,
                        approved: Boolean(decision.approved),
                        reason: decision.reason,
                        decidedAt: Date.now(),
                        internal: request.internal,
                        stage: request.stage
                      })
                      if (!decision.approved) {
                        sendEvent({
                          type: 'runtime_issue',
                          runId,
                          code: 'approval_denied',
                          message: decision.reason || '审批未通过，当前命令不会继续执行。',
                          taskId: request.taskId,
                          createdAt: Date.now(),
                          internal: request.internal,
                          stage: request.stage
                        })
                      }
                      resolve({
                        approved: Boolean(decision.approved),
                        reason: decision.reason
                      })
                    }
                  })
                })
              }
            }
          )

          if (result.status === 'cancelled') {
            draftReviewService.discardRun(runId)
            sendEvent({ type: 'run_cancelled', runId })
            return
          }

          if (result.status === 'failed') {
            draftReviewService.discardRun(runId)
            sendEvent({ type: 'run_failed', runId, error: result.error || 'failed' })
            return
          }

          try {
            await updateSessionMemoryAfterRun({
              runId,
              sessionId,
              userInput: input,
              assistantOutput: result.finalDeliveryMarkdown || '',
              runtimeSettings,
              chatStore,
              llmStore,
              sendEvent,
              recordLlmIo: services.recordLlmIo
            })
          } catch (e) {
            void e
          }

          sendEvent({ type: 'run_completed', runId })
        } catch (e: unknown) {
          draftReviewService.discardRun(runId)
          if (activeAiRuns.get(runId)?.cancelled) {
            sendEvent({ type: 'run_cancelled', runId })
            return
          }
          const msg = e instanceof Error ? getErrorMessage(e) : String(e)
          sendEvent({ type: 'run_failed', runId, error: msg })
        } finally {
          await releaseDocxRunSession(runId)
          const approvals = activeAiApprovals.get(runId)
          if (approvals) {
            for (const [approvalId, pending] of approvals.entries()) {
              pending.resolve({ approved: false, reason: 'run closed' })
              approvals.delete(approvalId)
            }
          }
          activeAiApprovals.delete(runId)
          activeAiRuns.delete(runId)
        }
      })()

      return { success: true, runId }
    }
  )

  ipcMain.handle('ai-run-cancel', async (_event, runId: string): Promise<AiRunCancelResponse> => {
    const entry = activeAiRuns.get(String(runId || ''))
    if (!entry) return { success: false, error: 'run not found' }
    entry.cancelled = true
    return { success: true }
  })

  ipcMain.handle(
    'ai-run-approval-decide',
    async (
      _event,
      payload: AiRunApprovalDecisionRequest
    ): Promise<AiRunApprovalDecisionResponse> => {
      const runId = String(payload?.runId || '').trim()
      const approvalId = String(payload?.approvalId || '').trim()
      if (!runId || !approvalId) {
        return { success: false, error: 'runId and approvalId are required' }
      }

      const approvals = activeAiApprovals.get(runId)
      if (!approvals) return { success: false, error: 'run not found' }

      const pending = approvals.get(approvalId)
      if (!pending) return { success: false, error: 'approval not found' }

      pending.resolve({
        approved: Boolean(payload?.approved),
        reason: payload?.reason ? String(payload.reason) : undefined
      })

      return { success: true }
    }
  )

  ipcMain.handle(
    'draft-review-list',
    async (_event, payload?: ListDraftReviewsRequest): Promise<ListDraftReviewsResponse> => {
      try {
        return await draftReviewService.listReviews(payload)
      } catch (e: unknown) {
        console.error('[DRAFT-REVIEW-LIST] Error:', e)
        return { items: [], total: 0 }
      }
    }
  )

  ipcMain.handle(
    'draft-review-get',
    async (_event, payload: GetDraftReviewRequest): Promise<GetDraftReviewResponse> => {
      try {
        return await draftReviewService.getReview(payload)
      } catch (e: unknown) {
        console.error('[DRAFT-REVIEW-GET] Error:', e)
        return { error: getErrorMessage(e) }
      }
    }
  )

  ipcMain.handle(
    'draft-review-validate',
    async (_event, payload: ValidateDraftCommitRequest): Promise<ValidateDraftCommitResponse> => {
      try {
        return await draftReviewService.validateCommit(payload)
      } catch (e: unknown) {
        console.error('[DRAFT-REVIEW-VALIDATE] Error:', e)
        return {
          ready: false,
          issues: [
            {
              code: 'session_not_ready',
              message: getErrorMessage(e)
            }
          ]
        }
      }
    }
  )

  ipcMain.handle(
    'draft-review-commit',
    async (_event, payload: CommitDraftReviewRequest): Promise<CommitDraftReviewResponse> => {
      try {
        return await draftReviewService.commitReview(payload)
      } catch (e: unknown) {
        console.error('[DRAFT-REVIEW-COMMIT] Error:', e)
        return { success: false, error: getErrorMessage(e) }
      }
    }
  )

  ipcMain.handle(
    'draft-review-discard',
    async (_event, payload: DiscardDraftReviewRequest): Promise<DiscardDraftReviewResponse> => {
      try {
        return await draftReviewService.discardReview(payload)
      } catch (e: unknown) {
        console.error('[DRAFT-REVIEW-DISCARD] Error:', e)
        return { success: false, error: getErrorMessage(e) }
      }
    }
  )

  // === Chat & LLM Handlers ===

  ipcMain.handle('chat-session-list', async () => {
    try {
      return await chatStore.getChatSessions()
    } catch (e: unknown) {
      console.error('[CHAT-SESSION-LIST] Error:', e)
      return []
    }
  })

  ipcMain.handle('chat-session-save', async (_event, session: ChatSession) => {
    try {
      await chatStore.saveChatSession(session)
      return { success: true }
    } catch (e: unknown) {
      console.error('[CHAT-SESSION-SAVE] Error:', e)
      return { success: false, error: getErrorMessage(e) }
    }
  })

  ipcMain.handle('chat-session-delete', async (_event, id: string) => {
    try {
      await chatStore.deleteChatSession(id)
      return { success: true }
    } catch (e: unknown) {
      console.error('[CHAT-SESSION-DELETE] Error:', e)
      return { success: false, error: getErrorMessage(e) }
    }
  })

  ipcMain.handle('chat-message-list', async (_event, sessionId: string) => {
    try {
      return await chatStore.getChatMessages(sessionId)
    } catch (e: unknown) {
      console.error('[CHAT-MESSAGE-LIST] Error:', e)
      return []
    }
  })

  ipcMain.handle('chat-message-save', async (_event, message: ChatMessage) => {
    try {
      await chatStore.saveChatMessage(message)
      return { success: true }
    } catch (e: unknown) {
      console.error('[CHAT-MESSAGE-SAVE] Error:', e)
      return { success: false, error: getErrorMessage(e) }
    }
  })

  ipcMain.handle('llm-config-list', async () => {
    try {
      return await llmStore.list()
    } catch (e: unknown) {
      console.error('[LLM-CONFIG-LIST] Error:', e)
      return []
    }
  })

  ipcMain.handle('llm-config-save', async (_event, config: LLMConfig) => {
    try {
      await llmStore.save(config)
      return { success: true }
    } catch (e: unknown) {
      console.error('[LLM-CONFIG-SAVE] Error:', e)
      return { success: false, error: getErrorMessage(e) }
    }
  })

  ipcMain.handle('llm-config-delete', async (_event, id: string) => {
    try {
      await llmStore.delete(id)
      return { success: true }
    } catch (e: unknown) {
      console.error('[LLM-CONFIG-DELETE] Error:', e)
      return { success: false, error: getErrorMessage(e) }
    }
  })

  ipcMain.handle('llm-config-set-active', async (_event, id: string) => {
    try {
      await llmStore.setActive(id)
      return { success: true }
    } catch (e: unknown) {
      console.error('[LLM-CONFIG-SET-ACTIVE] Error:', e)
      return { success: false, error: getErrorMessage(e) }
    }
  })

  ipcMain.handle('ai-runtime-settings-get', async () => {
    try {
      return await aiRuntimeSettingsStore.get()
    } catch (e: unknown) {
      console.error('[AI-RUNTIME-SETTINGS-GET] Error:', e)
      return {
        llmStreamingMode: 'force_stream'
      }
    }
  })

  ipcMain.handle('ai-runtime-settings-save', async (_event, settings: AiRuntimeSettings) => {
    try {
      await aiRuntimeSettingsStore.save(settings)
      return { success: true }
    } catch (e: unknown) {
      console.error('[AI-RUNTIME-SETTINGS-SAVE] Error:', e)
      return { success: false, error: getErrorMessage(e) }
    }
  })
}
