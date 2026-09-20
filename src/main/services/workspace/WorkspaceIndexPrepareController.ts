import type {
  WebSourceIndexStatus,
  WebSourceRecord,
  WorkspaceFileIndexRecord,
  WorkspaceFileIndexStatus,
  WorkspaceIndexJobSourceKind
} from '../../../shared/types'
import type { WebSourceStore } from '../storage/domains/WebSourceStore'
import type { WorkspaceStore } from '../storage/domains/WorkspaceStore'

export class IndexPrepareCancelledError extends Error {
  public readonly code = 'INDEX_PREPARE_CANCELLED' as const

  public constructor(message = 'INDEX_PREPARE_CANCELLED') {
    super(message)
    this.name = 'IndexPrepareCancelledError'
  }
}

export const isIndexPrepareCancelledError = (error: unknown): boolean =>
  error instanceof IndexPrepareCancelledError ||
  (error instanceof Error &&
    (error.name === 'IndexPrepareCancelledError' || error.message === 'INDEX_PREPARE_CANCELLED'))

export type FilePreparePreviousSnapshot = {
  index_status: Extract<WorkspaceFileIndexStatus, 'needs_index' | 'failed'>
  last_error?: string
}

export type WebPreparePreviousSnapshot = {
  index_status: Extract<WebSourceIndexStatus, 'needs_index' | 'crawl_failed' | 'index_failed'>
  last_error?: string
}

export const toFilePreparePreviousSnapshot = (
  record: Pick<WorkspaceFileIndexRecord, 'index_status' | 'last_error'>
): FilePreparePreviousSnapshot => ({
  index_status: record.index_status === 'failed' ? 'failed' : 'needs_index',
  last_error: record.last_error
})

export const toWebPreparePreviousSnapshot = (
  source: Pick<WebSourceRecord, 'index_status' | 'last_error'>
): WebPreparePreviousSnapshot => {
  if (source.index_status === 'crawl_failed' || source.index_status === 'index_failed') {
    return { index_status: source.index_status, last_error: source.last_error }
  }
  return { index_status: 'needs_index', last_error: source.last_error }
}

export const runCancellablePrepareLoop = async <T>(input: {
  items: readonly T[]
  isCancelled: () => boolean
  runItem: (item: T) => Promise<void>
}): Promise<{ cancelled: boolean; startedCount: number; remaining: T[] }> => {
  const items = [...input.items]
  for (let index = 0; index < items.length; index += 1) {
    if (input.isCancelled()) {
      return {
        cancelled: true,
        startedCount: index,
        remaining: items.slice(index)
      }
    }
    const item = items[index]
    if (item === undefined) continue
    try {
      await input.runItem(item)
    } catch (error) {
      if (isIndexPrepareCancelledError(error) || input.isCancelled()) {
        return {
          cancelled: true,
          startedCount: index,
          remaining: items.slice(index)
        }
      }
      throw error
    }
  }
  return {
    cancelled: input.isCancelled(),
    startedCount: items.length,
    remaining: []
  }
}

type SessionState = {
  cancelled: boolean
  abort: AbortController
  filePrevious: Map<string, FilePreparePreviousSnapshot>
  webPrevious: Map<string, WebPreparePreviousSnapshot>
}

const createSession = (): SessionState => ({
  cancelled: false,
  abort: new AbortController(),
  filePrevious: new Map(),
  webPrevious: new Map()
})

export class WorkspaceIndexPrepareController {
  private readonly sessions: Record<WorkspaceIndexJobSourceKind, SessionState> = {
    file: createSession(),
    web: createSession()
  }

  public constructor(
    private readonly deps: {
      workspaceStore: WorkspaceStore
      webSourceStore: WebSourceStore
    }
  ) {}

  public beginSession(sourceKind: WorkspaceIndexJobSourceKind): void {
    this.sessions[sourceKind] = createSession()
  }

  public requestCancel(sourceKind: WorkspaceIndexJobSourceKind): void {
    const session = this.sessions[sourceKind]
    session.cancelled = true
    if (!session.abort.signal.aborted) session.abort.abort()
  }

  public isCancelled(sourceKind: WorkspaceIndexJobSourceKind): boolean {
    return this.sessions[sourceKind].cancelled
  }

  public getSignal(sourceKind: WorkspaceIndexJobSourceKind): AbortSignal {
    return this.sessions[sourceKind].abort.signal
  }

  public rememberFilePrevious(id: string, snapshot: FilePreparePreviousSnapshot): void {
    this.sessions.file.filePrevious.set(id, snapshot)
  }

  public rememberWebPrevious(id: string, snapshot: WebPreparePreviousSnapshot): void {
    this.sessions.web.webPrevious.set(id, snapshot)
  }

  public async revertUnfinishedFiles(
    previousById = this.sessions.file.filePrevious,
    now = Date.now()
  ): Promise<number> {
    let reverted = 0
    for (const [id, snapshot] of previousById.entries()) {
      reverted += await this.deps.workspaceStore.revertIndexingFileRecord(id, {
        index_status: snapshot.index_status,
        last_error: snapshot.last_error,
        updated_at: now
      })
    }
    return reverted
  }

  public async revertUnfinishedWebSources(
    previousById = this.sessions.web.webPrevious,
    now = Date.now()
  ): Promise<number> {
    let reverted = 0
    for (const [id, snapshot] of previousById.entries()) {
      reverted += await this.deps.webSourceStore.revertRunningSource(id, {
        index_status: snapshot.index_status,
        last_error: snapshot.last_error,
        updated_at: now
      })
    }
    return reverted
  }
}
