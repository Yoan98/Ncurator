import fs from 'node:fs/promises'
import path from 'node:path'
import { resolveRunLogDir } from '../../harness/backend/write-run-log'
import type { TestArtifactsIndex, TestRunMeta } from '../../harness/core/run-log-contract'

export const readCapturedRunLog = async (input: {
  scope: string
  caseId: string
  runId: string
}): Promise<{
  logDir: string
  meta: TestRunMeta
  artifacts: TestArtifactsIndex
}> => {
  const logDir = resolveRunLogDir(input)
  const [metaRaw, artifactsRaw] = await Promise.all([
    fs.readFile(path.join(logDir, 'meta.json'), 'utf8'),
    fs.readFile(path.join(logDir, 'artifacts.json'), 'utf8')
  ])

  return {
    logDir,
    meta: JSON.parse(metaRaw) as TestRunMeta,
    artifacts: JSON.parse(artifactsRaw) as TestArtifactsIndex
  }
}
