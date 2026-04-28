import { cp, mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { AiRunEvent } from '../../../src/shared/types'
import type { TestArtifact } from '../core/run-log-contract'
import { iterateJsonLines } from '../core/read-run-log'
import { resolveRunArtifactsDir } from './write-run-log'

const ASCII_SAFE_EXTENSION = /^\.[A-Za-z0-9_-]+$/

const resolveArtifactSourcePath = (workspaceRoot: string, artifactPath: string): string =>
  path.isAbsolute(artifactPath) ? artifactPath : path.resolve(workspaceRoot, artifactPath)

const getArtifactStorageExtension = (
  event: Extract<AiRunEvent, { type: 'file_artifact' }>
): string => {
  const extension = path.extname(event.path || '')
  return ASCII_SAFE_EXTENSION.test(extension) ? extension : ''
}

const buildArtifactRelativePath = (event: Extract<AiRunEvent, { type: 'file_artifact' }>): string =>
  path.posix.join(
    'file-artifacts',
    `${event.artifactId}${getArtifactStorageExtension(event)}`
  )

export const collectBackendRunArtifacts = async (input: {
  scope: string
  caseId: string
  runId: string
  workspaceRoot: string
  runtimeEventsPath: string
}): Promise<TestArtifact[]> => {
  const artifactsDir = resolveRunArtifactsDir({
    scope: input.scope,
    caseId: input.caseId,
    runId: input.runId
  })
  const collected: TestArtifact[] = []

  for await (const event of iterateJsonLines<AiRunEvent>(input.runtimeEventsPath)) {
    if (event.type !== 'file_artifact') continue
    const relativePath = buildArtifactRelativePath(event)
    const targetPath = path.join(artifactsDir, relativePath)
    const sourcePath = resolveArtifactSourcePath(input.workspaceRoot, event.path)

    try {
      await mkdir(path.dirname(targetPath), { recursive: true })
      await cp(sourcePath, targetPath, { force: true })
    } catch {
      continue
    }

    collected.push({
      id: event.artifactId,
      kind: 'other',
      path: path.posix.join('artifacts', relativePath),
      fileName: event.fileName,
      capability: event.capability,
      artifactRole: event.artifactRole,
      refs: event.stepId ? { stepId: event.stepId } : undefined
    })
  }

  return collected
}
