import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  buildCompleteTaskDecision,
  buildLearnSkillsDecision,
  buildToolDecision,
  filterAiRunEventsByType,
  summarizeHumanSteps
} from '../testUtils'

describe('ai human mock-llm backend', () => {
  it('learning-hand-mouth-smoke', async () => {
    await runBackendCase({
      caseId: 'learning-hand-mouth-smoke',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证真实 human graph 在 mock-llm 模式下能稳定走通 brain -> learning -> hand -> mouth 主链路。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        let mouthPrompt = ''
        const runner = createHumanTestRunner(runtime, {
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['workspace-cli'],
                  summary: '先学习 workspace-cli',
                  reason: '需要先加载 terminal skill 才能进行真实工具调用。',
                  expectedOutcome: '获得 terminal 工具后继续推进。'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'terminal_run_command',
                  args: {
                    command: 'pwd'
                  },
                  summary: '读取当前工作区路径',
                  reason: '用一次只读命令验证真实 hand 执行链路。',
                  expectedOutcome: '拿到当前工作区路径后结束任务。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '已完成基础链路验证。',
                  reason: '核心链路已经真实走通，可以进入最终交付。',
                  expectedOutcome: '输出稳定的最终结果。'
                })
              }
            ],
            'human.mouth': [
              ({ user }) => {
                mouthPrompt = user
                return {
                  summary: '已完成基础链路验证。',
                  deliveryMarkdown: '# Smoke Delivery\n\n已完成基础 human 主链路验证。'
                }
              }
            ]
          }
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请学习一个 skill，调用一次工具，然后给出最终结果。'
        })

        return {
          output,
          mouthPrompt,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const humanSteps = filterAiRunEventsByType(result.events, 'human_step')
        const toolResults = filterAiRunEventsByType(result.events, 'tool_call_result')
        const deliveryEvents = filterAiRunEventsByType(result.events, 'task_delivery_ready')
        const stageSet = new Set(humanSteps.map((event) => event.stage))

        runtime.assertThat(
          result.output.status === 'completed' &&
            stageSet.has('human_brain') &&
            stageSet.has('human_learning') &&
            stageSet.has('human_hand') &&
            stageSet.has('human_mouth'),
          {
            name: 'human-mainline-visits-all-four-parts',
            message: 'mock-llm smoke case 应显式走过 brain、learning、hand、mouth 四个部位。',
            data: {
              stages: Array.from(stageSet),
              steps: summarizeHumanSteps(result.events)
            }
          }
        )

        runtime.assertThat(
          toolResults.some((event) => event.toolName === 'terminal_run_command') &&
            deliveryEvents.length === 1,
          {
            name: 'human-mainline-completes-with-real-tool-and-real-mouth',
            message: 'mock-llm smoke case 应完成真实工具调用，并通过真实 mouth 收束为最终交付。',
            data: {
              toolResults: toolResults.map((event) => event.toolName),
              deliveryCount: deliveryEvents.length
            }
          }
        )
      }
    })
  })

  it('watchhint-retry', async () => {
    await runBackendCase({
      caseId: 'watchhint-retry',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证 duplicate learning 触发真实 watch_hint 后，graph 仍能回到 brain 并继续完成任务。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const runner = createHumanTestRunner(runtime, {
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['workspace-cli'],
                  summary: '第一次学习 workspace-cli',
                  reason: '需要 terminal skill。',
                  expectedOutcome: '加载 tool 后继续执行。'
                })
              },
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['workspace-cli'],
                  summary: '重复学习 workspace-cli',
                  reason: '故意触发 learning watch_hint。',
                  expectedOutcome: '验证 watch_hint 后能继续回到 brain。'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'terminal_run_command',
                  args: {
                    command: 'pwd'
                  },
                  summary: '回到 brain 后执行真实工具',
                  reason: '确认 watch_hint 不会阻断真实链路。',
                  expectedOutcome: '拿到工作区路径并结束。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: 'watch_hint 回退后链路恢复正常。',
                  reason: 'duplicate learning 已被真实 learning node 消化。',
                  expectedOutcome: '结束任务。'
                })
              }
            ],
            'human.mouth': [
              {
                output: {
                  summary: 'watch_hint 回退后链路恢复正常。',
                  deliveryMarkdown: '# Watch Hint\n\n已验证 duplicate learning 后仍可继续执行。'
                }
              }
            ]
          }
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请故意触发一次 watch_hint，然后继续完成任务。'
        })

        return {
          output,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const watchHints = filterAiRunEventsByType(result.events, 'watch_hint')
        const toolResults = filterAiRunEventsByType(result.events, 'tool_call_result')

        runtime.assertThat(
          result.output.status === 'completed' &&
            watchHints.some(
              (event) =>
                event.source === 'learning' &&
                event.summary.includes('重复学习 workspace-cli')
            ) &&
            toolResults.some((event) => event.toolName === 'terminal_run_command'),
          {
            name: 'duplicate-learning-watchhint-recovers',
            message: 'duplicate learning 应由真实 learning node 产出 watch_hint，并在之后继续完成工具调用。',
            data: {
              watchHints,
              toolResults: toolResults.map((event) => ({
                toolName: event.toolName,
                ok: event.ok,
                code: event.code
              }))
            }
          }
        )
      }
    })
  })

  it('tool-failure-recovery', async () => {
    await runBackendCase({
      caseId: 'tool-failure-recovery',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证真实工具失败后，brain 能读取失败结果并继续完成最终交付。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const runner = createHumanTestRunner(runtime, {
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['workspace-cli'],
                  summary: '学习 terminal skill',
                  reason: '需要执行真实工具。',
                  expectedOutcome: '获得 terminal 工具后继续。'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'terminal_run_command',
                  args: {
                    command: 'cat definitely-missing-file.txt'
                  },
                  summary: '执行一个会失败的只读命令',
                  reason: '验证真实工具失败和错误恢复链路。',
                  expectedOutcome: '拿到失败结果并继续交付限制说明。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '工具失败已被识别并吸收。',
                  reason: '失败结果已经足够支持最终说明，不需要继续重试。',
                  expectedOutcome: '输出明确限制。'
                })
              }
            ],
            'human.mouth': [
              {
                output: {
                  summary: '工具失败已被识别并吸收。',
                  deliveryMarkdown: '# Failure Recovery\n\n已确认命令失败，并在最终结果中说明限制。'
                }
              }
            ]
          }
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请执行一次会失败的工具调用，然后继续输出结果。'
        })

        return {
          output,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const toolResults = filterAiRunEventsByType(result.events, 'tool_call_result')
        const failedResult = toolResults.find((event) => event.toolName === 'terminal_run_command')

        runtime.assertThat(
          result.output.status === 'completed' &&
            Boolean(failedResult) &&
            failedResult?.result?.ok === false &&
            failedResult.result?.code !== 'ok',
          {
            name: 'human-recovers-from-real-tool-failure',
            message: '真实工具失败后，human 仍应继续走到 mouth 并输出最终结果。',
            data: failedResult
          }
        )
      }
    })
  })

  it('tool-limit-converge', async () => {
    await runBackendCase({
      caseId: 'tool-limit-converge',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证真实 hand node 超过 hardActionLimit 后会发出收敛型 watch_hint。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const runner = createHumanTestRunner(
          runtime,
          {
            structuredOutputScript: {
              'human.brain': [
                {
                  output: buildLearnSkillsDecision({
                    skillIds: ['workspace-cli'],
                    summary: '学习 terminal skill',
                    reason: '需要连续执行两次只读命令。',
                    expectedOutcome: '获取 terminal 工具。'
                  })
                },
                {
                  output: buildToolDecision({
                    toolName: 'terminal_run_command',
                    args: {
                      command: 'pwd'
                    },
                    summary: '执行第一轮只读命令',
                    reason: '准备触发第二轮工具调用。',
                    expectedOutcome: '拿到工作区路径。'
                  })
                },
                {
                  output: buildToolDecision({
                    toolName: 'terminal_run_command',
                    args: {
                      command: 'ls'
                    },
                    summary: '执行第二轮只读命令',
                    reason: '超过临时上限后应触发收敛提醒。',
                    expectedOutcome: '验证 hand watch_hint。'
                  })
                },
                {
                  output: buildCompleteTaskDecision({
                    summary: '已观察到收敛提醒。',
                    reason: '两次真实工具调用已经满足测试目标。',
                    expectedOutcome: '结束任务。'
                  })
                }
              ],
              'human.mouth': [
                {
                  output: {
                    summary: '已观察到收敛提醒。',
                    deliveryMarkdown: '# Tool Limit\n\n已验证真实 hand 节点的收敛提醒。'
                  }
                }
              ]
            },
            humanRuntimeOverrides: {
              hardActionLimit: 1
            }
          },
          {
            hardActionLimit: 1
          }
        )

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请连续执行两次只读命令，并观察收敛提醒。'
        })

        return {
          output,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const watchHints = filterAiRunEventsByType(result.events, 'watch_hint')

        runtime.assertThat(
          result.output.status === 'completed' &&
            watchHints.some(
              (event) =>
                event.source === 'hand' &&
                event.summary.includes('超过临时上限 1')
            ),
          {
            name: 'hand-emits-tool-limit-watchhint',
            message: '真实 hand node 超过 hardActionLimit 后应写出收敛型 watch_hint。',
            data: watchHints
          }
        )
      }
    })
  })

  it('approval-denied-restricted-delivery', async () => {
    await runBackendCase({
      caseId: 'approval-denied-restricted-delivery',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证真实审批拒绝会阻止高风险 terminal 命令落地，并把限制带入最终交付。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const blockedPath = path.join(runtime.workspaceRoot, 'blocked-dir')
        const runner = createHumanTestRunner(runtime, {
          approvalPolicy: 'deny-medium-high',
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['workspace-cli'],
                  summary: '学习 terminal skill',
                  reason: '需要触发一次受审批约束的命令。',
                  expectedOutcome: '获得 terminal 工具。'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'terminal_run_command',
                  args: {
                    command: 'mkdir blocked-dir'
                  },
                  summary: '执行会被拒绝的命令',
                  reason: '验证真实审批拒绝路径。',
                  expectedOutcome: '返回 approval_denied。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '审批拒绝已被正确处理。',
                  reason: '命令已被阻止，不应继续执行。',
                  expectedOutcome: '对外说明限制。'
                })
              }
            ],
            'human.mouth': [
              {
                output: {
                  summary: '审批拒绝已被正确处理。',
                  deliveryMarkdown: '# Approval Denied\n\n已说明命令因审批被拒绝而未执行。'
                }
              }
            ]
          }
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请尝试执行一个需要审批的命令，并在被拒绝后说明限制。'
        })

        let blockedDirExists = true
        try {
          await fs.stat(blockedPath)
        } catch {
          blockedDirExists = false
        }

        return {
          output,
          blockedDirExists,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const toolResults = filterAiRunEventsByType(result.events, 'tool_call_result')
        const approvalEvents = filterAiRunEventsByType(result.events, 'approval_decision')
        const deniedResult = toolResults.find((event) => event.toolName === 'terminal_run_command')

        runtime.assertThat(
          result.output.status === 'completed' &&
            result.blockedDirExists === false &&
            deniedResult?.result?.code === 'approval_denied' &&
            approvalEvents.some((event) => event.approved === false),
          {
            name: 'approval-denial-stops-real-command-execution',
            message: '审批拒绝后，真实 terminal 命令不应落地执行，并应把 approval_denied 传回 human。',
            data: {
              deniedResult,
              approvalEvents
            }
          }
        )
      }
    })
  })
})
