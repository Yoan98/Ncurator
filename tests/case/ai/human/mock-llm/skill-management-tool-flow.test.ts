import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { UserSkillService } from '../../../../../src/main/services/skills/UserSkillService'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { createAiServiceTestRunner } from '../../../../harness/backend/aiServiceHarness'
import { executeToolCall } from '../../../../../src/main/services/ai/human/node/handNode/toolExecutor'
import { createHumanRuntimeCache } from '../../../../../src/main/services/ai/human/node/utils/runtimeCache'
import {
  buildLoadToolsetsDecision,
  buildToolDecision,
  buildCompleteTaskDecision
} from '../testUtils'

describe('skill management production flow', () => {
  it(
    'skill-management-tool-flow',
    async () =>
      runBackendCase({
        caseId: 'skill-management-tool-flow',
        harnessMode: 'mock-llm',
        domain: 'ai',
        suite: 'human',
        groups: ['mock-llm'],
        fixtures: [],
        runMode: 'single',
        knowledge: 'none',
        description: '仅脚本化模型，真实注册、发布、读取、按名称加载、更新与停用刷新说明。',
        execute: async (runtime) => {
          const partnerId = 'skill-flow'
          await runtime.partnerStore.savePartner({
            id: partnerId,
            name: '规范伙伴',
            avatar_shape: 'circle',
            avatar_color: 'blue',
            created_at: 1,
            updated_at: 1,
            last_viewed_at: 1,
            pinned: false,
            pinned_at: null
          })
          const service = new UserSkillService(
            runtime.storageService.userSkill,
            path.join(runtime.workspaceRoot, '.managed')
          )
          const source = path.join(runtime.workspaceRoot, 'draft')
          await fs.mkdir(source)
          const markdown = (body: string) => `---\nname: report\ndescription: Reports\n---\n${body}`
          await fs.writeFile(path.join(source, 'SKILL.md'), markdown('RULE-ORIGINAL'))
          const idFromFeedback = (user: string): string => {
            const id =
              /<skill_document id="([^"]+)"/.exec(user)?.[1] ??
              /id=([A-Za-z0-9:-]+)/.exec(user)?.[1]
            if (!id) throw new Error('The model did not receive a skill ID in real tool feedback')
            return id
          }
          const runner = await createAiServiceTestRunner(runtime, {
            partnerId,
            userSkillService: service,
            userInput: '创建并启用规范，读取后加载，修改规范，再停用。',
            llmScript: {
              'human.brain': [
                {
                  output: buildLoadToolsetsDecision({
                    toolsetNames: ['skill-management'],
                    summary: '加载管理工具'
                  })
                },
                {
                  output: buildToolDecision({
                    toolName: 'skill_edit',
                    args: { sourcePath: source, enabled: true },
                    summary: '创建规范'
                  })
                },
                ({ user }) =>
                  buildToolDecision({
                    toolName: 'skill_read',
                    args: { id: idFromFeedback(user) },
                    summary: '查看规范'
                  }),
                {
                  output: buildToolDecision({
                    toolName: 'load_skill',
                    args: { skillNames: ['report'] },
                    summary: '加载规范'
                  })
                },
                async ({ user }) => {
                  await fs.writeFile(path.join(source, 'SKILL.md'), markdown('RULE-UPDATED'))
                  return buildToolDecision({
                    toolName: 'skill_edit',
                    args: { id: idFromFeedback(user), sourcePath: source },
                    summary: '更新规范'
                  })
                },
                ({ user }) =>
                  buildToolDecision({
                    toolName: 'skill_edit',
                    args: { id: idFromFeedback(user), enabled: false },
                    summary: '停用规范'
                  }),
                {
                  output: buildCompleteTaskDecision({
                    summary: '完成',
                    deliveryMarkdown: '已完成规范管理。'
                  })
                }
              ]
            }
          })
          const output = await runner.run()
          const childErrors = await Promise.all(
            ['skill_read', 'skill_edit'].map(async (toolName) => {
              try {
                await executeToolCall({
                  ctx: {
                    ...runtime.createAiRunContext({ partnerId, userSkillService: service }),
                    isSubagent: true
                  },
                  cache: createHumanRuntimeCache(),
                  taskId: runtime.taskId,
                  loadedToolsetIds: ['skill-management'],
                  toolCallId: `child-${toolName}`,
                  toolName,
                  args: { id: service.list()[0].id }
                })
                return ''
              } catch (error) {
                return error instanceof Error ? error.message : String(error)
              }
            })
          )
          const systems = runner.io.map((item) =>
            JSON.stringify(
              item.requestWire?.messages.filter((message) => message.role === 'system')
            )
          )
          return {
            status: output.status,
            childErrors,
            systems,
            enabled: service.listEnabled(partnerId),
            skills: service.list(),
            events: runner.events
          }
        },
        assert: async (result, runtime) => {
          runtime.assertThat(
            result.childErrors.every((error) => error.includes('子任务不能使用')),
            {
              name: 'child-management-boundary',
              message: '生产执行层拒绝子任务读取或编辑共享 skill。'
            }
          )
          runtime.assertThat(
            result.status === 'completed' &&
              result.skills.length === 1 &&
              result.enabled.length === 0,
            { name: 'management-flow', message: '真实主链完成发布、读取、更新和停用。' }
          )
          runtime.assertThat(
            !result.systems[3]?.includes('RULE-ORIGINAL') &&
              result.systems[4]?.includes('RULE-ORIGINAL') === true &&
              result.systems[5]?.includes('RULE-UPDATED') === true &&
              !result.systems.at(-1)?.includes('RULE-UPDATED'),
            {
              name: 'current-system-instructions',
              message: '读取不激活；加载、更新及停用后的 System 反映有效说明。',
              data: { systems: result.systems }
            }
          )
        }
      }),
    120_000
  )
})
