import type { AiArtifactRef } from '../../../../../shared/types'

const renderArtifact = (artifact: AiArtifactRef): string =>
  artifact.kind === 'file'
    ? [
        'file',
        artifact.fileName ? `fileName=${artifact.fileName}` : '',
        artifact.path ? `path=${artifact.path}` : '',
        artifact.reviewId ? `reviewId=${artifact.reviewId}` : '',
        artifact.artifactRole ? `artifactRole=${artifact.artifactRole}` : '',
        artifact.summary ? `summary=${artifact.summary}` : ''
      ]
        .filter(Boolean)
        .join('；')
    : [
        'draft_review',
        `reviewId=${artifact.review.reviewId}`,
        `changeCount=${String(artifact.review.changeCount)}`,
        artifact.summary ? `summary=${artifact.summary}` : ''
      ]
        .filter(Boolean)
        .join('；')

const renderArtifacts = (artifacts: AiArtifactRef[]): string =>
  artifacts.length > 0
    ? artifacts.map((artifact) => `- ${renderArtifact(artifact)}`).join('\n')
    : 'none'

export const buildSessionMemoryPrompt = (input: {
  previousRollingSummary: string
  latestUserMessage: string
  latestAssistantMessage: string
  latestArtifacts: AiArtifactRef[]
}) => {
  const system = `
<system>
  <role>
    你是会话级跨任务连续性摘要整理器。
  </role>

  <background>
    这不是当前任务内的过程记忆，而是同一聊天会话跨多次 human run 的连续性摘要。
    它会在后续新任务的 brain prompt 中作为 session_memory 出现。
    最近几轮真实对话会由 runtime 另行提供为 recent_conversation，因此 rollingSummary 不需要重复最近消息原文。
    单次 run 内的详细工具过程由 roundHistory 和 compactBlocks 保存，不应写入 rollingSummary。
  </background>

  <principles>
    - 基于 previous_rolling_summary、latest_user_message、latest_assistant_message、latest_artifacts 更新 rollingSummary。
    - 在不丢失太多后续有用信息的情况下尽可能简短。
    - 只保留跨任务仍可能有用的连续性信息，例如当前主线、延续对象、稳定偏好与约束、跨任务仍未失效的状态。
    - 不保存单轮工具过程，不重复最近消息原文，不列出 artifact 明细清单。
    - 不得编造；不得保存密码、密钥、凭证等敏感信息。
  </principles>

  <output_contract>
    - 只输出 JSON，不得输出额外文字。
    - 键名必须且只能是：rollingSummary。
    - rollingSummary 为字符串，只保留后续新任务仍可能需要的跨任务连续性信息。
  </output_contract>

  <output_example>
{
  "rollingSummary": "当前主线：用户正在整理本周风险周报。延续对象：已生成一份待确认周报草稿。稳定偏好与约束：用户希望基于工作区资料，不覆盖原文件。"
}
  </output_example>
</system>
`.trim()

  const user = `
<session_memory_task>
  <previous_rolling_summary>
${String(input.previousRollingSummary || '').trim() || 'none'}
  </previous_rolling_summary>

  <latest_user_message>
${String(input.latestUserMessage || '').trim() || 'none'}
  </latest_user_message>

  <latest_assistant_message>
${String(input.latestAssistantMessage || '').trim() || 'none'}
  </latest_assistant_message>

  <latest_artifacts>
${renderArtifacts(input.latestArtifacts)}
  </latest_artifacts>
</session_memory_task>
`.trim()

  return { system, user }
}
