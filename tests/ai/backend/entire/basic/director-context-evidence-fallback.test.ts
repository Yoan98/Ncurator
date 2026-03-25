import { test } from 'vitest'
import { createContextEnrichNode } from '../../../../../src/main/services/ai/director/node/humanSubtasks'
import { createInitialAiRunState } from '../../../../../src/main/services/ai/director/state/schema'
import type {
  DirectorNodeContext,
  HumanTaskOutput,
  HumanTaskRunner
} from '../../../../../src/main/services/ai/types'

test('director-context-evidence-fallback', async () => {
  const ctx: DirectorNodeContext = {
    runId: 'director-context-fallback-run',
    checkCancelled: () => undefined,
    chatStructured: async () => {
      throw new Error('chatStructured should not be called in context enrich fallback test')
    },
    sendEvent: () => undefined,
    loadHistory: async () => ({
      recentTurnsText: '',
      sessionSummaryText: ''
    }),
    selectedScopeSummary: 'workspace: default'
  }
  const runHumanTask: HumanTaskRunner = async (): Promise<HumanTaskOutput> => ({
    taskId: 'context-1',
    status: 'completed',
    summary: '已确认这次修改只应作用于当前选中的 PRD 文档。',
    deliveryMarkdown:
      '# 上下文补充结果\n\n## 本轮结论\n已补充当前上下文。\n\n## 当前边界\n- 当前仅限 PRD。\n\n## 未决项\n无\n\n## 建议补充方向\n- 如需继续，可补充更多材料。'
  })
  const node = createContextEnrichNode({
    ctx,
    runHumanTask
  })
  const state = {
    ...createInitialAiRunState({
      runId: 'director-context-fallback-run',
      sessionId: 'test-session',
      input: '继续处理刚才的 PRD'
    }),
    directorStage: 'director_context_human' as const,
    contextObjective: '确认本轮处理范围'
  }

  const patch = await node(state)
  if (
    patch.contextRounds !== 1 ||
    patch.contextEvidence?.[0] !== '已确认这次修改只应作用于当前选中的 PRD 文档。' ||
    patch.directorStage !== 'director_intent'
  ) {
    throw new Error(
      `expected context enrich to fallback to summary evidence: ${JSON.stringify(patch)}`
    )
  }
})
