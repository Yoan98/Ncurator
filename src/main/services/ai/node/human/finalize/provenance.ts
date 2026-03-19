import type { LocalSourceUsageStatus } from '../../../../../../shared/types'
import type { HumanState } from '../shared/state'

export const deriveProvenance = (state: HumanState, deliveryMarkdown: string): {
  localSourceStatus: LocalSourceUsageStatus
  localSourceSummary: string
} => {
  const joined = `${state.outcome?.summary || ''}\n${deliveryMarkdown}`
  if (
    joined.includes('本地资料不足') ||
    joined.includes('本地证据不足') ||
    joined.includes('允许继续使用非本地信息')
  ) {
    return {
      localSourceStatus: 'insufficient',
      localSourceSummary: '当前交付已明确说明本地资料不足。'
    }
  }

  const usedLocalEvidence = state.memory.evidence.some(
    (item) =>
      item.kind === 'tool_result' &&
      (String(item.toolName || '').startsWith('kb_') ||
        String(item.toolName || '').startsWith('docx_') ||
        item.toolName === 'terminal_run_command')
  )
  const usedLocalTrace = state.trace.steps.some(
    (item) =>
      item.action === 'invoke_tool' &&
      (String(item.toolName || '').startsWith('kb_') ||
        String(item.toolName || '').startsWith('docx_') ||
        item.toolName === 'terminal_run_command')
  )
  if (usedLocalEvidence || usedLocalTrace) {
    return {
      localSourceStatus: 'used',
      localSourceSummary: '本轮交付使用了本地资料能力。'
    }
  }

  return {
    localSourceStatus: 'not_used',
    localSourceSummary: '本轮未形成可确认的本地资料使用结果。'
  }
}
