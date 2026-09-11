import type { ChatMessageLogEntry } from '../../../../../../shared/types'
import type { AiRunContext } from '../../../types'
import type { HumanState } from '../../types'
import { buildRunDigestPrompt } from '../../prompts/contextScope'
import { renderCompactReferenceScope } from '../../prompts/referenceScope'
import {
  collectSessionRunSlices
} from '../../memory/runDigestCatalog'
import { getPartnerDigestCoordinator } from '../../memory/partnerDigestCoordinator'
import { isConversationLogRecord } from '../../memory/transcript'

const RUN_DIGEST_USER_MAX_CHARS = 500
const RUN_DIGEST_DELIVERY_MAX_CHARS = 2000
const RUN_DIGEST_SUMMARY_MAX_CHARS = 80

const clipText = (value: string, maxChars: number): string => {
  const trimmed = value.trim()
  if (trimmed.length <= maxChars) return trimmed
  return trimmed.slice(0, maxChars)
}

export const normalizeRunDigestSummary = (raw: string): string => {
  const firstLine = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
  if (!firstLine) return ''
  const collapsed = firstLine.replace(/\s+/g, ' ').trim()
  return clipText(collapsed, RUN_DIGEST_SUMMARY_MAX_CHARS)
}

export const collectRunDigestFileChangePaths = (state: HumanState): string[] => {
  const paths: string[] = []
  const seen = new Set<string>()
  for (const file of state.execution.fileChanges?.changed_files || []) {
    const path = file.path.trim()
    if (!path || seen.has(path)) continue
    seen.add(path)
    paths.push(path)
  }
  return paths
}

const buildRunDigestEntry = (input: {
  status: 'pending' | 'completed' | 'failed'
  summary: string
  fileChangePaths: string[]
}): ChatMessageLogEntry => ({
  kind: 'annotation',
  eventType: 'run_digest',
  payload: {
    status: input.status,
    summary: input.summary,
    fileChangePaths: input.fileChangePaths
  }
})

const runStillHasConversation = async (input: {
  ctx: AiRunContext
  runId: string
}): Promise<boolean> => {
  const records = await input.ctx.loadMessageLog()
  return records.some((record) => record.runId === input.runId && isConversationLogRecord(record))
}

const generateAndAppendRunDigest = async (input: {
  ctx: AiRunContext
  state: HumanState
  deliveryMarkdown: string
  fileChangePaths: string[]
  signal: AbortSignal
}): Promise<void> => {
  const appendTerminal = async (status: 'completed' | 'failed', summary: string): Promise<void> => {
    if (input.signal.aborted) return
    if (!(await runStillHasConversation({ ctx: input.ctx, runId: input.ctx.runId }))) return
    await input.ctx.appendMessageLog([
      buildRunDigestEntry({
        status,
        summary,
        fileChangePaths: input.fileChangePaths
      })
    ])
  }

  try {
    if (input.signal.aborted) return
    const prompt = buildRunDigestPrompt({
      userInput: clipText(input.state.task.userInput, RUN_DIGEST_USER_MAX_CHARS),
      deliveryMarkdown: clipText(input.deliveryMarkdown, RUN_DIGEST_DELIVERY_MAX_CHARS),
      compactReferences: renderCompactReferenceScope(input.ctx.referenceScope)
    })
    const raw = await input.ctx.chatText({
      caller: 'human.run_digest',
      taskId: input.state.task.taskId,
      system: prompt.system,
      user: prompt.user,
      schemaName: 'human_run_digest',
      temperature: 0.1
    })
    const summary = normalizeRunDigestSummary(raw)
    await appendTerminal(summary ? 'completed' : 'failed', summary)
  } catch {
    await appendTerminal('failed', '')
  }
}

export const enqueueRunDigest = (input: {
  ctx: AiRunContext
  state: HumanState
  deliveryMarkdown: string
  fileChangePaths: string[]
}): void => {
  getPartnerDigestCoordinator().enqueue({
    partnerId: input.ctx.partnerId,
    runId: input.ctx.runId,
    work: (signal) =>
      generateAndAppendRunDigest({
        ctx: input.ctx,
        state: input.state,
        deliveryMarkdown: input.deliveryMarkdown,
        fileChangePaths: input.fileChangePaths,
        signal
      })
  })
}

export const buildPendingRunDigestEntry = (fileChangePaths: string[]): ChatMessageLogEntry =>
  buildRunDigestEntry({
    status: 'pending',
    summary: '',
    fileChangePaths
  })

export const settleStalePendingDigests = async (input: {
  loadMessageLog: AiRunContext['loadMessageLog']
  appendMessageLog: AiRunContext['appendMessageLog']
}): Promise<void> => {
  const records = await input.loadMessageLog()
  const coordinator = getPartnerDigestCoordinator()
  for (const slice of collectSessionRunSlices(records)) {
    if (slice.digestStatus !== 'pending') continue
    if (coordinator.hasRun(slice.runId)) continue
    await input.appendMessageLog(
      [
        buildRunDigestEntry({
          status: 'failed',
          summary: '',
          fileChangePaths: slice.fileChangePaths
        })
      ],
      { runId: slice.runId }
    )
  }
}
