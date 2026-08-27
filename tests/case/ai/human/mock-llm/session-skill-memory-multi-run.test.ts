import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { buildCompleteTaskDecision, buildLearnSkillsDecision } from '../testUtils'

const SESSION_ID = 'session-skill-memory-multi-run'

describe('ai human mock-llm backend', () => {
  it('session-skill-memory-multi-run', async () => {
    await runBackendCase({
      caseId: 'session-skill-memory-multi-run',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description:
        '验证同一会话跨 run 共享技能，并在加载拆分后的 DOCX 技能时按 FIFO 保持 30 工具上限。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const run1 = createHumanTestRunner(runtime, {
          sessionId: SESSION_ID,
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['docx-read', 'pdf-read'],
                  summary: '学习 Word 和 PDF 阅读技能。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '第一轮完成。',
                  deliveryMarkdown: '第一轮完成。'
                })
              }
            ]
          }
        })
        await run1.run({ taskId: 'session-skills-run-1', userInput: '学习文档技能。' })
        const stateAfterRun1 = await runtime.chatStore.getSessionSkillState(SESSION_ID)

        let run2Prompt = ''
        const run2 = createHumanTestRunner(runtime, {
          sessionId: SESSION_ID,
          structuredOutputScript: {
            'human.brain': [
              ({ user }) => {
                run2Prompt = user
                return buildLearnSkillsDecision({
                  skillIds: ['excel-write'],
                  summary: '补充 Excel 编辑技能。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '第二轮完成。',
                  deliveryMarkdown: '第二轮完成。'
                })
              }
            ]
          }
        })
        await run2.run({ taskId: 'session-skills-run-2', userInput: '继续使用会话技能。' })

        const run3 = createHumanTestRunner(runtime, {
          sessionId: SESSION_ID,
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['ppt-read', 'ppt-write'],
                  summary: '学习 PPT 阅读和编辑技能。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '第三轮完成。',
                  deliveryMarkdown: '第三轮完成。'
                })
              }
            ]
          }
        })
        await run3.run({ taskId: 'session-skills-run-3', userInput: '继续学习 PPT 技能。' })
        const stateAtLimit = await runtime.chatStore.getSessionSkillState(SESSION_ID)

        let run4Prompt = ''
        const run4 = createHumanTestRunner(runtime, {
          sessionId: SESSION_ID,
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildLearnSkillsDecision({
                  skillIds: [
                    'excel-read',
                    'image-recognition',
                    'image-generation',
                    'docx-write',
                    'docx-format',
                    'docx-rich-write'
                  ],
                  summary: '补充 Excel 阅读与图片、拆分后的 Word 编辑技能并检查 FIFO 遗忘结果。'
                })
              },
              ({ user }) => {
                run4Prompt = user
                return buildCompleteTaskDecision({
                  summary: '第四轮完成。',
                  deliveryMarkdown: '第四轮完成。'
                })
              }
            ]
          }
        })
        await run4.run({ taskId: 'session-skills-run-4', userInput: '检查遗忘结果。' })
        const stateAfterEviction = await runtime.chatStore.getSessionSkillState(SESSION_ID)

        return { stateAfterRun1, stateAtLimit, stateAfterEviction, run2Prompt, run4Prompt }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.stateAfterRun1.learnedSkillIds.join(',') === 'docx-read,pdf-read' &&
            result.run2Prompt.includes('<learned_skills>') &&
            result.stateAtLimit.learnedSkillIds.join(',') ===
              'docx-read,pdf-read,excel-write,ppt-read,ppt-write' &&
            result.stateAfterEviction.learnedSkillIds.join(',') ===
              'excel-write,ppt-read,ppt-write,excel-read,image-recognition,image-generation,docx-write,docx-format,docx-rich-write' &&
            result.run4Prompt.includes('<learned_skills>'),
          {
            name: 'session-skills-persist-across-runs-within-tool-budget',
            message:
              '同一会话应跨 run 共享技能，并在加载拆分后的 DOCX 技能后按 FIFO 淘汰最早技能。',
            data: result
          }
        )
      }
    })
  })
})
