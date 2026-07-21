import * as lancedb from '@lancedb/lancedb'
import type {
  ChunkInput,
  ChunkListResponse,
  DocumentListResponse,
  DocumentRecord,
  SearchResult,
  WebSourceRecord
} from '../../../types/store'
import { asRecord, toNumber, toNumberArray, toOptionalNumber, toOptionalString, toString } from '../../../utils/decoder'
import { LanceDbCore, LANCE_TABLES } from '../core/LanceDbCore'
import type { SqliteCore } from '../sqlite/SqliteCore'
import {
  buildInClause,
  buildWhere,
  insertOrReplace,
  toRequiredNumber,
  updateById
} from '../sqlite/sqliteUtils'

const DEFAULT_CHUNK_BATCH_SIZE = 128
const DEFAULT_CHUNK_BATCH_MAX_TEXT_BYTES = 4 * 1024 * 1024

type ChunkRow = Record<string, unknown> & {
  id?: unknown
  text?: unknown
  document_name?: unknown
  document_id?: unknown
  workspace_id?: unknown
  source_type?: unknown
  generation_id?: unknown
  chunk_index?: unknown
  metadata?: unknown
  created_at?: unknown
  vector?: unknown
}

type DocumentRow = Record<string, unknown> & {
  id?: unknown
  name?: unknown
  source_type?: unknown
  workspace_id?: unknown
  file_path?: unknown
  created_at?: unknown
  updated_at?: unknown
  import_status?: unknown
  content_hash?: unknown
  active_generation_id?: unknown
  last_error?: unknown
  source_id?: unknown
  source_url?: unknown
  source_title?: unknown
  normalized_source_url?: unknown
  fetched_at?: unknown
}

const normalizeSourceType = (value: unknown): DocumentRecord['source_type'] =>
  String(value || '') === 'web' ? 'web' : 'file'

const normalizeChunkMetadata = (value: unknown): SearchResult['metadata'] => {
  if (value == null) return undefined
  if (typeof value === 'string') return value
  const row = asRecord(value)
  return { page: toNumber(row.page, 1) }
}

const toDocumentRecord = (value: unknown): DocumentRecord => {
  const row = asRecord(value) as DocumentRow
  const status = toNumber(row.import_status, 2)
  const importStatus = (status === 1 ? 1 : status === 3 ? 3 : 2) as 1 | 2 | 3
  return {
    id: toString(row.id),
    name: toString(row.name),
    source_type: normalizeSourceType(row.source_type),
    workspace_id: toOptionalString(row.workspace_id),
    file_path: toOptionalString(row.file_path),
    created_at: toNumber(row.created_at),
    import_status: importStatus,
    content_hash: toOptionalString(row.content_hash),
    active_generation_id: toOptionalString(row.active_generation_id),
    updated_at: toOptionalNumber(row.updated_at),
    last_error: toOptionalString(row.last_error),
    source_id: toOptionalString(row.source_id),
    source_url: toOptionalString(row.source_url),
    source_title: toOptionalString(row.source_title),
    normalized_source_url: toOptionalString(row.normalized_source_url),
    fetched_at: toOptionalNumber(row.fetched_at)
  }
}

const toSearchResult = (value: unknown): SearchResult => {
  const row = asRecord(value) as ChunkRow
  return {
    id: toString(row.id),
    text: toString(row.text),
    document_name: toString(row.document_name),
    document_id: toOptionalString(row.document_id),
    source_type: toOptionalString(row.source_type),
    metadata: normalizeChunkMetadata(row.metadata),
    _distance: toOptionalNumber(row._distance),
    created_at: toNumber(row.created_at),
    _score: toOptionalNumber(row._score),
    _relevance_score: toOptionalNumber(row._relevance_score)
  }
}

export class DocumentsStore {
  private reranker: lancedb.rerankers.RRFReranker | null = null

  public constructor(
    private readonly sqlite: SqliteCore,
    private readonly vector: LanceDbCore
  ) {}

  private async getRRFReranker(): Promise<lancedb.rerankers.RRFReranker> {
    if (this.reranker) return this.reranker
    this.reranker = await lancedb.rerankers.RRFReranker.create()
    return this.reranker
  }

  private async getActiveGenerationIds(input: {
    workspaceId?: string
    sourceType?: string
    documentIds?: string[]
  }): Promise<string[]> {
    const params: Record<string, string | number | null> = {
      workspace_id: input.workspaceId || null,
      source_type: input.sourceType || null
    }
    const where = buildWhere([
      input.workspaceId ? 'workspace_id = @workspace_id' : undefined,
      input.sourceType ? 'source_type = @source_type' : undefined,
      buildInClause('id', input.documentIds, params, 'document_id'),
      'active_generation_id IS NOT NULL'
    ])
    const rows = this.sqlite
      .prepare(`SELECT active_generation_id FROM document WHERE ${where}`)
      .all(params) as Array<{ active_generation_id?: unknown }>
    return Array.from(
      new Set(rows.map((row) => toOptionalString(row.active_generation_id)).filter(Boolean))
    ) as string[]
  }

  private async buildChunkWhere(input: {
    workspaceId?: string
    sourceType?: string
    documentIds?: string[]
    activeOnly?: boolean
  }): Promise<string | undefined> {
    const parts = [
      input.workspaceId
        ? `workspace_id = '${this.vector.escapeSqlString(input.workspaceId)}'`
        : undefined,
      input.sourceType
        ? `source_type = '${this.vector.escapeSqlString(input.sourceType)}'`
        : undefined,
      this.vector.buildInClause('document_id', input.documentIds)
    ]
    if (input.activeOnly !== false) {
      const generations = await this.getActiveGenerationIds(input)
      if (generations.length === 0) return 'generation_id = \'__no_active_generation__\''
      parts.push(this.vector.buildInClause('generation_id', generations))
    }
    return this.vector.combineWhere(parts)
  }

  private buildDocumentWhere(input: {
    workspaceId?: string
    sourceNameQuery?: string
    sourceType?: DocumentRecord['source_type']
    documentIds?: string[]
  }): { where: string; params: Record<string, string | number | null> } {
    const params: Record<string, string | number | null> = {
      workspace_id: input.workspaceId || null,
      source_type: input.sourceType || null,
      source_name_query: input.sourceNameQuery ? `%${input.sourceNameQuery.trim()}%` : null
    }
    return {
      where: buildWhere([
        input.workspaceId ? 'workspace_id = @workspace_id' : undefined,
        input.sourceType ? 'source_type = @source_type' : undefined,
        input.sourceNameQuery?.trim() ? 'name LIKE @source_name_query' : undefined,
        buildInClause('id', input.documentIds, params, 'document_id')
      ]),
      params
    }
  }

  public async addDocument(doc: DocumentRecord): Promise<void> {
    insertOrReplace(this.sqlite, 'document', {
      id: doc.id,
      name: doc.name,
      source_type: doc.source_type,
      workspace_id: doc.workspace_id,
      file_path: doc.file_path,
      import_status: doc.import_status,
      content_hash: doc.content_hash,
      active_generation_id: doc.active_generation_id,
      created_at: doc.created_at,
      updated_at: doc.updated_at ?? doc.created_at,
      last_error: doc.last_error,
      source_id: doc.source_id,
      source_url: doc.source_url,
      source_title: doc.source_title,
      normalized_source_url: doc.normalized_source_url,
      fetched_at: doc.fetched_at
    })
  }

  public async updateDocumentImportStatus(id: string, status: number): Promise<void> {
    updateById(this.sqlite, 'document', id, {
      import_status: status,
      updated_at: Date.now(),
      last_error: status === 3 ? undefined : null
    })
  }

  public async updateDocumentById(
    id: string,
    values: Partial<
      Pick<
        DocumentRecord,
        | 'name'
        | 'file_path'
        | 'source_type'
        | 'workspace_id'
        | 'content_hash'
        | 'active_generation_id'
        | 'updated_at'
        | 'last_error'
      >
    >
  ): Promise<void> {
    updateById(this.sqlite, 'document', id, {
      name: values.name,
      file_path: values.file_path,
      source_type: values.source_type,
      workspace_id: values.workspace_id,
      content_hash: values.content_hash,
      active_generation_id: values.active_generation_id,
      updated_at: values.updated_at ?? Date.now(),
      last_error: values.last_error
    })
  }

  public async activateDocumentGeneration(input: {
    documentId: string
    generationId: string
    contentHash?: string
    importStatus?: number
    updatedAt?: number
    lastError?: string | null
  }): Promise<void> {
    updateById(this.sqlite, 'document', input.documentId, {
      active_generation_id: input.generationId,
      content_hash: input.contentHash,
      import_status: input.importStatus ?? 2,
      updated_at: input.updatedAt ?? Date.now(),
      last_error: input.lastError ?? null
    })
  }

  public async markDocumentIndexing(id: string, now = Date.now()): Promise<void> {
    updateById(this.sqlite, 'document', id, {
      import_status: 1,
      updated_at: now,
      last_error: null
    })
  }

  public async markDocumentIndexFailed(id: string, error: string, now = Date.now()): Promise<void> {
    updateById(this.sqlite, 'document', id, {
      import_status: 3,
      updated_at: now,
      last_error: error
    })
  }

  public async getDocumentById(id: string): Promise<DocumentRecord | null> {
    const row = this.sqlite.prepare('SELECT * FROM document WHERE id = ?').get(id) as
      | DocumentRow
      | undefined
    if (!row) return null
    const [document] = await this.attachWebSourceMetadata([toDocumentRecord(row)])
    return document || null
  }

  public async getDocumentByFilePath(filePath: string): Promise<DocumentRecord | null> {
    const normalized = String(filePath || '').trim()
    if (!normalized) return null
    const row = this.sqlite.prepare('SELECT * FROM document WHERE file_path = ? LIMIT 1').get(normalized) as
      | DocumentRow
      | undefined
    if (!row) return null
    const [document] = await this.attachWebSourceMetadata([toDocumentRecord(row)])
    return document || null
  }

  public async deleteChunksByDocumentIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    const table = await this.vector.openTable(LANCE_TABLES.CHUNK)
    const where = this.vector.buildInClause('document_id', ids)
    if (!where) return
    await table.delete(where)
  }

  public async deleteChunksByGeneration(input: {
    documentId?: string
    workspaceId?: string
    generationId: string
  }): Promise<void> {
    const table = await this.vector.openTable(LANCE_TABLES.CHUNK)
    const where = this.vector.combineWhere([
      input.documentId
        ? `document_id = '${this.vector.escapeSqlString(input.documentId)}'`
        : undefined,
      input.workspaceId
        ? `workspace_id = '${this.vector.escapeSqlString(input.workspaceId)}'`
        : undefined,
      `generation_id = '${this.vector.escapeSqlString(input.generationId)}'`
    ])
    if (where) await table.delete(where)
  }

  public async addChunks(params: {
    vectors: Float32Array[]
    chunks: Array<ChunkInput & { generation_id?: string; chunk_index?: number }>
    generationId?: string
    batchSize?: number
    maxTextBytes?: number
  }): Promise<void> {
    const { vectors, chunks } = params
    const table = await this.vector.openTable(LANCE_TABLES.CHUNK)
    const batchSize = Math.max(1, params.batchSize || DEFAULT_CHUNK_BATCH_SIZE)
    const maxTextBytes = Math.max(1024, params.maxTextBytes || DEFAULT_CHUNK_BATCH_MAX_TEXT_BYTES)
    let batch: Record<string, unknown>[] = []
    let batchTextBytes = 0

    const flush = async (): Promise<void> => {
      if (batch.length === 0) return
      await table.add(batch)
      batch = []
      batchTextBytes = 0
    }

    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index]
      const textBytes = Buffer.byteLength(chunk.text || '', 'utf8')
      if (batch.length >= batchSize || (batch.length > 0 && batchTextBytes + textBytes > maxTextBytes)) {
        await flush()
      }
      batch.push({
        vector: Array.from(vectors[index]),
        text: chunk.text,
        id: chunk.id,
        document_id: chunk.document_id,
        workspace_id: chunk.workspace_id,
        generation_id: chunk.generation_id || params.generationId || '',
        chunk_index: chunk.chunk_index ?? index,
        document_name: chunk.document_name,
        source_type: chunk.source_type,
        metadata: chunk.metadata,
        created_at: Date.now()
      })
      batchTextBytes += textBytes
    }
    await flush()
  }

  public async vectorSearch(
    queryVector: Float32Array,
    limit = 50,
    sourceType?: string,
    workspaceId?: string,
    documentIds?: string[]
  ): Promise<SearchResult[]> {
    const table = await this.vector.openTable(LANCE_TABLES.CHUNK)
    const query = table.query()
    const where = await this.buildChunkWhere({ workspaceId, sourceType, documentIds })
    if (where) query.where(where)
    const results = await query.nearestTo(queryVector).distanceType('cosine').limit(limit).toArray()
    return results.map(toSearchResult)
  }

  public async ftsSearch(
    queryText: string,
    limit = 50,
    sourceType?: string,
    workspaceId?: string,
    documentIds?: string[]
  ): Promise<SearchResult[]> {
    const table = await this.vector.openTable(LANCE_TABLES.CHUNK)
    const q = table.query()
    const where = await this.buildChunkWhere({ workspaceId, sourceType, documentIds })
    if (where) q.where(where)
    const results = await q.fullTextSearch(queryText).limit(limit).toArray()
    return results.map(toSearchResult)
  }

  public async hybridSearch(
    queryVector: Float32Array,
    queryText: string,
    limit = 50,
    sourceType?: string,
    workspaceId?: string,
    documentIds?: string[]
  ): Promise<SearchResult[]> {
    const reranker = await this.getRRFReranker()
    const table = await this.vector.openTable(LANCE_TABLES.CHUNK)
    const q = table.query()
    const where = await this.buildChunkWhere({ workspaceId, sourceType, documentIds })
    if (where) q.where(where)
    const results = await q
      .fullTextSearch(queryText)
      .nearestTo(queryVector)
      .distanceType('cosine')
      .rerank(reranker)
      .limit(limit)
      .toArray()
    return results.map(toSearchResult)
  }

  public async search(
    queryVector: Float32Array,
    queryText: string,
    limit = 50,
    sourceType?: string,
    workspaceId?: string,
    documentIds?: string[]
  ): Promise<SearchResult[]> {
    const results = await this.hybridSearch(
      queryVector,
      queryText,
      limit,
      sourceType,
      workspaceId,
      documentIds
    )
    if (results.length === 0) return []
    const resultDocumentIds = Array.from(
      new Set(results.map((r) => r.document_id).filter(Boolean))
    ) as string[]
    if (resultDocumentIds.length === 0) return results
    const documents = await this.getDocumentsByIds(resultDocumentIds)
    const docMap = new Map(documents.map((document) => [document.id, document] as const))
    return results.map((item) => ({
      ...item,
      document: item.document_id ? docMap.get(item.document_id) : undefined
    }))
  }

  public async listDocuments(params: {
    sourceNameQuery?: string
    page: number
    pageSize: number
    workspaceId?: string
    documentIds?: string[]
  }): Promise<DocumentListResponse> {
    const { sourceNameQuery, page, pageSize, workspaceId, documentIds } = params
    const { where, params: sqlParams } = this.buildDocumentWhere({
      workspaceId,
      sourceNameQuery,
      documentIds
    })
    const totalRow = this.sqlite
      .prepare(`SELECT COUNT(*) AS count FROM document WHERE ${where}`)
      .get(sqlParams) as { count?: unknown }
    const skip = Math.max(0, (page - 1) * pageSize)
    const rows = this.sqlite
      .prepare(`SELECT * FROM document WHERE ${where} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`)
      .all({ ...sqlParams, limit: pageSize, offset: skip }) as DocumentRow[]
    const items = await this.attachWebSourceMetadata(rows.map(toDocumentRecord))
    return { items, total: toRequiredNumber(totalRow.count) }
  }

  public async listDocumentsBySourceType(
    sourceType: DocumentRecord['source_type'],
    workspaceId?: string
  ): Promise<DocumentRecord[]> {
    const { where, params } = this.buildDocumentWhere({ sourceType, workspaceId })
    const rows = this.sqlite
      .prepare(`SELECT * FROM document WHERE ${where} ORDER BY created_at DESC`)
      .all(params) as DocumentRow[]
    return await this.attachWebSourceMetadata(rows.map(toDocumentRecord))
  }

  public async listLegacyLocalDocuments(_boundDocumentIds: string[]): Promise<DocumentRecord[]> {
    void _boundDocumentIds
    return []
  }

  private async getDocumentsByIds(ids: string[]): Promise<DocumentRecord[]> {
    const params: Record<string, string | number | null> = {}
    const where = buildWhere([buildInClause('id', ids, params, 'document_id')])
    const rows = this.sqlite.prepare(`SELECT * FROM document WHERE ${where}`).all(params) as DocumentRow[]
    return await this.attachWebSourceMetadata(rows.map(toDocumentRecord))
  }

  private async attachWebSourceMetadata(documents: DocumentRecord[]): Promise<DocumentRecord[]> {
    const webDocumentIds = documents
      .filter((document) => document.source_type === 'web')
      .map((document) => document.id)
    if (webDocumentIds.length === 0) return documents
    const params: Record<string, string | number | null> = {}
    const where = buildWhere([buildInClause('document_id', webDocumentIds, params, 'document_id')])
    const rows = this.sqlite.prepare(`SELECT * FROM web_source WHERE ${where}`).all(params) as WebSourceRecord[]
    const webSourceMap = new Map(
      rows.map((row) => {
        const source = row as WebSourceRecord
        return [source.document_id || '', source] as const
      })
    )
    return documents.map((document) => {
      if (document.source_type !== 'web') return document
      const source = webSourceMap.get(document.id)
      if (!source) return document
      return {
        ...document,
        source_id: source.id,
        source_url: source.url,
        source_title: source.title,
        normalized_source_url: source.normalized_url,
        fetched_at: source.fetched_at,
        updated_at: source.updated_at,
        last_error: source.last_error
      }
    })
  }

  public async listChunks(params: {
    query?: string
    page: number
    pageSize: number
    workspaceId?: string
    documentIds?: string[]
  }): Promise<ChunkListResponse> {
    const { query, page, pageSize, workspaceId, documentIds } = params
    const table = await this.vector.openTable(LANCE_TABLES.CHUNK)
    const where = this.vector.combineWhere([
      await this.buildChunkWhere({ workspaceId, documentIds }),
      this.vector.buildWhereFromQuery(query, ['text', 'document_name'])
    ])
    const total = await table.countRows(where)
    const skip = Math.max(0, (page - 1) * pageSize)
    const queryBuilder = table.query()
    if (where && where.trim().length > 0) queryBuilder.where(where)
    const rows = await queryBuilder.limit(pageSize).offset(skip).toArray()
    const items = rows.map((item) => {
      const row = asRecord(item) as ChunkRow
      return {
        id: toString(row.id),
        text: toString(row.text),
        document_name: toString(row.document_name),
        document_id: toOptionalString(row.document_id),
        source_type: normalizeSourceType(row.source_type),
        metadata: normalizeChunkMetadata(row.metadata),
        created_at: toNumber(row.created_at),
        vector: toNumberArray(row.vector)
      }
    })
    return { items, total }
  }

  public async countChunksByDocumentIds(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0
    const table = await this.vector.openTable(LANCE_TABLES.CHUNK)
    const where = this.vector.buildInClause('document_id', ids)
    if (!where) return 0
    return await table.countRows(where)
  }

  public async deleteDocumentsByIds(ids: string[]): Promise<{
    success: boolean
    msg?: string
    error?: string
    deletedDocs?: number
    deletedChunks?: number
  }> {
    if (!ids || ids.length === 0) {
      return { success: false, msg: 'No document IDs provided' }
    }
    try {
      const deletedChunks = await this.countChunksByDocumentIds(ids)
      await this.deleteChunksByDocumentIds(ids)
      let deletedDocs = 0
      this.sqlite.transaction(() => {
        const stmt = this.sqlite.prepare('DELETE FROM document WHERE id = ?')
        for (const id of ids) deletedDocs += stmt.run(id).changes
      })
      return {
        success: true,
        msg: 'Documents deleted successfully',
        deletedDocs,
        deletedChunks
      }
    } catch (error: unknown) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }
}
