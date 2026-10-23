import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AiRunEvent, AiFileChangeRecord } from '../../../src/shared/types'
import type { TestArtifact } from '../core/run-log-contract'
import { iterateJsonLines } from '../core/read-run-log'
import { resolveRunArtifactsDir } from './write-run-log'
import type { PptDiffManifest } from '../../../src/main/services/ai/human/tools/ppt/types'

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
  path.posix.join('file-artifacts', `${event.artifactId}${getArtifactStorageExtension(event)}`)

export const collectBackendRunArtifacts = async (input: {
  scope: string
  caseId: string
  runId: string
  workspaceRoot: string
  runtimeEventsPath: string
  outputFiles?: readonly string[]
  fileChangeRecords?: readonly AiFileChangeRecord[]
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
      refs: event.stepId ? { stepId: event.stepId } : undefined
    })
    if (event.applyId) {
      const record = input.fileChangeRecords?.find((record) => record.id === event.applyId)
      if (!record?.previewPath) continue
      const reviewRelative = path.posix.join('file-artifacts', `${event.artifactId}.review`)
      const reviewDir = path.join(artifactsDir, reviewRelative)
      try {
        await cp(path.dirname(record.previewPath), reviewDir, { recursive: true, force: true })
        const reviewPath = path.join(reviewDir, path.basename(record.previewPath))
        if (record.capability === 'ppt') {
          const manifest = JSON.parse(await readFile(reviewPath, 'utf8')) as PptDiffManifest
          for (const slide of manifest.slides)
            for (const side of [slide.before, slide.after])
              if (side)
                side.svg = path.join(
                  reviewDir,
                  path.relative(path.dirname(record.previewPath), side.svg)
                )
          await writeFile(reviewPath, JSON.stringify(manifest))
        }
        collected.push({
          id: `${event.artifactId}-review`,
          kind: 'other',
          path: path.posix.join('artifacts', reviewRelative, path.basename(reviewPath)),
          fileName: path.basename(reviewPath),
          capability: record.capability
        })
      } catch (error) {
        console.error('[TEST-REVIEW-ARCHIVE]', { changeId: record.id, error })
      }
    }
  }

  for (const relative of input.outputFiles || []) {
    const source = path.resolve(input.workspaceRoot, relative)
    const within = path.relative(input.workspaceRoot, source)
    if (within.startsWith('..') || path.isAbsolute(within))
      throw new Error(`Output escapes workspace: ${relative}`)
    const target = path.join(artifactsDir, 'outputs', within)
    try {
      await mkdir(path.dirname(target), { recursive: true })
      await cp(source, target)
      collected.push({
        id: `output-${relative}`,
        kind: 'other',
        path: path.posix.join('artifacts', 'outputs', within.split(path.sep).join('/')),
        fileName: path.basename(relative)
      })
    } catch {
      /* failed runs still archive every output that exists */
    }
  }
  return collected
}
