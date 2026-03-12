import type {
  WorkspaceNode,
  WorkspaceNodeKind,
  WorkspacePrepareStatus,
  WorkspaceSource,
  WorkspaceSourceStatus
} from '../../../types/store'
import { LanceDbCore, LANCE_TABLES } from '../core/LanceDbCore'

type PrimitiveRowValue = string | number | boolean | null | undefined

type WorkspaceWriteRow = Record<string, PrimitiveRowValue>

type WorkspaceSourceRow = {
  id?: PrimitiveRowValue
  name?: PrimitiveRowValue
  root_path?: PrimitiveRowValue
  status?: PrimitiveRowValue
  last_scan_at?: PrimitiveRowValue
  last_prepare_at?: PrimitiveRowValue
  last_error?: PrimitiveRowValue
  created_at?: PrimitiveRowValue
  updated_at?: PrimitiveRowValue
}

type WorkspaceNodeRow = {
  id?: PrimitiveRowValue
  workspace_id?: PrimitiveRowValue
  parent_id?: PrimitiveRowValue
  kind?: PrimitiveRowValue
  name?: PrimitiveRowValue
  relative_path?: PrimitiveRowValue
  absolute_path?: PrimitiveRowValue
  file_ext?: PrimitiveRowValue
  exists?: PrimitiveRowValue
  size?: PrimitiveRowValue
  mtime_ms?: PrimitiveRowValue
  content_hash?: PrimitiveRowValue
  prepare_status?: PrimitiveRowValue
  document_id?: PrimitiveRowValue
  last_prepared_at?: PrimitiveRowValue
  last_error?: PrimitiveRowValue
  created_at?: PrimitiveRowValue
  updated_at?: PrimitiveRowValue
}

const toOptionalString = (value: PrimitiveRowValue): string | undefined => {
  if (value == null) return undefined
  const next = String(value).trim()
  return next.length > 0 ? next : undefined
}

const toRequiredString = (value: PrimitiveRowValue): string => String(value ?? '')

const toOptionalNumber = (value: PrimitiveRowValue): number | undefined => {
  if (value == null) return undefined
  const next = Number(value)
  return Number.isFinite(next) ? next : undefined
}

const toRequiredNumber = (value: PrimitiveRowValue, fallback = 0): number => {
  const next = Number(value)
  return Number.isFinite(next) ? next : fallback
}

const toBoolean = (value: PrimitiveRowValue, fallback = false): boolean => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1') return true
    if (normalized === 'false' || normalized === '0') return false
  }
  return fallback
}

const normalizeWorkspaceStatus = (value: PrimitiveRowValue): WorkspaceSourceStatus => {
  const normalized = String(value ?? '').trim()
  switch (normalized) {
    case 'scanning':
    case 'preparing':
    case 'prepared':
    case 'stale':
    case 'failed':
    case 'unavailable':
      return normalized
    default:
      return 'not_prepared'
  }
}

const normalizeNodeKind = (value: PrimitiveRowValue): WorkspaceNodeKind =>
  String(value ?? '').trim() === 'directory' ? 'directory' : 'file'

const normalizePrepareStatus = (value: PrimitiveRowValue): WorkspacePrepareStatus => {
  const normalized = String(value ?? '').trim()
  switch (normalized) {
    case 'preparing':
    case 'prepared':
    case 'stale':
    case 'failed':
    case 'missing':
      return normalized
    default:
      return 'not_prepared'
  }
}

const toWorkspaceSource = (row: WorkspaceSourceRow): WorkspaceSource => ({
  id: toRequiredString(row.id),
  name: toRequiredString(row.name),
  root_path: toRequiredString(row.root_path),
  status: normalizeWorkspaceStatus(row.status),
  last_scan_at: toOptionalNumber(row.last_scan_at),
  last_prepare_at: toOptionalNumber(row.last_prepare_at),
  last_error: toOptionalString(row.last_error),
  created_at: toRequiredNumber(row.created_at),
  updated_at: toRequiredNumber(row.updated_at)
})

const toWorkspaceNode = (row: WorkspaceNodeRow): WorkspaceNode => ({
  id: toRequiredString(row.id),
  workspace_id: toRequiredString(row.workspace_id),
  parent_id: toOptionalString(row.parent_id),
  kind: normalizeNodeKind(row.kind),
  name: toRequiredString(row.name),
  relative_path: toRequiredString(row.relative_path),
  absolute_path: toRequiredString(row.absolute_path),
  file_ext: toOptionalString(row.file_ext),
  exists: toBoolean(row.exists, true),
  size: toOptionalNumber(row.size),
  mtime_ms: toOptionalNumber(row.mtime_ms),
  content_hash: toOptionalString(row.content_hash),
  prepare_status: normalizePrepareStatus(row.prepare_status),
  document_id: toOptionalString(row.document_id),
  last_prepared_at: toOptionalNumber(row.last_prepared_at),
  last_error: toOptionalString(row.last_error),
  created_at: toRequiredNumber(row.created_at),
  updated_at: toRequiredNumber(row.updated_at)
})

const omitUndefined = <T extends Record<string, string | number | boolean | null | undefined>>(
  value: T
): Partial<T> => {
  const next: Partial<T> = {}
  for (const key of Object.keys(value) as Array<keyof T>) {
    if (value[key] !== undefined) {
      next[key] = value[key]
    }
  }
  return next
}

const toWorkspaceSourceWriteRow = (workspace: WorkspaceSource): WorkspaceWriteRow => ({
  id: workspace.id,
  name: workspace.name,
  root_path: workspace.root_path,
  status: workspace.status,
  last_scan_at: workspace.last_scan_at,
  last_prepare_at: workspace.last_prepare_at,
  last_error: workspace.last_error,
  created_at: workspace.created_at,
  updated_at: workspace.updated_at
})

const toWorkspaceNodeWriteRow = (node: WorkspaceNode): WorkspaceWriteRow => ({
  id: node.id,
  workspace_id: node.workspace_id,
  parent_id: node.parent_id,
  kind: node.kind,
  name: node.name,
  relative_path: node.relative_path,
  absolute_path: node.absolute_path,
  file_ext: node.file_ext,
  exists: node.exists,
  size: node.size,
  mtime_ms: node.mtime_ms,
  content_hash: node.content_hash,
  prepare_status: node.prepare_status,
  document_id: node.document_id,
  last_prepared_at: node.last_prepared_at,
  last_error: node.last_error,
  created_at: node.created_at,
  updated_at: node.updated_at
})

export class WorkspaceStore {
  public constructor(private readonly core: LanceDbCore) {}

  public async saveWorkspace(workspace: WorkspaceSource): Promise<void> {
    const table = await this.core.openTable(LANCE_TABLES.WORKSPACE_SOURCE)
    await table.delete(`id = '${this.core.escapeSqlString(workspace.id)}'`)
    await table.add([toWorkspaceSourceWriteRow(workspace)])
  }

  public async listWorkspaces(): Promise<WorkspaceSource[]> {
    const table = await this.core.openTable(LANCE_TABLES.WORKSPACE_SOURCE)
    const rows = (await table.query().toArray()) as WorkspaceSourceRow[]
    return rows.map(toWorkspaceSource).sort((a, b) => a.created_at - b.created_at)
  }

  public async getWorkspaceById(id: string): Promise<WorkspaceSource | null> {
    const table = await this.core.openTable(LANCE_TABLES.WORKSPACE_SOURCE)
    const rows = (await table
      .query()
      .where(`id = '${this.core.escapeSqlString(id)}'`)
      .limit(1)
      .toArray()) as WorkspaceSourceRow[]
    const row = rows[0]
    return row ? toWorkspaceSource(row) : null
  }

  public async getWorkspaceByRootPath(rootPath: string): Promise<WorkspaceSource | null> {
    const table = await this.core.openTable(LANCE_TABLES.WORKSPACE_SOURCE)
    const rows = (await table
      .query()
      .where(`root_path = '${this.core.escapeSqlString(rootPath)}'`)
      .limit(1)
      .toArray()) as WorkspaceSourceRow[]
    const row = rows[0]
    return row ? toWorkspaceSource(row) : null
  }

  public async updateWorkspace(
    id: string,
    values: Partial<
      Pick<
        WorkspaceSource,
        'name' | 'root_path' | 'status' | 'last_scan_at' | 'last_prepare_at' | 'last_error' | 'updated_at'
      >
    >
  ): Promise<void> {
    const nextValues = omitUndefined(values)
    if (Object.keys(nextValues).length === 0) return
    const table = await this.core.openTable(LANCE_TABLES.WORKSPACE_SOURCE)
    await table.update({
      where: `id = '${this.core.escapeSqlString(id)}'`,
      values: nextValues
    })
  }

  public async deleteWorkspace(id: string): Promise<void> {
    const safeId = this.core.escapeSqlString(id)
    const workspaceTable = await this.core.openTable(LANCE_TABLES.WORKSPACE_SOURCE)
    const nodeTable = await this.core.openTable(LANCE_TABLES.WORKSPACE_NODE)
    await workspaceTable.delete(`id = '${safeId}'`)
    await nodeTable.delete(`workspace_id = '${safeId}'`)
  }

  public async replaceWorkspaceNodes(workspaceId: string, nodes: WorkspaceNode[]): Promise<void> {
    await this.deleteWorkspaceNodesByWorkspaceId(workspaceId)
    if (nodes.length === 0) return
    const table = await this.core.openTable(LANCE_TABLES.WORKSPACE_NODE)
    await table.add(nodes.map(toWorkspaceNodeWriteRow))
  }

  public async upsertWorkspaceNodes(nodes: WorkspaceNode[]): Promise<void> {
    if (nodes.length === 0) return
    const table = await this.core.openTable(LANCE_TABLES.WORKSPACE_NODE)
    for (const node of nodes) {
      await table.delete(`id = '${this.core.escapeSqlString(node.id)}'`)
    }
    await table.add(nodes.map(toWorkspaceNodeWriteRow))
  }

  public async listWorkspaceNodes(params: {
    workspaceId: string
    parentId?: string
    kind?: WorkspaceNodeKind
  }): Promise<WorkspaceNode[]> {
    const table = await this.core.openTable(LANCE_TABLES.WORKSPACE_NODE)
    const where = this.core.combineWhere([
      `workspace_id = '${this.core.escapeSqlString(params.workspaceId)}'`,
      params.parentId
        ? `parent_id = '${this.core.escapeSqlString(params.parentId)}'`
        : undefined,
      params.kind ? `kind = '${this.core.escapeSqlString(params.kind)}'` : undefined
    ])
    const query = table.query()
    if (where) query.where(where)
    const rows = (await query.toArray()) as WorkspaceNodeRow[]
    return rows.map(toWorkspaceNode).sort((a, b) => a.relative_path.localeCompare(b.relative_path))
  }

  public async getWorkspaceNodeById(id: string): Promise<WorkspaceNode | null> {
    const table = await this.core.openTable(LANCE_TABLES.WORKSPACE_NODE)
    const rows = (await table
      .query()
      .where(`id = '${this.core.escapeSqlString(id)}'`)
      .limit(1)
      .toArray()) as WorkspaceNodeRow[]
    const row = rows[0]
    return row ? toWorkspaceNode(row) : null
  }

  public async listWorkspaceDocumentIds(): Promise<string[]> {
    const table = await this.core.openTable(LANCE_TABLES.WORKSPACE_NODE)
    const rows = (await table.query().toArray()) as WorkspaceNodeRow[]
    return Array.from(
      new Set(
        rows
          .map((row) => toOptionalString(row.document_id))
          .filter((documentId): documentId is string => Boolean(documentId))
      )
    )
  }

  public async findWorkspaceNodesByRelativePaths(
    workspaceId: string,
    relativePaths: string[]
  ): Promise<WorkspaceNode[]> {
    const relativePathClause = this.core.buildInClause('relative_path', relativePaths)
    const where = this.core.combineWhere([
      `workspace_id = '${this.core.escapeSqlString(workspaceId)}'`,
      relativePathClause
    ])
    if (!where) return []
    const table = await this.core.openTable(LANCE_TABLES.WORKSPACE_NODE)
    const rows = (await table.query().where(where).toArray()) as WorkspaceNodeRow[]
    return rows.map(toWorkspaceNode)
  }

  public async updateWorkspaceNode(
    id: string,
    values: Partial<
      Pick<
        WorkspaceNode,
        | 'parent_id'
        | 'exists'
        | 'size'
        | 'mtime_ms'
        | 'content_hash'
        | 'prepare_status'
        | 'document_id'
        | 'last_prepared_at'
        | 'last_error'
        | 'updated_at'
      >
    >
  ): Promise<void> {
    const nextValues = omitUndefined(values)
    if (Object.keys(nextValues).length === 0) return
    const table = await this.core.openTable(LANCE_TABLES.WORKSPACE_NODE)
    await table.update({
      where: `id = '${this.core.escapeSqlString(id)}'`,
      values: nextValues
    })
  }

  public async updateWorkspaceNodePrepareStatus(
    id: string,
    prepareStatus: WorkspacePrepareStatus,
    extras?: Pick<WorkspaceNode, 'document_id' | 'last_prepared_at' | 'last_error' | 'updated_at'>
  ): Promise<void> {
    await this.updateWorkspaceNode(id, {
      prepare_status: prepareStatus,
      document_id: extras?.document_id,
      last_prepared_at: extras?.last_prepared_at,
      last_error: extras?.last_error,
      updated_at: extras?.updated_at
    })
  }

  public async deleteWorkspaceNodesByWorkspaceId(workspaceId: string): Promise<void> {
    const table = await this.core.openTable(LANCE_TABLES.WORKSPACE_NODE)
    await table.delete(`workspace_id = '${this.core.escapeSqlString(workspaceId)}'`)
  }
}
