import * as lancedb from '@lancedb/lancedb'
import type {
  ChunkInput,
  ChunkListResponse,
  DocumentListResponse,
  DocumentRecord,
  SearchResult,
  WebSourceRecord
} from '../../../types/store'
import {
  asRecord,
  toNumber,
  toNumberArray,
  toOptionalNumber,
  toOptionalString,
  toString
} from '../../../utils/decoder'
import {
  DEFAULT_EMBEDDING_DIMENSION,
  DEFAULT_EMBEDDING_IDENTITY,
  LanceDbCore
} from '../core/LanceDbCore'
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

type EmbeddingDocument = {
  id: string
  active_generation_id: string | null
  content_hash: string | null
  embedding_identity: string
  embedding_dim: number
  embedding_error: string | null
  import_status: number
}

type DocumentIndexingSnapshot = EmbeddingDocument & {
  name: string
  file_path: string | null
  source_type: string
  workspace_id: string | null
  created_at: number
  updated_at: number | null
  last_error: string | null
}

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
    embedding_identity: toOptionalString(row.embedding_identity) ?? DEFAULT_EMBEDDING_IDENTITY,
    embedding_dim: toNumber(row.embedding_dim, DEFAULT_EMBEDDING_DIMENSION),
    embedding_error: toOptionalString(row.embedding_error),
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
  private generationMaintenance: Promise<void> = Promise.resolve()
  private readonly searchResultVersions = new WeakMap<
    SearchResult,
    { tableName: string; generationId: string }
  >()

  public constructor(
    private readonly sqlite: SqliteCore,
    private readonly vector: LanceDbCore
  ) {}

  /**
   * generation 替换和陈旧块清理共享串行闸，避免清理快照形成后启动的写入被当作陈旧数据删除。
   * 闸覆盖目标写入、同步 CAS 和收尾清理；普通索引的其他 generation 不受替换收尾影响。
   *
   * Serialize generation replacement with stale-chunk purging so writes started after a purge
   * snapshot cannot be deleted as stale data. Hold the gate through target writes, synchronous
   * CAS and cleanup; replacement cleanup leaves other ordinary indexing generations untouched.
   */
  private serializeGenerationMaintenance<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.generationMaintenance.then(operation)
    this.generationMaintenance = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  /**
   * 普通索引的完整写入、激活及失败清理与全库清理互斥，防止批次间的新 generation 被提前回收。
   * 回调内部只调用普通块写入和版本操作，不嵌套迁移或全库清理，以免重复获取同一串行闸。
   *
   * Keep ordinary indexing writes, activation and failure cleanup mutually exclusive with global
   * purging so new generations survive between batches. The callback uses ordinary chunk and
   * generation operations only; nesting migration or global purge would reacquire the same gate.
   */
  public runGenerationWrite<T>(operation: () => Promise<T>): Promise<T> {
    return this.serializeGenerationMaintenance(operation)
  }

  private searchResultFromRow(row: ChunkRow, tableName: string): SearchResult {
    const result = toSearchResult(row)
    this.searchResultVersions.set(result, { tableName, generationId: toString(row.generation_id) })
    return result
  }

  /**
   * 异步查询返回后重新读取 SQLite，排除查询期间被删除、切换 generation 或切换模型的结果。
   *
   * Re-read SQLite after asynchronous queries to exclude documents deleted or switched to another
   * generation or embedding model while the query was running.
   */
  private filterCurrentSearchResults(results: SearchResult[]): SearchResult[] {
    const documents = new Map<string, EmbeddingDocument | undefined>()
    return results.filter((result) => {
      if (!result.document_id) return false
      if (!documents.has(result.document_id)) {
        documents.set(
          result.document_id,
          this.sqlite
            .prepare<[string], EmbeddingDocument>('SELECT * FROM document WHERE id = ?')
            .get(result.document_id)
        )
      }
      const document = documents.get(result.document_id)
      const version = this.searchResultVersions.get(result)
      return (
        document &&
        document.embedding_dim > 0 &&
        version &&
        document.active_generation_id === version.generationId &&
        this.vector.getChunkTableName(document.embedding_identity, document.embedding_dim) ===
          version.tableName
      )
    })
  }

  private async buildChunkWhere(input: {
    workspaceId?: string
    sourceType?: string
    documentIds?: string[]
    tableName?: string
    embeddingIdentity?: string
    dimension?: number
  }): Promise<string | undefined> {
    let activeWhere: string | undefined
    if (input.tableName) {
      const params: Record<string, string | number | null> = {}
      const where = buildWhere([
        'active_generation_id IS NOT NULL',
        "active_generation_id != ''",
        buildInClause('id', input.documentIds, params, 'document_id'),
        input.workspaceId ? 'workspace_id = @workspace_id' : undefined,
        input.sourceType ? 'source_type = @source_type' : undefined,
        input.embeddingIdentity ? 'embedding_identity = @identity' : undefined,
        input.dimension ? 'embedding_dim = @dimension' : undefined
      ])
      if (input.workspaceId) params.workspace_id = input.workspaceId
      if (input.sourceType) params.source_type = input.sourceType
      if (input.embeddingIdentity) params.identity = input.embeddingIdentity
      if (input.dimension) params.dimension = input.dimension
      const documents = this.sqlite
        .prepare<Record<string, string | number | null>, EmbeddingDocument>(
          `SELECT id, active_generation_id, embedding_identity, embedding_dim FROM document WHERE ${where}`
        )
        .all(params)
        .filter(
          (document) =>
            document.embedding_dim > 0 &&
            this.vector.getChunkTableName(document.embedding_identity, document.embedding_dim) ===
              input.tableName
        )
      activeWhere = documents.length
        ? documents
            .map(
              (document) =>
                `(document_id = '${this.vector.escapeSqlString(document.id)}' AND generation_id = '${this.vector.escapeSqlString(document.active_generation_id!)}')`
            )
            .join(' OR ')
        : '1 = 0'
    }
    return this.vector.combineWhere([
      input.workspaceId
        ? `workspace_id = '${this.vector.escapeSqlString(input.workspaceId)}'`
        : undefined,
      input.sourceType
        ? `source_type = '${this.vector.escapeSqlString(input.sourceType)}'`
        : undefined,
      this.vector.buildInClause('document_id', input.documentIds),
      activeWhere
    ])
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
      embedding_identity: doc.embedding_identity,
      embedding_dim: doc.embedding_dim,
      embedding_error: doc.embedding_error,
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
    embeddingIdentity?: string
    dimension?: number
  }): Promise<void> {
    if ((input.dimension ?? DEFAULT_EMBEDDING_DIMENSION) > 0) {
      this.assertEmbeddingDimension(
        input.embeddingIdentity ?? DEFAULT_EMBEDDING_IDENTITY,
        input.dimension ?? DEFAULT_EMBEDDING_DIMENSION
      )
    }
    updateById(this.sqlite, 'document', input.documentId, {
      active_generation_id: input.generationId,
      content_hash: input.contentHash,
      import_status: input.importStatus ?? 2,
      updated_at: input.updatedAt ?? Date.now(),
      last_error: input.lastError ?? null,
      embedding_identity: input.embeddingIdentity ?? DEFAULT_EMBEDDING_IDENTITY,
      embedding_dim: input.dimension ?? DEFAULT_EMBEDDING_DIMENSION,
      embedding_error: null
    })
  }

  public async markDocumentIndexing(id: string, now = Date.now()): Promise<void> {
    updateById(this.sqlite, 'document', id, {
      import_status: 1,
      updated_at: now,
      last_error: null
    })
  }

  /**
   * 在 generation 写闸内同步保存原始 SQLite 元数据并开始索引，避免快照与写入之间交错。
   * 取消时在同一闸内调用 restore：只有本轮写后状态仍匹配才恢复提前修改的字段，
   * 本轮新建的占位记录则删除。CAS 失配返回 false，不复活删除记录或覆盖已激活版本；
   * SQL 失败直接抛出，空值保持原样，generation 和嵌入身份字段始终不回写。
   *
   * Capture raw SQLite metadata and start indexing synchronously inside the generation write gate.
   * Call restore in the same gate on cancellation: restore changed metadata only while the written
   * state still matches, or delete a placeholder created by this operation. A CAS mismatch returns
   * false without reviving deleted rows or overwriting activated versions. SQL failures propagate,
   * null values remain intact, and generation and embedding identity fields are never rewritten.
   */
  public beginDocumentIndexing(
    doc: Pick<
      DocumentRecord,
      'id' | 'name' | 'file_path' | 'source_type' | 'workspace_id' | 'content_hash' | 'created_at'
    >,
    now = Date.now()
  ): { previousGenerationId: string | undefined; restore: () => boolean } {
    return this.sqlite.transaction(() => {
      const previous = this.sqlite
        .prepare<[string], DocumentIndexingSnapshot>('SELECT * FROM document WHERE id = ?')
        .get(doc.id)
      const metadata = {
        name: doc.name,
        file_path: doc.file_path ?? null,
        source_type: doc.source_type,
        workspace_id: doc.workspace_id ?? null,
        content_hash: doc.content_hash ?? null,
        import_status: 1,
        updated_at: now,
        last_error: null
      }
      if (previous) {
        updateById(this.sqlite, 'document', doc.id, metadata)
      } else {
        insertOrReplace(this.sqlite, 'document', {
          id: doc.id,
          created_at: doc.created_at,
          ...metadata
        })
      }
      const expected = {
        id: doc.id,
        generation: previous?.active_generation_id ?? null,
        identity: previous?.embedding_identity ?? DEFAULT_EMBEDDING_IDENTITY,
        dimension: previous?.embedding_dim ?? DEFAULT_EMBEDDING_DIMENSION,
        created: previous?.created_at ?? doc.created_at,
        hash: metadata.content_hash,
        updated: now
      }
      const where = `id = @id AND active_generation_id IS @generation
        AND embedding_identity = @identity AND embedding_dim = @dimension
        AND created_at IS @created AND import_status = 1
        AND content_hash IS @hash AND updated_at IS @updated AND last_error IS NULL`
      return {
        previousGenerationId: previous?.active_generation_id ?? undefined,
        restore: () => {
          if (!previous) {
            return (
              this.sqlite.prepare(`DELETE FROM document WHERE ${where}`).run(expected).changes > 0
            )
          }
          return (
            this.sqlite
              .prepare(
                `UPDATE document SET name = @name, file_path = @file_path,
                 source_type = @source_type, workspace_id = @workspace_id,
                 content_hash = @content_hash, import_status = @import_status,
                 updated_at = @updated_at, last_error = @last_error WHERE ${where}`
              )
              .run({
                ...expected,
                name: previous.name,
                file_path: previous.file_path,
                source_type: previous.source_type,
                workspace_id: previous.workspace_id,
                content_hash: previous.content_hash,
                import_status: previous.import_status,
                updated_at: previous.updated_at,
                last_error: previous.last_error
              }).changes > 0
          )
        }
      }
    })
  }

  public async markDocumentIndexFailed(id: string, error: string, now = Date.now()): Promise<void> {
    updateById(this.sqlite, 'document', id, {
      import_status: 3,
      updated_at: now,
      last_error: error
    })
  }

  public getEmbeddingIndexState(identity: string): {
    staleFileCount: number
    staleWebCount: number
    completeIdentity?: string
  } {
    const rows = this.sqlite
      .prepare<[], { embedding_identity: string; source_type: string; count: number }>(
        `SELECT embedding_identity, source_type, COUNT(*) AS count FROM document
       WHERE active_generation_id IS NOT NULL AND active_generation_id != ''
       GROUP BY embedding_identity, source_type`
      )
      .all()
    const identities = new Set(rows.map((row) => row.embedding_identity))
    return {
      staleFileCount: rows
        .filter((row) => row.embedding_identity !== identity && row.source_type === 'file')
        .reduce((sum, row) => sum + row.count, 0),
      staleWebCount: rows
        .filter((row) => row.embedding_identity !== identity && row.source_type === 'web')
        .reduce((sum, row) => sum + row.count, 0),
      ...(identities.size === 1 ? { completeIdentity: rows[0].embedding_identity } : {})
    }
  }

  public getStaleEmbeddingDocumentIds(identity: string): Set<string> {
    return new Set(
      this.sqlite
        .prepare<[string], { id: string }>(
          `SELECT id FROM document WHERE active_generation_id IS NOT NULL AND active_generation_id != '' AND embedding_identity != ?`
        )
        .all(identity)
        .map((row) => row.id)
    )
  }

  /**
   * 已激活文档固定同一模型身份的向量维度；端点维度发生变化时必须配置新的模型身份。
   * 空文档的零维标记不约束模型的实际维度。
   *
   * Active documents pin the vector dimension of a model identity. An endpoint dimension change
   * requires a new model identity. Zero-dimensional empty-document markers do not pin dimensions.
   */
  public assertEmbeddingDimension(identity: string, dimension: number): void {
    if (!Number.isSafeInteger(dimension) || dimension <= 0) {
      throw new Error('Embedding dimension must be a positive integer')
    }
    const document = this.sqlite
      .prepare<[string, number], { embedding_dim: number }>(
        `SELECT embedding_dim FROM document WHERE embedding_identity = ? AND embedding_dim > 0
         AND embedding_dim != ? AND active_generation_id IS NOT NULL AND active_generation_id != '' LIMIT 1`
      )
      .get(identity, dimension)
    if (document) {
      throw new Error(
        `Embedding dimension changed from ${document.embedding_dim} to ${dimension}; configure a new embedding model identity`
      )
    }
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
    const row = this.sqlite
      .prepare('SELECT * FROM document WHERE file_path = ? LIMIT 1')
      .get(normalized) as DocumentRow | undefined
    if (!row) return null
    const [document] = await this.attachWebSourceMetadata([toDocumentRecord(row)])
    return document || null
  }

  public async deleteChunksByDocumentIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    const where = this.vector.buildInClause('document_id', ids)
    if (!where) return
    for (const name of await this.vector.listChunkTableNames()) {
      await (await this.vector.openTable(name)).delete(where)
    }
  }

  public async deleteChunksByGeneration(input: {
    documentId?: string
    workspaceId?: string
    generationId: string
  }): Promise<void> {
    const where = this.vector.combineWhere([
      input.documentId
        ? `document_id = '${this.vector.escapeSqlString(input.documentId)}'`
        : undefined,
      input.workspaceId
        ? `workspace_id = '${this.vector.escapeSqlString(input.workspaceId)}'`
        : undefined,
      `generation_id = '${this.vector.escapeSqlString(input.generationId)}'`
    ])
    if (where) {
      for (const name of await this.vector.listChunkTableNames()) {
        await (await this.vector.openTable(name)).delete(where)
      }
    }
  }

  public async purgeStaleChunks(): Promise<void> {
    return this.serializeGenerationMaintenance(async () => {
      const documents = this.sqlite
        .prepare('SELECT id, active_generation_id FROM document')
        .all() as Array<{ id?: unknown; active_generation_id?: unknown }>
      for (const name of await this.vector.listChunkTableNames()) {
        const table = await this.vector.openTable(name)
        if (documents.length === 0) {
          if ((await table.countRows()) > 0) {
            await table.delete('id IS NOT NULL')
          }
          continue
        }

        const documentIds = documents
          .map((row) => toOptionalString(row.id))
          .filter((id): id is string => Boolean(id))
        const orphanDocumentClause = this.vector.buildNotInClause('document_id', documentIds)
        if (orphanDocumentClause) await table.delete(orphanDocumentClause)

        for (const row of documents) {
          const documentId = toOptionalString(row.id)
          if (!documentId) continue
          const activeGenerationId = toOptionalString(row.active_generation_id)
          if (!activeGenerationId) {
            await table.delete(`document_id = '${this.vector.escapeSqlString(documentId)}'`)
            continue
          }
          await table.delete(
            `document_id = '${this.vector.escapeSqlString(documentId)}' AND generation_id != '${this.vector.escapeSqlString(activeGenerationId)}'`
          )
        }
      }
    })
  }

  public async addChunks(params: {
    vectors: Float32Array[]
    chunks: Array<ChunkInput & { generation_id?: string; chunk_index?: number }>
    generationId?: string
    batchSize?: number
    maxTextBytes?: number
    embeddingIdentity?: string
  }): Promise<void> {
    const { vectors, chunks } = params
    if (vectors.length !== chunks.length) throw new Error('Embedding count must match chunk count')
    if (!chunks.length) return
    const dimension = vectors[0].length
    if (
      !dimension ||
      vectors.some((vector) => vector.length !== dimension || !vector.every(Number.isFinite))
    ) {
      throw new Error('Embeddings must have the same positive dimension and finite values')
    }
    this.assertEmbeddingDimension(params.embeddingIdentity ?? DEFAULT_EMBEDDING_IDENTITY, dimension)
    const table = (await this.vector.openChunkTable(
      params.embeddingIdentity ?? DEFAULT_EMBEDDING_IDENTITY,
      dimension,
      true
    ))!
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
      if (
        batch.length >= batchSize ||
        (batch.length > 0 && batchTextBytes + textBytes > maxTextBytes)
      ) {
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
    documentIds?: string[],
    embeddingIdentity = DEFAULT_EMBEDDING_IDENTITY
  ): Promise<SearchResult[]> {
    if (limit <= 0) return []
    const dimension = queryVector.length
    this.assertEmbeddingDimension(embeddingIdentity, dimension)
    const table = await this.vector.openChunkTable(embeddingIdentity, dimension)
    if (!table) return []
    const tableName = this.vector.getChunkTableName(embeddingIdentity, dimension)
    const query = table.query()
    const where = await this.buildChunkWhere({
      workspaceId,
      sourceType,
      documentIds,
      tableName,
      embeddingIdentity,
      dimension
    })
    if ((await table.countRows(where)) === 0) return []
    if (where) query.where(where)
    const results = await query.nearestTo(queryVector).distanceType('cosine').limit(limit).toArray()
    return this.filterCurrentSearchResults(
      results.map((row) => this.searchResultFromRow(row, tableName))
    )
  }

  public async ftsSearch(
    queryText: string,
    limit = 50,
    sourceType?: string,
    workspaceId?: string,
    documentIds?: string[],
    embeddingIdentity = DEFAULT_EMBEDDING_IDENTITY
  ): Promise<SearchResult[]> {
    if (limit <= 0 || !queryText.trim()) return []
    const document = this.sqlite
      .prepare<
        [string],
        { embedding_dim: number }
      >(`SELECT embedding_dim FROM document WHERE embedding_identity = ? AND embedding_dim > 0 AND active_generation_id IS NOT NULL LIMIT 1`)
      .get(embeddingIdentity)
    if (!document) return []
    const table = await this.vector.openChunkTable(embeddingIdentity, document.embedding_dim)
    if (!table)
      throw new Error(
        'The embedding index table is missing. Rebuild indexes in Settings > Workspace.'
      )
    const tableName = this.vector.getChunkTableName(embeddingIdentity, document.embedding_dim)
    const where = await this.buildChunkWhere({
      workspaceId,
      sourceType,
      documentIds,
      tableName,
      embeddingIdentity
    })
    if ((await table.countRows(where)) === 0) return []
    const query = table.query()
    if (where) query.where(where)
    const rows = await query.fullTextSearch(queryText).limit(limit).toArray()
    return this.filterCurrentSearchResults(
      rows.map((row) => this.searchResultFromRow(row, tableName))
    )
  }

  public async hybridSearch(
    queryVector: Float32Array,
    queryText: string,
    limit = 50,
    sourceType?: string,
    workspaceId?: string,
    documentIds?: string[],
    embeddingIdentity = DEFAULT_EMBEDDING_IDENTITY
  ): Promise<SearchResult[]> {
    if (limit <= 0) return []
    this.assertEmbeddingDimension(embeddingIdentity, queryVector.length)
    const table = await this.vector.openChunkTable(embeddingIdentity, queryVector.length)
    if (!table) return []
    const tableName = this.vector.getChunkTableName(embeddingIdentity, queryVector.length)
    const where = await this.buildChunkWhere({
      workspaceId,
      sourceType,
      documentIds,
      tableName,
      embeddingIdentity,
      dimension: queryVector.length
    })
    if ((await table.countRows(where)) === 0) return []
    const query = table.query()
    if (where) query.where(where)
    this.reranker ??= await lancedb.rerankers.RRFReranker.create()
    const rows = await query
      .fullTextSearch(queryText)
      .nearestTo(queryVector)
      .distanceType('cosine')
      .rerank(this.reranker)
      .limit(limit)
      .toArray()
    return this.filterCurrentSearchResults(
      rows.map((row) => this.searchResultFromRow(row, tableName))
    )
  }

  public async search(
    queryVector: Float32Array,
    queryText: string,
    limit = 50,
    sourceType?: string,
    workspaceId?: string,
    documentIds?: string[],
    embeddingIdentity = DEFAULT_EMBEDDING_IDENTITY
  ): Promise<SearchResult[]> {
    const results = await this.hybridSearch(
      queryVector,
      queryText,
      limit,
      sourceType,
      workspaceId,
      documentIds,
      embeddingIdentity
    )
    if (results.length === 0) return []
    const resultDocumentIds = Array.from(
      new Set(results.map((r) => r.document_id).filter(Boolean))
    ) as string[]
    if (resultDocumentIds.length === 0) return results
    const documents = await this.getDocumentsByIds(resultDocumentIds)
    const docMap = new Map(documents.map((document) => [document.id, document] as const))
    return this.filterCurrentSearchResults(results).map((item) => ({
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
      .prepare(
        `SELECT * FROM document WHERE ${where} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`
      )
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
    const rows = this.sqlite
      .prepare(`SELECT * FROM document WHERE ${where}`)
      .all(params) as DocumentRow[]
    return await this.attachWebSourceMetadata(rows.map(toDocumentRecord))
  }

  private async attachWebSourceMetadata(documents: DocumentRecord[]): Promise<DocumentRecord[]> {
    const webDocumentIds = documents
      .filter((document) => document.source_type === 'web')
      .map((document) => document.id)
    if (webDocumentIds.length === 0) return documents
    const params: Record<string, string | number | null> = {}
    const where = buildWhere([buildInClause('document_id', webDocumentIds, params, 'document_id')])
    const rows = this.sqlite
      .prepare(`SELECT * FROM web_source WHERE ${where}`)
      .all(params) as WebSourceRecord[]
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
    let total = 0
    let skip = Math.max(0, (page - 1) * pageSize)
    const rows: ChunkRow[] = []
    for (const tableName of await this.vector.listChunkTableNames()) {
      const table = await this.vector.openTable(tableName)
      const where = this.vector.combineWhere([
        await this.buildChunkWhere({ workspaceId, documentIds, tableName }),
        this.vector.buildWhereFromQuery(query, ['text', 'document_name'])
      ])
      const count = await table.countRows(where)
      total += count
      if (skip >= count) {
        skip -= count
        continue
      }
      if (rows.length >= pageSize) continue
      const queryBuilder = table.query()
      if (where) queryBuilder.where(where)
      rows.push(
        ...(await queryBuilder
          .limit(pageSize - rows.length)
          .offset(skip)
          .toArray())
      )
      skip = 0
    }
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
    let total = 0
    for (const name of await this.vector.listChunkTableNames()) {
      const where = await this.buildChunkWhere({ documentIds: ids, tableName: name })
      total += await (await this.vector.openTable(name)).countRows(where)
    }
    return total
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
