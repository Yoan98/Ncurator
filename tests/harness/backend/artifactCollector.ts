import { cp, mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { AiRunEvent } from '../../../src/shared/types'
import type { TestArtifact } from '../core/run-log-contract'
import { iterateJsonLines } from '../core/read-run-log'
import { resolveRunArtifactsDir } from './write-run-log'

const sanitizeFileName = (value: string): string => {
  const trimmed = value.trim()
  if (trimmed.length === 0) return 'artifact'
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, '-')
}

const resolveArtifactSourcePath = (workspaceRoot: string, artifactPath: string): string =>
  path.isAbsolute(artifactPath) ? artifactPath : path.resolve(workspaceRoot, artifactPath)

const buildArtifactRelativePath = (event: Extract<AiRunEvent, { type: 'file_artifact' }>): string =>
  path.posix.join(
    'file-artifacts',
    `${event.artifactId}-${sanitizeFileName(event.fileName || path.basename(event.path) || 'artifact')}`
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
      refs: event.stepId ? { stepId: event.stepId } : undefined
    })
  }

  return collected
}
