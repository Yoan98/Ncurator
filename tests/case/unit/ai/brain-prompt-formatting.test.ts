import { describe, expect, it } from 'vitest'
import { buildBrainPrompt } from '../../../../src/main/services/ai/human/prompts/brain'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import type { AiRunContext } from '../../../../src/main/services/ai/types'

const createFakeCtx = (): AiRunContext =>
  ({
    platform: 'windows',
    runId: 'run-prompt-formatting',
    sessionId: 'session-prompt-formatting',
    preference: 'default',
    workspace: {
      workspaceId: 'workspace-prompt-formatting',
      workspaceName: 'prompt formatting workspace',
      rootPath: 'D:\\workspace'
    },
    referenceScope: {
      workspace: {
        id: 'workspace-prompt-formatting',
        rootPath: 'D:\\workspace'
      },
      selectedReferences: []
    }
  }) as AiRunContext

describe('ai unit brain prompt formatting', () => {
  it('renders skill entries without learning hints or blank lines between adjacent entries', () => {
    const state = createInitialHumanState({
      taskId: 'task-prompt-formatting',
      userInput: '继续处理任务'
    })

    const prompt = buildBrainPrompt({ state, ctx: createFakeCtx() })
    const skillCatalog =
      prompt.system.match(/<skill_catalog>([\s\S]*?)<\/skill_catalog>/)?.[1].trim() || ''

    expect(skillCatalog).not.toContain('learning 时填写')
    expect(skillCatalog).not.toMatch(/^- [^\n]+\n\n- /m)
  })
})
