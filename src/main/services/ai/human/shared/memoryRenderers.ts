import type { HumanState } from '../types'
import { renderLineList } from '../../utils/render'

export type HumanMemoryRenderMode = 'brain_prompt' | 'mouth_prompt' | 'fallback_markdown'

const getRenderFallback = (mode: HumanMemoryRenderMode): string =>
  mode === 'fallback_markdown' ? '无' : 'none'

const getRenderStyle = (mode: HumanMemoryRenderMode): 'plain' | 'bullet' =>
  mode === 'fallback_markdown' ? 'bullet' : 'plain'

const renderFactLine = (
  fact: HumanState['brainMemory']['inside']['facts'][number],
  mode: HumanMemoryRenderMode
): string =>
  mode === 'brain_prompt'
    ? `- 事实 ${fact.id}：${fact.summary}；支持证据=[${fact.evidenceIds.join(', ')}]`
    : mode === 'mouth_prompt'
      ? `- ${fact.summary} (evidenceIds=[${fact.evidenceIds.join(', ')}])`
      : fact.summary

const renderEvidenceLine = (
  evidence: HumanState['brainMemory']['inside']['evidences'][number],
  mode: HumanMemoryRenderMode
): string => {
  if (mode === 'brain_prompt') {
    return `- 证据 ${evidence.id}：来源工具 ${evidence.toolName}；摘要：${evidence.summary}${evidence.rawRef ? `；rawRef=${evidence.rawRef}` : ''}`
  }

  const compact = `${evidence.toolName}: ${evidence.summary}${evidence.rawRef ? ` (${evidence.rawRef})` : ''}`
  return mode === 'mouth_prompt' ? `- ${compact}` : compact
}

const renderOpenQuestionLine = (question: string, mode: HumanMemoryRenderMode): string =>
  mode === 'fallback_markdown' ? question : `- ${question}`

export const renderHumanFactLines = (
  state: HumanState,
  mode: HumanMemoryRenderMode
): string =>
  renderLineList(
    state.brainMemory.inside.facts.map((fact) => renderFactLine(fact, mode)),
    {
      fallback: getRenderFallback(mode),
      style: getRenderStyle(mode)
    }
  )

export const renderHumanEvidenceLines = (
  state: HumanState,
  mode: HumanMemoryRenderMode
): string =>
  renderLineList(
    state.brainMemory.inside.evidences.map((evidence) => renderEvidenceLine(evidence, mode)),
    {
      fallback: getRenderFallback(mode),
      style: getRenderStyle(mode)
    }
  )

export const renderHumanOpenQuestionLines = (
  state: HumanState,
  mode: HumanMemoryRenderMode
): string =>
  renderLineList(
    state.brainMemory.inside.openQuestions.map((question) =>
      renderOpenQuestionLine(question, mode)
    ),
    {
      fallback: getRenderFallback(mode),
      style: getRenderStyle(mode)
    }
  )
