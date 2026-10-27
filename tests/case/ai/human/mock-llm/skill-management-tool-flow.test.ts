import path from 'node:path'
import type { JsonObject } from '../../../../../src/shared/types'
import { describe, it } from 'vitest'
import { UserSkillService } from '../../../../../src/main/services/skills/UserSkillService'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { createAiServiceTestRunner } from '../../../../harness/backend/aiServiceHarness'
import { executeToolCall } from '../../../../../src/main/services/ai/human/node/handNode/toolExecutor'
import { createHumanRuntimeCache } from '../../../../../src/main/services/ai/human/node/utils/runtimeCache'
import {
  buildToolDecision,
  buildCompleteTaskDecision,
  buildLoadToolsetsDecision
} from '../testUtils'

describe('Skill file discovery production flow', () => {
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
        description:
          '空目录从真实文件工具创建，自动发现、查询、配置、加载、更新与停用；模型 System 使用实际根目录。',
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
            runtime.storageService.partnerSkills,
            path.join(runtime.workspaceRoot, 'skills')
          )
          const filename = path.join(service.getRootDirectory(), 'report/SKILL.md')
          const markdown = (body: string) =>
            `---\nname: report\ndescription: Reports ${body}\n---\n${body}`
          const decision = (toolName: string, args: JsonObject) =>
            buildToolDecision({ toolName, args, summary: '维护规范' })
          const runner = await createAiServiceTestRunner(runtime, {
            partnerId,
            userSkillService: service,
            userInput: '创建并启用规范，查询后加载，再修改并停用。',
            llmScript: {
              'human.brain': [
                {
                  output: buildLoadToolsetsDecision({
                    toolsetNames: ['skill-management'],
                    summary: '配置规范'
                  })
                },
                {
                  output: decision('text_file_edit', {
                    action: 'create',
                    sourcePath: filename,
                    content: markdown('RULE-ORIGINAL')
                  })
                },
                { output: decision('skill_config', { action: 'list' }) },
                {
                  output: decision('skill_config', {
                    action: 'update',
                    skills: [{ name: 'report', enabled: true }]
                  })
                },
                { output: decision('skill_config', { action: 'list' }) },
                { output: decision('load_skill', { skillNames: ['report'] }) },
                {
                  output: decision('text_file_edit', {
                    action: 'rewrite',
                    sourcePath: filename,
                    content: markdown('RULE-UPDATED')
                  })
                },
                { output: decision('skill_config', { action: 'list' }) },
                {
                  output: decision('skill_config', {
                    action: 'update',
                    skills: [{ name: 'report', enabled: false }]
                  })
                },
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
          let childError = ''
          try {
            await executeToolCall({
              ctx: {
                ...runtime.createAiRunContext({ partnerId, userSkillService: service }),
                isSubagent: true
              },
              cache: createHumanRuntimeCache(),
              taskId: runtime.taskId,
              loadedToolsetIds: ['skill-management'],
              toolCallId: 'child-config',
              toolName: 'skill_config',
              args: { action: 'list' }
            })
          } catch (error) {
            childError = error instanceof Error ? error.message : String(error)
          }
          return {
            status: output.status,
            childError,
            root: service.getRootDirectory(),
            systems: runner.io.map(
              (item) =>
                item.requestWire?.messages
                  .filter((message) => message.role === 'system')
                  .map((message) => message.content)
                  .join('\n') || ''
            ),
            initialTools: JSON.stringify(runner.io[0].requestWire?.tools),
            loadedTools: JSON.stringify(runner.io[1].requestWire?.tools),
            skills: service.list(),
            enabled: service.listEnabled(partnerId),
            events: runner.events
          }
        },
        assert: async (result, runtime) => {
          runtime.assertThat(
            result.status === 'completed' &&
              result.skills.length === 1 &&
              !result.enabled.length &&
              result.childError.includes('子任务不能使用'),
            {
              name: 'real-file-and-config-flow',
              message: '真实文件工具、自动发现与按需配置完成主链，子任务执行层拒绝管理。'
            }
          )
          runtime.assertThat(
            result.systems[0].includes(result.root) &&
              result.systems[0].includes('<本机信息与文件约定>') &&
              !result.systems[0].includes('runtime_paths.') &&
              !result.systems[0].includes('共享 Skill 目录') &&
              !result.systems[5]?.includes('\nRULE-ORIGINAL') &&
              result.systems[6]?.includes('RULE-ORIGINAL') === true &&
              result.systems[7]?.includes('RULE-UPDATED') === true &&
              !result.systems.at(-1)?.includes('RULE-UPDATED'),
            {
              name: 'directory-and-current-instructions',
              message: '空库提供真实根目录与格式，查询不激活，文件变更及停用更新有效说明。'
            }
          )
          runtime.assertThat(
            !result.initialTools.includes('skill_config') &&
              result.loadedTools.includes('skill_config'),
            {
              name: 'on-demand-config-tool',
              message: '初始模型无配置工具，加载 skill-management 后绑定其严格 schema。'
            }
          )
          runtime.assertThat(
            result.events.some(
              (event) =>
                event.type === 'tool_call_result' &&
                event.toolName === 'skill_config' &&
                JSON.stringify(event.result?.data) === '[{"name":"report","enabled":false}]'
            ),
            {
              name: 'discovered-before-configuration',
              message: '文件自动发现且默认未启用，管理工具按需加载。'
            }
          )
        }
      }),
    120_000
  )
})
