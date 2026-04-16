import * as lancedb from '@lancedb/lancedb'
import type {
  ChunkInput,
  ChunkListResponse,
  DocumentListResponse,
  DocumentRecord,
  SearchResult,
  WebSourceRecord
} from '../../../types/store'
import { LanceDbCore, LANCE_TABLES } from '../core/LanceDbCore'
import { asRecord, toNumber, toNumberArray, toOptionalNumber, toOptionalString, toString } from '../../../utils/decoder'

type ChunkRow = Record<string, unknown> & {
  id?: unknown
  text?: unknown
  document_name?: unknown
  document_id?: unknown
  workspace_id?: unknown
  source_type?: unknown
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
  import_status?: unknown
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
    import_status: importStatus
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

type WebSourceRow = Record<string, unknown> & {
  id?: unknown
  workspace_id?: unknown
  normalized_url?: unknown
  url?: unknown
  title?: unknown
  document_id?: unknown
  import_status?: unknown
  fetched_at?: unknown
  last_error?: unknown
  created_at?: unknown
  updated_at?: unknown
}

const toWebSourceRecord = (value: unknown): WebSourceRecord => {
  const row = asRecord(value) as WebSourceRow
  const status = toNumber(row.import_status, 2)
  const importStatus = (status === 1 ? 1 : status === 3 ? 3 : 2) as 1 | 2 | 3
  return {
    id: toString(row.id),
    workspace_id: toString(row.workspace_id),
    identity_kind: 'normalized_url',
    normalized_url: toString(row.normalized_url),
    url: toString(row.url),
    title: toOptionalString(row.title),
    document_id: toOptionalString(row.document_id),
    import_status: importStatus,
    fetched_at: toOptionalNumber(row.fetched_at),
    last_error: toOptionalString(row.last_error),
    created_at: toNumber(row.created_at, 0),
    updated_at: toNumber(row.updated_at, 0)
  }
}

export class DocumentsStore {
  private reranker: lancedb.rerankers.RRFReranker | null = null

  public constructor(private readonly core: LanceDbCore) {}

  private async getRRFReranker(): Promise<lancedb.rerankers.RRFReranker> {
    if (this.reranker) return this.reranker
    this.reranker = await lancedb.rerankers.RRFReranker.create()
    return this.reranker
  }

  private buildChunkWhere(input: {
    workspaceId?: string
    sourceType?: string
    documentIds?: string[]
  }): string | undefined {
    return this.core.combineWhere([
      input.workspaceId
        ? `workspace_id = '${this.core.escapeSqlString(input.workspaceId)}'`
        : undefined,
      input.sourceType ? `source_type = '${this.core.escapeSqlString(input.sourceType)}'` : undefined,
      this.core.buildInClause('document_id', input.documentIds)
    ])
  }

  private buildDocumentWhere(input: {
    workspaceId?: string
    query?: string
    sourceType?: DocumentRecord['source_type']
    documentIds?: string[]
  }): string | undefined {
    const query = String(input.query || '').trim()
    return this.core.combineWhere([
      input.workspaceId
        ? `workspace_id = '${this.core.escapeSqlString(input.workspaceId)}'`
        : undefined,
      input.sourceType
        ? `source_type = '${this.core.escapeSqlString(input.sourceType)}'`
        : undefined,
      query ? `name LIKE '%${this.core.escapeSqlString(query)}%'` : undefined,
      this.core.buildInClause('id', input.documentIds)
    ])
  }

  public async addDocument(doc: DocumentRecord): Promise<void> {
    const table = await this.core.openTable(LANCE_TABLES.DOCUMENT)
    await table.add([
      {
        id: doc.id,
        name: doc.name,
        source_type: doc.source_type,
        workspace_id: doc.workspace_id,
        file_path: doc.file_path,
        created_at: doc.created_at,
        import_status: doc.import_status
      }
    ])
  }

  public async updateDocumentImportStatus(id: string, status: number): Promise<void> {
    const table = await this.core.openTable(LANCE_TABLES.DOCUMENT)
    await table.update({
      where: `id = '${this.core.escapeSqlString(id)}'`,
      values: { import_status: status }
    })
  }

  public async updateDocumentById(
    id: string,
    values: Partial<Pick<DocumentRecord, 'name' | 'file_path' | 'source_type' | 'workspace_id'>>
  ): Promise<void> {
    const table = await this.core.openTable(LANCE_TABLES.DOCUMENT)
    await table.update({ where: `id = '${this.core.escapeSqlString(id)}'`, values })
  }

  public async getDocumentById(id: string): Promise<DocumentRecord | null> {
    const table = await this.core.openTable(LANCE_TABLES.DOCUMENT)
    const rows = await table
      .query()
      .where(`id = '${this.core.escapeSqlString(id)}'`)
      .limit(1)
      .toArray()
    const row = rows[0]
    if (!row) return null
    const [document] = await this.attachWebSourceMetadata([toDocumentRecord(row)])
    return document || null
  }

  public async getDocumentByFilePath(filePath: string): Promise<DocumentRecord | null> {
    const normalized = String(filePath || '').trim()
    if (!normalized) return null
    const table = await this.core.openTable(LANCE_TABLES.DOCUMENT)
    const rows = await table
      .query()
      .where(`file_path = '${this.core.escapeSqlString(normalized)}'`)
      .limit(1)
      .toArray()
    const row = rows[0]
    if (!row) return null
    const [document] = await this.attachWebSourceMetadata([toDocumentRecord(row)])
    return document || null
  }

  public async deleteChunksByDocumentIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    const table = await this.core.openTable(LANCE_TABLES.CHUNK)
    const where = this.core.buildInClause('document_id', ids)
    if (!where) return
    await table.delete(where)
  }

  public async addChunks(params: { vectors: Float32Array[]; chunks: ChunkInput[] }): Promise<void> {
    const { vectors, chunks } = params
    const data = vectors.map((vector, i) => ({
      vector: Array.from(vector),
      text: chunks[i].text,
      id: chunks[i].id,
      document_id: chunks[i].document_id,
      workspace_id: chunks[i].workspace_id,
      document_name: chunks[i].document_name,
      source_type: chunks[i].source_type,
      metadata: chunks[i].metadata,
      created_at: Date.now()
    }))

    const table = await this.core.openTable(LANCE_TABLES.CHUNK)
    await table.add(data)
  }

  public async vectorSearch(
    queryVector: Float32Array,
    limit = 50,
    sourceType?: string,
    workspaceId?: string,
    documentIds?: string[]
  ): Promise<SearchResult[]> {
    const table = await this.core.openTable(LANCE_TABLES.CHUNK)
    const query = table.query()
    const where = this.buildChunkWhere({ workspaceId, sourceType, documentIds })
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
    const table = await this.core.openTable(LANCE_TABLES.CHUNK)
    const q = table.query()
    const where = this.buildChunkWhere({ workspaceId, sourceType, documentIds })
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
    const table = await this.core.openTable(LANCE_TABLES.CHUNK)
    const q = table.query()
    const where = this.buildChunkWhere({ workspaceId, sourceType, documentIds })
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

    const docTable = await this.core.openTable(LANCE_TABLES.DOCUMENT)
    const whereClause = this.core.buildInClause('id', resultDocumentIds)
    if (!whereClause) return results
    const documents = await docTable.query().where(whereClause).toArray()
    const docMap = new Map(
      documents.map((row) => {
        const doc = toDocumentRecord(row)
        return [doc.id, doc] as const
      })
    )

    const hydratedDocuments = await this.attachWebSourceMetadata(Array.from(docMap.values()))
    const hydratedMap = new Map(hydratedDocuments.map((document) => [document.id, document] as const))

    return results.map((item) => ({
      ...item,
      document: item.document_id ? hydratedMap.get(item.document_id) : undefined
    }))
  }

  public async listDocuments(params: {
    query?: string
    page: number
    pageSize: number
    workspaceId?: string
    documentIds?: string[]
  }): Promise<DocumentListResponse> {
    const { query, page, pageSize, workspaceId, documentIds } = params
    const table = await this.core.openTable(LANCE_TABLES.DOCUMENT)

    const where = this.buildDocumentWhere({ workspaceId, query, documentIds })

    const total = await table.countRows(where)
    const skip = Math.max(0, (page - 1) * pageSize)

    const queryBuilder = table.query()
    if (where) queryBuilder.where(where)
    const rows = await queryBuilder.limit(pageSize).offset(skip).toArray()

    const items = await this.attachWebSourceMetadata(rows.map(toDocumentRecord))

    return { items, total }
  }

  public async listDocumentsBySourceType(
    sourceType: DocumentRecord['source_type'],
    workspaceId?: string
  ): Promise<DocumentRecord[]> {
    const table = await this.core.openTable(LANCE_TABLES.DOCUMENT)
    const where = this.buildDocumentWhere({ sourceType, workspaceId })
    const rows = await table
      .query()
      .where(where || `source_type = '${this.core.escapeSqlString(sourceType)}'`)
      .toArray()
    return await this.attachWebSourceMetadata(rows.map(toDocumentRecord))
  }

  public async listLegacyLocalDocuments(boundDocumentIds: string[]): Promise<DocumentRecord[]> {
    const fileDocuments = await this.listDocumentsBySourceType('file')
    const boundIds = new Set(boundDocumentIds.map((id) => String(id).trim()).filter(Boolean))
    return fileDocuments.filter((document) => !boundIds.has(document.id))
  }

  private async attachWebSourceMetadata(documents: DocumentRecord[]): Promise<DocumentRecord[]> {
    const webDocumentIds = documents
      .filter((document) => document.source_type === 'web')
      .map((document) => document.id)
    if (webDocumentIds.length === 0) return documents

    const table = await this.core.openTable(LANCE_TABLES.WEB_SOURCE)
    const where = this.core.buildInClause('document_id', webDocumentIds)
    if (!where) return documents
    const rows = await table.query().where(where).toArray()
    const webSourceMap = new Map(
      rows.map((row) => {
        const source = toWebSourceRecord(row)
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
    keyword?: string
    page: number
    pageSize: number
    workspaceId?: string
    documentIds?: string[]
  }): Promise<ChunkListResponse> {
    const { keyword, page, pageSize, workspaceId, documentIds } = params
    const table = await this.core.openTable(LANCE_TABLES.CHUNK)

    const where = this.core.combineWhere([
      this.buildChunkWhere({ workspaceId, documentIds }),
      this.core.buildWhereFromKeyword(keyword, ['text', 'document_name'])
    ])
    const total = await table.countRows(where)
    const skip = Math.max(0, (page - 1) * pageSize)

    const query = table.query()
    if (where && where.trim().length > 0) query.where(where)
    const rows = await query.limit(pageSize).offset(skip).toArray()

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

  public async dropDocumentsStorage(): Promise<{ existed: boolean }> {
    const db = this.core.getConnection()
    const tableNames = await db.tableNames()
    const existedChunk = tableNames.includes(LANCE_TABLES.CHUNK)
    const existedDoc = tableNames.includes(LANCE_TABLES.DOCUMENT)
    if (existedChunk) await db.dropTable(LANCE_TABLES.CHUNK)
    if (existedDoc) await db.dropTable(LANCE_TABLES.DOCUMENT)
    return { existed: existedChunk || existedDoc }
  }

  public async countChunksByDocumentIds(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0
    const table = await this.core.openTable(LANCE_TABLES.CHUNK)
    const where = this.core.buildInClause('document_id', ids)
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
      const chunkTable = await this.core.openTable(LANCE_TABLES.CHUNK)
      const docTable = await this.core.openTable(LANCE_TABLES.DOCUMENT)
      let deletedChunks = 0
      let deletedDocs = 0
      for (const id of ids) {
        const safeId = this.core.escapeSqlString(id)
        deletedChunks += await chunkTable.countRows(`document_id = "${safeId}"`)
        deletedDocs += await docTable.countRows(`id = "${safeId}"`)
        await chunkTable.delete(`document_id = "${safeId}"`)
        await docTable.delete(`id = "${safeId}"`)
      }
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
