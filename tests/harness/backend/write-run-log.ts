import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { TestLogEvent, TestRunMeta } from './test-types'

const pad2 = (value: number): string => String(value).padStart(2, '0')
const pad3 = (value: number): string => String(value).padStart(3, '0')

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

export const resolveRunLogDir = (meta: TestRunMeta): string => {
  const parts = ['tests', 'logs', meta.domain, meta.layer, meta.suite]
  if (meta.capability) {
    parts.push(meta.capability)
  }
  parts.push(meta.caseId, meta.runId)
  return path.resolve(process.cwd(), ...parts)
}

const toJsonLines = (events: readonly TestLogEvent[]): string =>
  events.map((event) => JSON.stringify(event)).join('\n')

export const writeRunLog = async (input: {
  meta: TestRunMeta
  events: readonly TestLogEvent[]
}): Promise<string> => {
  const logDir = resolveRunLogDir(input.meta)
  await mkdir(logDir, { recursive: true })
  await writeFile(path.join(logDir, 'meta.json'), JSON.stringify(input.meta, null, 2), 'utf8')
  await writeFile(path.join(logDir, 'timeline.jsonl'), toJsonLines(input.events), 'utf8')
  return logDir
}
