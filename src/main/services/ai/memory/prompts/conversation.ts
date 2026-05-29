import type { AiArtifactRef } from '../../../../../shared/types'

const renderArtifact = (artifact: AiArtifactRef): string =>
  [
    'file',
    artifact.fileName ? `fileName=${artifact.fileName}` : '',
    artifact.path ? `path=${artifact.path}` : '',
    artifact.applyId ? `applyId=${artifact.applyId}` : '',
    artifact.summary ? `summary=${artifact.summary}` : ''
  ]
    .filter(Boolean)
    .join('；')

const renderArtifacts = (artifacts: AiArtifactRef[]): string =>
  artifacts.length > 0
    ? artifacts.map((artifact) => `- ${renderArtifact(artifact)}`).join('\n')
    : 'none'

export const buildConversationMemoryPrompt = (input: {
  previousSummary: string
  latestUserMessage: string
  latestAssistantMessage: string
  latestArtifacts: AiArtifactRef[]
}) => {
  const system = `
<system>
  <role>
    你是会话连续性摘要整理器。
  </role>


  <principles>
    -基于旧 summary 和最新一轮对话结果，生成更新后的完整摘要，保留仍有效的信息、合入未来有用的新信息，并用最新状态替代过时理解
    -保留未来对话仍可能需要延续的主线、对象、产物状态、稳定偏好、约束、未解决事项和重要结论修正
    -删除单轮执行过程、消息原文复述、artifact 明细、已完成且后续无关的信息
  </principles>

  <output_contract>
    - 只输出 JSON，不得输出额外文字。
    - 键名必须且只能是：summary。
    - summary 为字符串，内容是更新后的完整会话连续性摘要。
  </output_contract>

  <output_example>
{
  "summary": "用户正在准备本周风险周报，偏好基于工作区资料且不覆盖原文件。延续对象：一份待确认风险周报草稿。当前状态：草稿已生成，仍缺负责人确认。"
}
  </output_example>
</system>
`.trim()

  const user = `
<conversation_summary_task>
  <previous_summary>
${String(input.previousSummary || '').trim() || 'none'}
  </previous_summary>

  <latest_user_message>
${String(input.latestUserMessage || '').trim() || 'none'}
  </latest_user_message>

  <latest_assistant_message>
${String(input.latestAssistantMessage || '').trim() || 'none'}
  </latest_assistant_message>

  <latest_artifacts>
${renderArtifacts(input.latestArtifacts)}
  </latest_artifacts>
</conversation_summary_task>
`.trim()

  return { system, user }
}
