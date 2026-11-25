import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SystemMessage } from '@langchain/core/messages'
import { SqliteCore } from '../../../../src/main/services/storage/sqlite/SqliteCore'
import { PartnerMemoryStore } from '../../../../src/main/services/storage/domains/PartnerMemoryStore'
import { refreshSystemContext } from '../../../../src/main/services/ai/human/systemContext'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { defaultPartnerMemoryEnabled } from '../../../../src/shared/partnerMemory'
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
  it('places the tagged toolset catalog below memory and the loaded skills below the catalog', () => {
    const ctx = createFakeCtx()
    const loaded = {
      skill: { name: 'weekly-report', description: '整理周报时使用。' },
      body: '# 周报规范\n先给结论，再列进展和风险。',
      resourceBase: '/skills/weekly-report'
    }
    ctx.userSkillService = {
      getRootDirectory: () => '/skills',
      listEnabled: () => [loaded.skill],
      loadEnabled: () => loaded
    }
    ctx.partnerMemory = {
      get: (partnerId) => ({
        partnerId,
        memories: [
          {
            category: 'cooperation_preferences',
            enabled: true,
            confirmed: '表达简洁。',
            draft: null,
            revision: 1
          },
          {
            category: 'project_background',
            enabled: true,
            confirmed: '持续开发桌面端。',
            draft: null,
            revision: 1
          }
        ]
      }),
      propose: () => undefined
    }
    const system = buildBrainSystemPrompt({ ctx, loadedSkills: [loaded] })
    const catalogStart = system.indexOf('<工具组目录>')
    const catalogEnd = system.indexOf('</工具组目录>')
    expect(catalogStart).toBeGreaterThan(system.indexOf('</长期记忆>'))
    expect(catalogEnd).toBeGreaterThan(catalogStart)
    expect(system.indexOf('可用 skill：')).toBeGreaterThan(catalogEnd)
    expect(system.indexOf('<skill\n')).toBeGreaterThan(catalogEnd)
    expect(system.slice(catalogStart, catalogEnd)).toContain('agent-control')
    expect(system.slice(catalogStart, catalogEnd)).not.toContain(loaded.body)
    expect(system.endsWith('</skill目录>')).toBe(true)
    expect(system.match(/<工具组目录>/g)).toHaveLength(1)
    expect(system).not.toContain('工具组目录：')
    expect(system).not.toContain('技能')
    expect(system.indexOf('<skill目录>')).toBeGreaterThan(catalogEnd)
    expect(system.match(/<skill目录>/g)).toHaveLength(1)
  })

  it('refreshes only enabled confirmed memories before the next inference in the same run', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-memory-prompt-'))
    const sqlite = new SqliteCore(path.join(directory, 'app.sqlite'))
    try {
      sqlite.initialize()
      const ctx = createFakeCtx()
      sqlite
        .prepare(
          'INSERT INTO partner (id,name,avatar_shape,avatar_color,created_at,updated_at,last_viewed_at) VALUES (?, ?, ?, ?, 1,1,1)'
        )
        .run(ctx.partnerId, ctx.partnerName, 'circle', 'blue')
      const memory = new PartnerMemoryStore(sqlite)
      ctx.partnerMemory = memory
      memory.propose(ctx.partnerId, 'cooperation_preferences', {
        action: 'append',
        content: '只写简体中文'
      })
      memory.propose(ctx.partnerId, 'project_background', {
        action: 'append',
        content: '正在开发桌面应用'
      })
      const cache = createHumanRuntimeCache()
      cache.messages = [new SystemMessage(buildBrainSystemPrompt({ ctx }))]
      const state = createInitialHumanState({ taskId: 'memory-task', userInput: '继续' })
      await refreshSystemContext({ ctx, cache, state })
      expect(String(cache.messages[0].content)).not.toContain('只写简体中文')
      const preference = memory.get(ctx.partnerId).memories[0]
      memory.update({
        partnerId: ctx.partnerId,
        category: preference.category,
        revision: preference.revision,
        action: 'accept'
      })
      await refreshSystemContext({ ctx, cache, state })
      const confirmedSystem = String(cache.messages[0].content)
      expect(confirmedSystem).toContain('<长期记忆>')
      expect(confirmedSystem).toContain('<合作偏好>\n只写简体中文\n</合作偏好>')
      expect(confirmedSystem).not.toContain('正在开发桌面应用')
      await refreshSystemContext({ ctx, cache, state })
      expect(String(cache.messages[0].content)).toBe(confirmedSystem)
      memory.setEnabled(ctx.partnerId, {
        ...defaultPartnerMemoryEnabled(),
        cooperation_preferences: false
      })
      await refreshSystemContext({ ctx, cache, state })
      expect(String(cache.messages[0].content)).not.toContain('<合作偏好>')
      expect(String(cache.messages[0].content)).toContain('<项目背景>')
      memory.setEnabled(ctx.partnerId, {
        cooperation_preferences: false,
        project_background: false
      })
      await refreshSystemContext({ ctx, cache, state })
      expect(String(cache.messages[0].content)).not.toContain('<长期记忆>')
    } finally {
      sqlite.close()
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  it('uses the current partner name and keeps workspace roots out of the stable system prompt', () => {
    const ctx = createFakeCtx()
    const system = buildBrainSystemPrompt({ ctx })
    const renamed = buildBrainSystemPrompt({ ctx: { ...ctx, partnerName: '另一伙伴' } })
    expect(system).toContain(ctx.partnerName)
    expect(renamed).toContain('另一伙伴')
    expect(renamed).not.toContain(ctx.partnerName)
    expect(system).toContain('操作系统：Windows')
    expect(system).toContain('<本机信息与文件约定>')
    expect(system).toContain('skill 目录：')
    expect(system).toContain('特别说明规则：')
    expect(system).toContain('file_read / file_edit')
    expect(system).toContain('name: weekly-report')
    expect(system).not.toContain('runtime_paths.')
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
    expect(emptyUser).toContain('时区：')
    expect(emptyUser).toContain('本地时间：')
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
