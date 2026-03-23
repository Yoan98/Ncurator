import type { JsonValue } from '../../../src/shared/types'

export const TEST_LOG_SCHEMA_VERSION = 3 as const

export type TestDomain = 'ai' | 'kb-search' | 'temp'
export type TestLayer = 'backend' | 'e2e'
export type TestRunStatus = 'passed' | 'failed'
export type TestLogStatus = 'info' | 'ok' | 'failed' | 'skipped'
export type TestLogEventType = 'run' | 'step' | 'assertion' | 'artifact' | 'signal' | 'error'
export type TestArtifactKind =
  | 'trace'
  | 'screenshot'
  | 'video'
  | 'playwright-report'
  | 'jsonl'
  | 'other'

export type TestRunStats = {
  durationMs: number
  steps: number
  assertions: number
  errors: number
  artifacts: number
}

export type TestRunRuntime = {
  driver: 'backend' | 'playwright'
  target: 'node' | 'electron'
  modelName: string | null
}

export type TestRunMeta = {
  schemaVersion: typeof TEST_LOG_SCHEMA_VERSION
  runId: string
  caseId: string
  scope: string
  status: TestRunStatus
  startedAt: string
  finishedAt: string
  stats: TestRunStats
  runtime: TestRunRuntime
}

export type TestLogEvent = {
  ts: string
  type: TestLogEventType
  name: string
  status: TestLogStatus
  id?: string
  message: string
  data?: JsonValue
}

export type TestArtifactRefs = {
  stepId?: string
  assertionId?: string
}

export type TestArtifact = {
  id: string
  kind: TestArtifactKind
  path: string
  refs?: TestArtifactRefs
}

export type TestArtifactsIndex = {
  schemaVersion: typeof TEST_LOG_SCHEMA_VERSION
  items: TestArtifact[]
}
