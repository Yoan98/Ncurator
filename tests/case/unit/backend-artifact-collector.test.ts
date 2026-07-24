import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AiRunEvent } from '../../../src/shared/types'
import { collectBackendRunArtifacts } from '../../harness/backend/artifactCollector'
import { resolveRunLogDir } from '../../harness/backend/write-run-log'

const createdDirs: string[] = []

describe('backend artifact collector', () => {
  afterEach(async () => {
    await Promise.all(
      createdDirs.map(async (dirPath) => {
        await fs.rm(dirPath, { recursive: true, force: true })
      })
    )
    createdDirs.length = 0
  })

  it('stores copied artifacts under stable paths while preserving display metadata', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-backend-artifacts-'))
    createdDirs.push(tempRoot)
    const previousCwd = process.cwd()
    process.chdir(tempRoot)

    try {
      const workspaceRoot = path.join(tempRoot, 'workspace')
      const runtimeEventsPath = path.join(tempRoot, 'runtime-events.jsonl')
      const artifactSourcePath = path.join(
        workspaceRoot,
        '输出',
        'draft-深度学习与图形学复习总结.docx'
      )
      await fs.mkdir(path.dirname(artifactSourcePath), { recursive: true })
      await fs.writeFile(artifactSourcePath, 'draft-bytes', 'utf8')

      const event = {
        type: 'file_artifact',
        runId: 'run-1',
        taskId: 'task-1',
        artifactId: 'artifact-123',
        capability: 'docx',
        path: artifactSourcePath,
        fileName: 'draft-深度学习与图形学复习总结.docx',
        operation: 'created',
        applyId: 'apply-123',
        createdAt: Date.now()
      } satisfies Extract<AiRunEvent, { type: 'file_artifact' }>
      await fs.writeFile(runtimeEventsPath, `${JSON.stringify(event)}\n`, 'utf8')

      const artifacts = await collectBackendRunArtifacts({
        scope: 'temp/unit',
        caseId: 'backend-artifact-collector',
        runId: '20260428-120000-000',
        workspaceRoot,
        runtimeEventsPath
      })

      expect(artifacts).toHaveLength(1)
      expect(artifacts[0]).toMatchObject({
        id: 'artifact-123',
        kind: 'other',
        path: 'artifacts/file-artifacts/artifact-123.docx',
        fileName: 'draft-深度学习与图形学复习总结.docx',
        capability: 'docx'
      })
      expect(artifacts[0]?.path).not.toContain('深度学习')

      const logDir = resolveRunLogDir({
        scope: 'temp/unit',
        caseId: 'backend-artifact-collector',
        runId: '20260428-120000-000'
      })
      const copied = await fs.readFile(path.join(logDir, artifacts[0]!.path), 'utf8')
      expect(copied).toBe('draft-bytes')
    } finally {
      process.chdir(previousCwd)
    }
  })
})
