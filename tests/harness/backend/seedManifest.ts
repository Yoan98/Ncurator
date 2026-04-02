import { cp, mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { JsonValue } from '../../../src/shared/types'
import type {
  BackendSeedManifest,
  SeedKbDocumentInput,
  SeedWorkspaceFileRecord
} from './test-types'
import type { TestArtifact } from '../core/report-contract'
import { resolveRunArtifactsDir } from '../core/write-run-log'

export const BACKEND_SEED_MANIFEST_SCHEMA_VERSION = 1 as const

export type PersistedSeedWorkspaceFile = {
  relativePath: string
  summary?: string
  artifactPath?: string
  metadata?: JsonValue
}

export type PersistedSeedManifest = {
  schemaVersion: typeof BACKEND_SEED_MANIFEST_SCHEMA_VERSION
  workspaceFiles: PersistedSeedWorkspaceFile[]
  kbDocuments: SeedKbDocumentInput[]
}

const cloneJsonValue = <T extends JsonValue | undefined>(value: T): T =>
  value === undefined ? value : JSON.parse(JSON.stringify(value)) as T

const sanitizeRelativePath = (relativePath: string): string => {
  const normalized = path.posix.normalize(relativePath.split(path.sep).join('/')).replace(/^\/+/, '')
  const safeParts = normalized
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part && part !== '.' && part !== '..')

  return safeParts.length > 0 ? safeParts.join('/') : 'unnamed-seed'
}

const toArtifactId = (relativePath: string): string =>
  `seed-${sanitizeRelativePath(relativePath).replace(/[^a-zA-Z0-9._/-]/g, '-').replace(/\//g, '-')}`

export const createEmptyBackendSeedManifest = (): BackendSeedManifest => ({
  schemaVersion: BACKEND_SEED_MANIFEST_SCHEMA_VERSION,
  workspaceFiles: [],
  kbDocuments: []
})

export const cloneBackendSeedManifest = (manifest: BackendSeedManifest): BackendSeedManifest => ({
  schemaVersion: manifest.schemaVersion,
  workspaceFiles: manifest.workspaceFiles.map((file) => ({
    relativePath: file.relativePath,
    absolutePath: file.absolutePath,
    summary: file.summary,
    metadata: cloneJsonValue(file.metadata)
  })),
  kbDocuments: manifest.kbDocuments.map((document) => ({
    ...document,
    chunks: document.chunks.map((chunk) => ({
      ...chunk
    }))
  }))
})

export const appendSeedWorkspaceFile = (
  manifest: BackendSeedManifest,
  record: SeedWorkspaceFileRecord
): void => {
  manifest.workspaceFiles.push({
    relativePath: record.relativePath,
    absolutePath: record.absolutePath,
    summary: record.summary,
    metadata: cloneJsonValue(record.metadata)
  })
}

export const appendSeedKbDocuments = (
  manifest: BackendSeedManifest,
  documents: readonly SeedKbDocumentInput[]
): void => {
  manifest.kbDocuments.push(
    ...documents.map((document) => ({
      ...document,
      chunks: document.chunks.map((chunk) => ({
        ...chunk
      }))
    }))
  )
}

export const collectBackendSeedArtifacts = async (input: {
  scope: string
  caseId: string
  runId: string
  manifest: BackendSeedManifest
}): Promise<{
  artifacts: TestArtifact[]
  persistedManifest: PersistedSeedManifest
}> => {
  const artifactsDir = resolveRunArtifactsDir({
    scope: input.scope,
    caseId: input.caseId,
    runId: input.runId
  })
  const artifacts: TestArtifact[] = []
  const workspaceFiles: PersistedSeedWorkspaceFile[] = []

  for (const file of input.manifest.workspaceFiles) {
    const safeRelativePath = sanitizeRelativePath(file.relativePath)
    const artifactRelativePath = path.posix.join('seed-inputs', 'workspace', safeRelativePath)
    const artifactOutputPath = path.join(artifactsDir, artifactRelativePath)
    let artifactPath: string | undefined

    try {
      await mkdir(path.dirname(artifactOutputPath), { recursive: true })
      await cp(file.absolutePath, artifactOutputPath, { force: true })
      artifactPath = path.posix.join('artifacts', artifactRelativePath)
      artifacts.push({
        id: toArtifactId(file.relativePath),
        kind: 'other',
        path: artifactPath
      })
    } catch {
      artifactPath = undefined
    }

    workspaceFiles.push({
      relativePath: file.relativePath,
      summary: file.summary,
      artifactPath,
      metadata: cloneJsonValue(file.metadata)
    })
  }

  return {
    artifacts,
    persistedManifest: {
      schemaVersion: BACKEND_SEED_MANIFEST_SCHEMA_VERSION,
      workspaceFiles,
      kbDocuments: cloneBackendSeedManifest(input.manifest).kbDocuments
    }
  }
}
