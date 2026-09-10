import type { AiRunContext } from '../../../types'
import type { HumanState } from '../../types'
import { RUN_DIGEST_MAX_FILE_PATHS } from '../../constants'
import { buildRunDigestPrompt } from '../../prompts/contextScope'

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

export const collectRunDigestFilePaths = (state: HumanState): string[] => {
  const paths: string[] = []
  const seen = new Set<string>()
  for (const file of state.execution.fileChanges?.changed_files || []) {
    const path = file.path.trim()
    if (!path || seen.has(path)) continue
    seen.add(path)
    paths.push(path)
    if (paths.length >= RUN_DIGEST_MAX_FILE_PATHS) break
  }
  return paths
}

export const appendRunDigestIfPossible = async (input: {
  ctx: AiRunContext
  state: HumanState
  deliveryMarkdown: string
}): Promise<void> => {
  try {
    const prompt = buildRunDigestPrompt({
      userInput: clipText(input.state.task.userInput, RUN_DIGEST_USER_MAX_CHARS),
      deliveryMarkdown: clipText(input.deliveryMarkdown, RUN_DIGEST_DELIVERY_MAX_CHARS)
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
    if (!summary) return
    await input.ctx.appendMessageLog([
      {
        kind: 'annotation',
        eventType: 'run_digest',
        payload: {
          summary,
          filePaths: collectRunDigestFilePaths(input.state)
        }
      }
    ])
  } catch {
    // 摘要失败不阻断交付；该 run 不进目录，后续判定更倾向带历史。
  }
}
