import { describe, expect, it } from 'vitest'
import { buildMouthDeliveryMessage } from '../../../../src/main/services/ai/human/prompts/mouth'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import type { AiRunContext } from '../../../../src/main/services/ai/types'

const createFakeCtx = (): AiRunContext =>
  ({
    platform: 'darwin',
    runId: 'run-1',
    sessionId: 'session-1',
    runStartedAt: 0,
    preference: 'default',
    workspace: {
      workspaceId: 'ws-1',
      workspaceName: '测试工作区',
      rootPath: '/tmp/workspace'
    },
    referenceScope: {
      workspace: {
        id: 'ws-1',
        rootPath: '/tmp/workspace'
      },
      selectedReferences: []
    }
  }) as AiRunContext

describe('ai unit mouth prompt contract', () => {
  it('renders delivery guidance, file changes and evidence references', () => {
    const state = createInitialHumanState({
      taskId: 'task-mouth-progress',
      userInput: '整理最终交付'
    })

    state.execution.deliveryGuidanceItems = [
      { source: 'brain', text: '必须在交付中说明证据来源。' }
    ]
    state.execution.fileChanges = {
      changed_files: [
        {
          id: 'change-1',
          fileName: '深度学习与图形学复习总结.docx',
          path: '学习笔记/深度学习与图形学复习总结.docx',
          capability: 'docx',
          operation: 'updated',
          changeCount: 1,
          insertCount: 1,
          deleteCount: 0,
          status: 'applied'
        }
      ]
    }
    state.execution.evidenceReferences = [
      {
        label: '深度学习.docx',
        path: '学习笔记/深度学习.docx',
        resourceType: 'file',
        usedFor: '支撑深度学习部分的总结内容',
        accessStatus: 'accessible'
      }
    ]

    const prompt = buildMouthDeliveryMessage({
      state,
      ctx: createFakeCtx()
    })

    const guidanceSection =
      prompt.match(/<delivery_guidance>([\s\S]*?)<\/delivery_guidance>/)?.[1] || ''
    const fileChangesSection =
      prompt.match(/<file_changes>([\s\S]*?)<\/file_changes>/)?.[1] || ''
    const evidenceSection =
      prompt.match(/<evidence_references>([\s\S]*?)<\/evidence_references>/)?.[1] || ''

    expect(guidanceSection).toContain('必须在交付中说明证据来源。')
    expect(fileChangesSection).toContain('深度学习与图形学复习总结.docx')
    expect(evidenceSection).toContain('引用资料：深度学习.docx')
    expect(evidenceSection).toContain('支撑深度学习部分的总结内容')
  })

  it('renders the ncurator://ref markdown link format for evidence references', () => {
    const state = createInitialHumanState({
      taskId: 'task-mouth-ref',
      userInput: '整理最终交付'
    })
    state.execution.evidenceReferences = [
      {
        label: '深度学习.docx',
        path: '学习笔记/深度学习.docx',
        resourceType: 'file',
        usedFor: '支撑深度学习部分的总结内容',
        accessStatus: 'accessible'
      }
    ]

    const prompt = buildMouthDeliveryMessage({ state, ctx: createFakeCtx() })

    expect(prompt).toContain('ncurator://ref?kind=reference')
    expect(prompt).toContain('resourceType=file')
    expect(prompt).toContain('accessStatus=accessible')
    expect(prompt).toContain('[深度学习.docx](ncurator://ref?')
  })

  it('renders a none fallback for guidance and evidence references', () => {
    const state = createInitialHumanState({
      taskId: 'task-mouth-empty',
      userInput: '整理最终交付'
    })

    const prompt = buildMouthDeliveryMessage({ state, ctx: createFakeCtx() })

    expect(prompt).toContain('<delivery_guidance>')
    expect(prompt).toContain('none')
    expect(prompt).toContain('<evidence_references>')
  })

  it('does not render removed rounds or task evidence blocks', () => {
    const state = createInitialHumanState({
      taskId: 'task-mouth-progress',
      userInput: '整理最终交付'
    })

    const prompt = buildMouthDeliveryMessage({ state, ctx: createFakeCtx() })

    expect(prompt).not.toContain('<rounds>')
    expect(prompt).not.toContain('task_evidence')
    expect(prompt).not.toContain('<todolist>')
    expect(prompt).not.toContain('类型：mouth')
  })
})
