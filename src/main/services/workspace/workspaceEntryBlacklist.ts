import fs from 'node:fs/promises'
import path from 'node:path'
import type { DocumentsStore } from '../storage/domains/DocumentsStore'
import type { WorkspaceStore } from '../storage/domains/WorkspaceStore'

const DIRECTORY_NAME_BLACKLIST = new Set([
  'node_modules',
  'bower_components',
  '__pycache__',
  '__pypackages__',
  'venv',
  'coverage',
  'htmlcov',
  'playwright-report',
  '__MACOSX'
])

const DIRECTORY_MARKER_BLACKLIST = ['pyvenv.cfg'] as const

export const isHiddenWorkspacePath = (relativePath: string): boolean =>
  relativePath
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .some((segment) => segment.startsWith('.'))

/** One directory-marker snapshot per listing, scan or index cleanup. */
export class WorkspaceEntryFilter {
  private readonly directoryMarkers = new Map<string, Promise<boolean>>()

  public constructor(private readonly rootPath: string) {}

  public async isIgnored(relativePath: string, kind: 'file' | 'directory'): Promise<boolean> {
    if (isHiddenWorkspacePath(relativePath)) return true
    const rootName = path.basename(this.rootPath)
    if (rootName.startsWith('.') || DIRECTORY_NAME_BLACKLIST.has(rootName)) return true

    const segments = relativePath.replace(/\\/g, '/').split('/').filter(Boolean)
    const directories = kind === 'directory' ? segments : segments.slice(0, -1)
    if (directories.some((name) => DIRECTORY_NAME_BLACKLIST.has(name))) return true

    let directory = this.rootPath
    if (await this.hasBlacklistedMarker(directory)) return true
    for (const name of directories) {
      directory = path.join(directory, name)
      if (await this.hasBlacklistedMarker(directory)) return true
    }
    return false
  }

  private hasBlacklistedMarker(directory: string): Promise<boolean> {
    let result = this.directoryMarkers.get(directory)
    if (!result) {
      result = Promise.all(
        DIRECTORY_MARKER_BLACKLIST.map((name) =>
          fs.stat(path.join(directory, name)).then(
            (stat) => stat.isFile(),
            () => false
          )
        )
      ).then((matches) => matches.some(Boolean))
      this.directoryMarkers.set(directory, result)
    }
    return result
  }
}

export const pruneBlacklistedWorkspaceFiles = async (input: {
  workspaceStore: WorkspaceStore
  documentsStore: DocumentsStore
}): Promise<void> => {
  for (const workspace of await input.workspaceStore.listWorkspaces()) {
    const filter = new WorkspaceEntryFilter(workspace.root_path)
    const records = await input.workspaceStore.listWorkspaceFileIndexRecords(workspace.id)
    const ignored: typeof records = []
    for (const record of records) {
      if (await filter.isIgnored(record.relative_path, 'file')) ignored.push(record)
    }
    const documentIds = new Set(
      ignored.map((record) => record.document_id).filter((id): id is string => Boolean(id))
    )
    // Include documents left behind by an interrupted file-index cleanup.
    const documents = await input.documentsStore.listDocumentsBySourceType('file', workspace.id)
    for (const document of documents) {
      if (!document.file_path) continue
      const relativePath = path.relative(workspace.root_path, document.file_path)
      if (
        relativePath === '..' ||
        relativePath.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativePath)
      )
        continue
      if (await filter.isIgnored(relativePath.split(path.sep).join('/'), 'file')) {
        documentIds.add(document.id)
      }
    }
    if (documentIds.size > 0) {
      const result = await input.documentsStore.deleteDocumentsByIds([...documentIds])
      if (!result.success) throw new Error(result.error || result.msg || '清理工作空间索引失败')
    }
    await input.workspaceStore.deleteWorkspaceFileIndexRecordsByIds(
      ignored.map((record) => record.id)
    )
  }
}
