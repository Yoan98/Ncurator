import { describe, expect, it } from 'vitest'
import { buildBrainPrompt } from '../../../../src/main/services/ai/human/prompts/brain'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import type { AiRunContext } from '../../../../src/main/services/ai/types'

const createFakeCtx = (): AiRunContext =>
  ({
    platform: 'macos',
    runId: 'run-1',
    workspace: {
      id: 'ws-1',
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

describe('ai unit brain decision-hint prompt contract', () => {
  it('renders local environment with platform and current system time', () => {
    const state = createInitialHumanState({
      taskId: 'task-1',
      userInput: '检查当前环境'
    })

    const prompt = buildBrainPrompt({
      state,
      ctx: createFakeCtx()
    }).user
    const section = prompt.match(/<local_environment>([\s\S]*?)<\/local_environment>/)?.[1] || ''

    expect(prompt).not.toContain('<terminal_platform>')
    expect(section).toContain('<platform>macos</platform>')
    expect(section).toMatch(/<iso>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z<\/iso>/)
    expect(section).toMatch(/<timezone>[^<]+<\/timezone>/)
  })

  it('renders current decision hint in decision_hint and keeps latest execution in task_progress', () => {
    const state = createInitialHumanState({
      taskId: 'task-1',
      userInput: '继续处理 docx'
    })

    state.execution.currentThought = {
      thought: {
        next: '继续处理 docx 批量写'
      },
      nextAction: {
        action: 'hand',
        calls: [
          {
            toolName: 'docx_edit',
            args: {
              sourcePath: 'report.docx',
              actions: [
                {
                  type: 'insert_blocks',
                  position: 'after',
                  anchorBlockId: 'b:1',
                  blocks: [{ type: 'paragraph', text: '补充内容' }]
                }
              ]
            }
          }
        ]
      }
    }

    state.memory.taskRun.rounds = [
      {
        roundId: 1,
        createdAt: 1,
        thought: state.execution.currentThought,
        execution: {
          kind: 'hand',
          calls:
            state.execution.currentThought.nextAction.action === 'hand'
              ? state.execution.currentThought.nextAction.calls
              : [],
          toolResults: [
            {
              toolName: 'docx_edit',
              ok: false,
              data: {
                error: 'cannot resolve anchorBlockId=b:1 in current active snapshot'
              },
              diagnosticText: 'cannot resolve anchorBlockId=b:1 in current active snapshot'
            }
          ],
          decisionHint: {
            code: 'hand_docx_edit_failed',
            detail: {
              toolName: 'docx_edit',
              sourcePath: 'report.docx',
              action: 'insert_blocks',
              error: 'cannot resolve anchorBlockId=b:1 in current active snapshot',
              diagnostic: 'cannot resolve anchorBlockId=b:1 in current active snapshot'
            }
          }
        }
      }
    ]

    state.execution.pendingDecisionHint = {
      code: 'hand_docx_positioned_write_blocked',
      detail: {
        toolName: 'docx_edit',
        sourcePath: 'report.docx',
        action: 'insert_blocks',
        diagnostic: '当前命中复杂定位排版区域：包含“达到反走样。”的区域，暂不支持自动编辑'
      }
    }

    state.memory.thought = {
      next: '这段不应直接出现在 task_progress 的判断段落',
      todolist: [
        {
          item: '修正文档写入',
          status: 'todo'
        }
      ],
      progressionSummary: '已发现目标区域命中定位排版保护，需要按最新执行结果重新判断。'
    }

    const prompt = buildBrainPrompt({
      state,
      ctx: createFakeCtx()
    }).user

    const taskProgressSection =
      prompt.match(/<task_progress>([\s\S]*?)<\/task_progress>/)?.[1] || ''
    const correctionHintSection =
      prompt.match(/<decision_hint>([\s\S]*?)<\/decision_hint>/)?.[1] || ''

    expect(prompt).not.toContain('<latest_round>')
    expect(taskProgressSection).toContain('最新一轮决策如下')
    expect(taskProgressSection).toContain('判断：')
    expect(taskProgressSection).toContain('继续处理 docx 批量写')
    expect(taskProgressSection).toContain('执行：')
    expect(taskProgressSection).toContain('类型：hand')
    expect(taskProgressSection).toContain(
      'cannot resolve anchorBlockId=b:1 in current active snapshot'
    )
    expect(taskProgressSection).not.toContain('上一轮 docx_edit 写入失败')
    expect(correctionHintSection).toContain('刚才尝试修改的 docx 区域命中了定位排版保护')
    expect(correctionHintSection).toContain(
      '诊断：当前命中复杂定位排版区域：包含“达到反走样。”的区域'
    )
    expect(correctionHintSection).toContain('不会被自动修改')
  })

  it('requires references disclosure when nextAction is mouth', () => {
    const state = createInitialHumanState({
      taskId: 'task-2',
      userInput: '总结依据'
    })

    const prompt = buildBrainPrompt({
      state,
      ctx: createFakeCtx()
    }).system

    expect(prompt).toContain('nextAction为mouth时：')
    expect(prompt).toContain('nextAction.evidenceReferences')
    expect(prompt).toContain('usedFor')
    expect(prompt).toContain('支撑了最终交付的哪些地方')
    expect(prompt).toContain('evidenceReferences[*].resourceType 必须为 file 或 web')
    expect(prompt).toContain('没有明确路径或 URL 的资料不要放入 evidenceReferences')
  })

  it('renders prompt-friendly output shape for hand calls while keeping args generic', () => {
    const state = createInitialHumanState({
      taskId: 'task-shape',
      userInput: '继续处理'
    })

    const prompt = buildBrainPrompt({
      state,
      ctx: createFakeCtx()
    }).system

    const outputShapeSection = prompt.match(/<output_shape>([\s\S]*?)<\/output_shape>/)?.[1] || ''

    expect(outputShapeSection).toContain('toolName: string')
    expect(outputShapeSection).toContain('args: object')
    expect(outputShapeSection).toContain('{ thought: { next: string')
    expect(outputShapeSection).not.toContain('toolName: "terminal_run"')
    expect(outputShapeSection).not.toContain('toolName: "docx_create"')
    expect(outputShapeSection).not.toContain('\n      thought: {')
  })

  it('renders conversation_history, round_history, and task_progress under the new contract', () => {
    const state = createInitialHumanState({
      taskId: 'task-3',
      userInput: '继续处理资料'
    })

    state.memory.thought = {
      next: '这段不应作为 thought 区块正文出现',
      todolist: [
        {
          item: '核对资料范围',
          status: 'todo'
        }
      ],
      progressionSummary: '已建立初始推进基线。'
    }

    const prompt = buildBrainPrompt({
      state,
      ctx: createFakeCtx()
    })

    expect(prompt.system).toContain('conversation_history：当前会话历史视图。')
    expect(prompt.system).toContain('round_history：当前任务的历史证据视图。')
    expect(prompt.system).toContain('task_progress：当前任务的全局进度信息。')
    expect(prompt.user).toContain('<task_progress>')
    expect(prompt.user).toContain('</task_progress>')
    expect(prompt.user).toContain('<conversation_history>')
    expect(prompt.user).toContain('<summary>')
    expect(prompt.user).toContain('<recent_turns>')
    expect(prompt.user).toContain('<round_history>')
    expect(prompt.user).toContain('<compactions>')
    expect(prompt.user).toContain('<rounds>')
    expect(prompt.user).not.toContain('<conversation_context>')
    expect(prompt.user).not.toContain('<task_run_context>')
    expect(prompt.user).not.toContain('<latest_round>')
    expect(prompt.user).not.toContain('<prior_rounds>')
    expect(prompt.user).toContain('待办路径：')
    expect(prompt.user).toContain('推进摘要：')
    expect(prompt.user).toContain('核对资料范围')
    expect(prompt.user).toContain('已建立初始推进基线。')
    expect(prompt.user).not.toContain('<thought>')
    expect(prompt.user).not.toContain('当前与下一步：')
    expect(prompt.user).not.toContain('这段不应作为 thought 区块正文出现')
  })

  it('renders compact json examples and compact tool input schema in brain prompt', () => {
    const state = createInitialHumanState({
      taskId: 'task-4',
      userInput: '继续处理资料'
    })

    const prompt = buildBrainPrompt({
      state,
      ctx: createFakeCtx()
    })

    const learningExampleSection =
      prompt.system.match(/<example_learning>([\s\S]*?)<\/example_learning>/)?.[1] || ''
    const toolPlanExampleSection =
      prompt.system.match(/<example_tool_plan>([\s\S]*?)<\/example_tool_plan>/)?.[1] || ''
    const deliveryExampleSection =
      prompt.system.match(/<example_delivery>([\s\S]*?)<\/example_delivery>/)?.[1] || ''

    expect(learningExampleSection).toContain(
      '{"thought":{"next":"当前缺少读取 docx 的能力说明，先补齐读取能力再继续判断资料内容。","todolist":[{"item":"补齐读取 docx 的能力说明","status":"todo"},{"item":"检查是否已经满足用户诉求并能进入最终交付","status":"todo"}],"progressionSummary":"-当前任务的用户诉求是关于审批驳回时是否保留原文件，但缺少读取 docx 的能力说明，无法判断资料内容。\\n-每个todolist项的推进理解：'
    )
    expect(toolPlanExampleSection).toContain(
      '{"thought":{"next":"当前缺少工作区文件事实，先读取当前目录建立资料范围。"},"nextAction":{"action":"hand","calls":[{"toolName":"terminal_run","args":{"command":"pwd"}}]}}'
    )
    expect(deliveryExampleSection).toContain(
      '{"thought":{"next":"审批驳回是否保留原文件已经确认，当前证据足够进入最终交付。","todolist":[{"item":"确认审批驳回时是否保留原文件","status":"done"},{"item":"检查是否已经满足用户诉求并能进入最终交付","status":"done"}],"progressionSummary":"-当前任务的用户诉求是关于审批驳回时是否保留原文件，已经确认审批驳回时会保留原文件，当前证据足够进入最终交付。\\n-每个todolist项的推进理解：'
    )
    expect(prompt.user).toContain('{ command: string, commandExplanation: string, cwd?: string }')
    expect(prompt.user).toContain(
      '{"command":"ls .","commandExplanation":"列出当前工作目录下的文件和文件夹。","cwd":"."}'
    )
    expect(prompt.user).toContain(
      '- 输入结构：\n    { queryText: string, strategy?: "auto" | "semantic" | "keyword", limit?: integer, sourceType?: "all" | "file" | "web", documentIds?: Array<string> }'
    )
    expect(prompt.user).not.toContain('{\n        command: string\n        cwd?: string\n      }')
    expect(prompt.user).not.toContain('{\n      "command": "ls 工作"')
  })
})
