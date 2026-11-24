import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'
import type { AiRunEvent, JsonObject, JsonValue } from '../../../../src/shared/types'
import type { BackendTestRuntime } from '../test-types'
import { createAiServiceTestRunner } from '../aiServiceHarness'
import { assertRunFileReviews } from '../fileReviewAssertions'
import { buildSelectedDocxFixtureReferences } from '../aiLiveTestData'

export const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
export const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
export const hashDocx = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex')
export const jsonObject = (value: JsonValue | undefined): JsonObject =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}
export const jsonObjects = (value: JsonValue | undefined): JsonObject[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is JsonObject =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item)
      )
    : []

export const successfulDocxCalls = (events: readonly AiRunEvent[]) => {
  const starts = new Map(
    events.filter((e) => e.type === 'tool_call_started').map((e) => [e.toolCallId, e])
  )
  return events.flatMap((e) => {
    if (e.type !== 'tool_call_result' || !e.toolName.startsWith('docx_') || !e.result?.ok) return []
    const start = starts.get(e.toolCallId)
    if (!start) throw new Error('Missing start event for successful DOCX call')
    return [{ toolName: e.toolName, input: start.input, data: jsonObject(e.result.data) }]
  })
}

export async function runDocxLiveRound(
  runtime: BackendTestRuntime,
  fixture: string,
  round: number,
  userInput: string
) {
  const sourcePath = runtime.getFixtureWorkspacePath(fixture)
  const beforeChecksum = hashDocx(await fs.readFile(sourcePath))
  const runner = await createAiServiceTestRunner(runtime, {
    partnerId: 'docx-live-partner',
    runId: runtime.runId + '-round-' + round,
    selectedReferences: buildSelectedDocxFixtureReferences(runtime, [fixture]),
    userInput
  })
  const output = await runner.run()
  runtime.assertThat(output.status === 'completed', {
    name: 'docx-live-round-' + round + '-completed',
    message: '本轮真实模型任务完成。',
    data: { status: output.status, delivery: output.deliveryMarkdown }
  })
  await assertRunFileReviews(runtime, output)
  const bytes = await fs.readFile(sourcePath)
  const artifacts = output.finalArtifacts.filter(
    (artifact) => artifact.capability === 'docx' && artifact.path === sourcePath
  )
  runtime.assertThat(
    hashDocx(bytes) === beforeChecksum || artifacts.some((artifact) => artifact.applyId),
    {
      name: 'docx-live-round-' + round + '-review-artifact',
      message: '文件有变化时必须交付带修改记录的 Word 文件。'
    }
  )
  for (const artifact of artifacts) {
    if (!artifact.applyId) throw new Error('Missing DOCX review record ID')
    const record = (
      await runtime.storageService.aiFileChange.getRecord({ changeId: artifact.applyId })
    ).record
    runtime.assertThat(record?.path === sourcePath && record.afterChecksum === hashDocx(bytes), {
      name: 'docx-live-round-' + round + '-confirmed-file',
      message: '正式文件与本轮工具确认的版本一致。'
    })
  }
  const folder = path.join(runtime.workspaceRoot, 'evidence')
  await fs.mkdir(folder, { recursive: true })
  await fs.writeFile(path.join(folder, 'round-' + round + '.docx'), bytes)
  return { bytes, events: runner.events, output }
}

export async function nativeDocx(bytes: Buffer) {
  const zip = await JSZip.loadAsync(bytes)
  const xml = async (name: string) => {
    const part = zip.file(name)
    if (!part) throw new Error('Missing DOCX part ' + name)
    return part.async('string')
  }
  const dom = async (name: string) =>
    new DOMParser().parseFromString(await xml(name), 'application/xml')
  return { zip, xml, dom, document: await dom('word/document.xml') }
}
export const wordElements = (node: Element | Document, name: string) =>
  Array.from(node.getElementsByTagNameNS(WORD_NS, name))
export const wordAttr = (node: Element | undefined, name: string) =>
  node?.getAttributeNS(WORD_NS, name) ?? ''
export const wordText = (node: Element | Document) =>
  wordElements(node, 't')
    .map((t) => t.textContent ?? '')
    .join('')
