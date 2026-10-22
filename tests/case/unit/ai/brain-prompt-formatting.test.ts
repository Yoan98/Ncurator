import { describe, expect, it } from 'vitest'
import {
  buildBrainSystemPrompt,
  buildBrainUserMessage
} from '../../../../src/main/services/ai/human/prompts/brain'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import type { AiRunContext } from '../../../../src/main/services/ai/types'

const createFakeCtx = (): AiRunContext => {
  const ctx: Partial<AiRunContext> = {
    platform: 'windows',
    runId: 'run-prompt-formatting',
    partnerId: 'partner-prompt-formatting',
    partnerName: '测试伙伴',
    workspaceRoots: ['D:\\workspace'],
    runStartedAt: 0,
    preference: 'default',
    executionPermission: 'review',
    referenceScope: {
      selectedReferences: [],
      attachments: []
    }
  }
  return ctx as AiRunContext
}

const titledSection = (text: string, title: string): string => {
  const tag = `<${title}>\n`
  if (text.includes(tag)) {
    return text.split(tag)[1].split(`\n</${title}>`)[0].trim()
  }
  const marker = `${title}：\n`
  const start = text.indexOf(marker)
  if (start < 0) return ''
  const after = text.slice(start + marker.length)
  const next = after.search(/\n\n[^\n]+：\n/)
  return (next < 0 ? after : after.slice(0, next)).trim()
}

describe('ai unit brain prompt formatting', () => {
  it('uses the current partner name and keeps workspace roots out of the stable system prompt', () => {
    const ctx = createFakeCtx()
    const system = buildBrainSystemPrompt({ ctx })
    const renamed = buildBrainSystemPrompt({ ctx: { ...ctx, partnerName: '另一伙伴' } })
    expect(system).toContain(ctx.partnerName)
    expect(renamed).toContain('另一伙伴')
    expect(renamed).not.toContain(ctx.partnerName)
    expect(system).toContain('windows')
    expect(system).not.toContain(ctx.workspaceRoots[0])
    const state = createInitialHumanState({ taskId: 'task-prompt', userInput: '继续处理任务' })
    const user = buildBrainUserMessage({ state, ctx })
    expect(user).toContain(ctx.workspaceRoots[0])
    expect(user).toContain('继续处理任务')
  })

  it('omits empty preference, workspace roots and reference scope from the user message', () => {
    const state = createInitialHumanState({
      taskId: 'task-prompt-formatting',
      userInput: '继续处理任务'
    })
    const emptyCtx = {
      ...createFakeCtx(),
      workspaceRoots: []
    } as AiRunContext
    const emptyUser = buildBrainUserMessage({ state, ctx: emptyCtx })

    expect(emptyUser).toContain('<用户诉求>')
    expect(emptyUser).toContain('继续处理任务')
    expect(emptyUser).not.toContain('<偏好>')
    expect(emptyUser).not.toContain('<默认用户工作区>')
    expect(emptyUser).not.toContain('<用户引用的文档>')
    expect(emptyUser).not.toContain('<用户添加的附件>')
    expect(emptyUser).toContain('<当前时间>')
    expect(emptyUser).toContain('current_time.local_iso')
    expect(emptyUser).not.toContain('<active_state>')
  })

  it('renders non-default preference, workspace roots and reference scope when present', () => {
    const state = createInitialHumanState({
      taskId: 'task-prompt-formatting',
      userInput: '继续处理任务'
    })
    const ctx = {
      ...createFakeCtx(),
      preference: 'local_sources_relaxed',
      referenceScope: {
        selectedReferences: [
          {
            kind: 'file',
            workspaceId: 'workspace-1',
            nodeId: 'node-1',
            name: 'note.md',
            relativePath: 'note.md',
            absolutePath: 'D:\\workspace\\note.md',
            kbAvailability: 'indexed',
            kbDocumentIds: ['doc-1']
          }
        ],
        attachments: []
      }
    } as AiRunContext
    const user = buildBrainUserMessage({ state, ctx })

    expect(titledSection(user, '偏好').length).toBeGreaterThan(0)
    expect(user).toContain('<默认用户工作区>')
    expect(user).toContain('<用户引用的文档>')
    expect(user).toContain('note.md')
    expect(user).toContain('D:\\workspace\\note.md')
    expect(user).not.toContain('<用户添加的附件>')
    expect(user).not.toContain('当前没有用户显式指定的参考范围')
    expect(user).not.toContain('当前没有用户添加的附件')
  })

  it('omits memory and active_state even if toolsets and plan exist', () => {
    const state = createInitialHumanState({
      taskId: 'task-prompt-formatting',
      userInput: '继续处理任务'
    })
    state.memory.plan = [{ title: '整理资料', status: 'done' }]
    state.toolsets.loadedToolsetIds = ['docx-read']
    const user = buildBrainUserMessage({ state, ctx: createFakeCtx() })
    expect(user).not.toContain('<active_state>')
    expect(user).not.toContain('<memory>')
    expect(user).not.toContain('整理资料')
    expect(user).not.toContain('docx-read')
  })
})
