import { createHash } from 'node:crypto'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { createWorkspaceKnowledgeCache } from '../../../src/main/services/workspace/WorkspaceKnowledgeCache'
import { WorkspaceKnowledgePrepareService } from '../../../src/main/services/workspace/WorkspaceKnowledgePrepareService'
import { WorkspaceSourceService } from '../../../src/main/services/workspace/WorkspaceSourceService'
import { prepareWorkspaceSource } from '../../../src/main/services/workspace/worker/workspacePrepareWorker'
import type {
  BackendTestRuntime,
  SeedKbDocumentInput,
  WorkspaceKbSeedInput,
  WorkspaceKbSeedResult
} from './test-types'

const TEST_WORKSPACE_ID = 'test-workspace'

type WorkspaceKbSeedExecutionResult = {
  results: WorkspaceKbSeedResult[]
  kbDocuments: SeedKbDocumentInput[]
}

const normalizeRelativePath = (value: string): string =>
  path.posix
    .normalize(
      String(value || '')
        .trim()
        .split(path.sep)
        .join('/')
    )
    .replace(/^\/+/, '')

const toDocumentId = (relativePath: string): string =>
  `workspace-file-${createHash('sha1').update(normalizeRelativePath(relativePath)).digest('hex')}`

const createSkippedResult = (input: {
  relativePath: string
  absolutePath: string
  name: string
  fileExt?: string
  error?: string
}): WorkspaceKbSeedResult => ({
  relativePath: input.relativePath,
  absolutePath: input.absolutePath,
  name: input.name,
  fileExt: input.fileExt,
  supported: false,
  status: input.error ? 'failed' : 'skipped',
  kbAvailability: 'not_indexed',
  kbDocumentIds: [],
  cache: {
    split: false,
    vector: false
  },
  error: input.error
})

export const seedWorkspaceKb = async (input: {
  runtime: BackendTestRuntime
  params: WorkspaceKbSeedInput
}): Promise<WorkspaceKbSeedExecutionResult> => {
  const workspaceService = new WorkspaceSourceService()
  const cache = createWorkspaceKnowledgeCache() ?? undefined
  const prepareService = new WorkspaceKnowledgePrepareService({
    embeddingService: input.runtime.embeddingService,
    documentsStore: input.runtime.documentsStore,
    prepareSource: prepareWorkspaceSource
  })

  const scan = await workspaceService.scanWorkspaceTree({
    workspaceId: TEST_WORKSPACE_ID,
    rootPath: input.runtime.workspaceRoot,
    workspaceName: TEST_WORKSPACE_ID
  })
  const supportedNodes = scan.entries.filter(
    (node) => node.kind === 'file' && node.supported_for_index
  )
  const supportedNodeMap = new Map(
    supportedNodes.map((node) => [normalizeRelativePath(node.relative_path), node] as const)
  )
  const requestedPaths = [...(input.params.relativePaths || [])].map(normalizeRelativePath)
  const requestedPathSet = new Set(requestedPaths)

  const results: WorkspaceKbSeedResult[] = []
  const kbDocuments: SeedKbDocumentInput[] = []

  if (input.params.mode === 'include-only') {
    for (const requestedPath of requestedPaths) {
      const node = supportedNodeMap.get(requestedPath)
      if (node) continue
      const absolutePath = path.join(input.runtime.workspaceRoot, requestedPath)
      let exists = false
      try {
        await access(absolutePath)
        exists = true
      } catch {
        exists = false
      }
      results.push(
        createSkippedResult({
          relativePath: requestedPath,
          absolutePath,
          name: path.basename(requestedPath) || requestedPath,
          fileExt: path.extname(requestedPath).toLowerCase() || undefined,
          error: exists ? undefined : 'workspace file not found'
        })
      )
    }
  }

  const targetNodes = supportedNodes.filter((node) => {
    const normalizedPath = normalizeRelativePath(node.relative_path)
    if (input.params.mode === 'all-supported') return true
    if (input.params.mode === 'include-only') {
      return requestedPathSet.has(normalizedPath)
    }
    return !requestedPathSet.has(normalizedPath)
  })

  for (const node of targetNodes) {
    const relativePath = normalizeRelativePath(node.relative_path)
    const absolutePath = node.absolute_path
    try {
      const indexed = await prepareService.indexLocalFile({
        workspaceId: TEST_WORKSPACE_ID,
        documentId: toDocumentId(relativePath),
        filePath: absolutePath,
        documentName: node.name,
        cache
      })
      results.push({
        relativePath,
        absolutePath,
        name: node.name,
        fileExt: path.extname(absolutePath).toLowerCase() || undefined,
        supported: true,
        status: 'indexed',
        documentId: indexed.documentId,
        chunkCount: indexed.chunkCount,
        kbAvailability: 'indexed',
        kbDocumentIds: [indexed.documentId],
        cache: {
          split: indexed.usedCachedSplit,
          vector: indexed.usedCachedVectors
        }
      })
      kbDocuments.push({
        id: indexed.documentId,
        name: indexed.documentName,
        workspaceId: TEST_WORKSPACE_ID,
        sourceType: 'file',
        filePath: indexed.filePath,
        chunks: indexed.chunks.map((chunk) => ({
          id: chunk.id,
          text: chunk.text,
          page: chunk.page
        }))
      })
    } catch (error: unknown) {
      results.push({
        relativePath,
        absolutePath,
        name: node.name,
        fileExt: path.extname(absolutePath).toLowerCase() || undefined,
        supported: true,
        status: 'failed',
        kbAvailability: 'not_indexed',
        kbDocumentIds: [],
        cache: {
          split: false,
          vector: false
        },
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return {
    results: results.sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
    kbDocuments
  }
}
