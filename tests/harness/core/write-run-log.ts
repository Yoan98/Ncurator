import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AiLlmIoRecord, AiRunEvent } from '../../../src/shared/types'
import {
  TEST_LOG_SCHEMA_VERSION,
  type TestArtifactsIndex,
  type TestArtifact,
  type TestLogEvent,
  type TestRunMeta
} from './report-contract'
import type { PersistedSeedManifest } from '../backend/seedManifest'

const pad2 = (value: number): string => String(value).padStart(2, '0')
const pad3 = (value: number): string => String(value).padStart(3, '0')

const splitScope = (scope: string): string[] => {
  const parts = scope
    .split('/')
    .map((item) => item.trim())
    .filter(Boolean)
  if (parts.length < 2) {
    throw new Error(`invalid test scope: ${scope}`)
  }
  return parts
}

export const createRunId = (startedAtMs: number): string => {
  const date = new Date(startedAtMs)
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
    '-',
    pad2(date.getHours()),
    pad2(date.getMinutes()),
    pad2(date.getSeconds()),
    '-',
    pad3(date.getMilliseconds())
  ].join('')
}

export const resolveRunLogDir = (input: {
  scope: string
  caseId: string
  runId: string
}): string => {
  const parts = ['tests', 'logs', ...splitScope(input.scope), input.caseId, input.runId]
  return path.resolve(process.cwd(), ...parts)
}

export const resolveRunArtifactsDir = (input: {
  scope: string
  caseId: string
  runId: string
}): string => path.join(resolveRunLogDir(input), 'artifacts')

const toJsonLines = <T>(events: readonly T[]): string =>
  events.map((event) => JSON.stringify(event)).join('\n')

const toArtifactsIndex = (items: readonly TestArtifact[]): TestArtifactsIndex => ({
  schemaVersion: TEST_LOG_SCHEMA_VERSION,
  items: [...items]
})

export const writeRunLog = async (input: {
  meta: TestRunMeta
  events: readonly TestLogEvent[]
  runtimeEvents: readonly AiRunEvent[]
  llmIoRecords?: readonly AiLlmIoRecord[]
  artifacts: readonly TestArtifact[]
  seedManifest?: PersistedSeedManifest
}): Promise<string> => {
  const logDir = resolveRunLogDir({
    scope: input.meta.scope,
    caseId: input.meta.caseId,
    runId: input.meta.runId
  })
  await mkdir(logDir, { recursive: true })
  await writeFile(path.join(logDir, 'meta.json'), JSON.stringify(input.meta, null, 2), 'utf8')
  await writeFile(path.join(logDir, 'timeline.jsonl'), toJsonLines(input.events), 'utf8')
  await writeFile(path.join(logDir, 'runtime-events.jsonl'), toJsonLines(input.runtimeEvents), 'utf8')
  await writeFile(
    path.join(logDir, 'llm-io.jsonl'),
    toJsonLines(input.llmIoRecords || []),
    'utf8'
  )
  await writeFile(
    path.join(logDir, 'artifacts.json'),
    JSON.stringify(toArtifactsIndex(input.artifacts), null, 2),
    'utf8'
  )
  await writeFile(
    path.join(logDir, 'seed-manifest.json'),
    JSON.stringify(
      input.seedManifest || {
        schemaVersion: 1,
        workspaceFiles: [],
        kbDocuments: []
      },
      null,
      2
    ),
    'utf8'
  )
  return logDir
}
