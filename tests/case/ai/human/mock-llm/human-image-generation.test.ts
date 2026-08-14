import fs from 'node:fs/promises'
import path from 'node:path'
import { loadImage } from '@napi-rs/canvas'
import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  buildCompleteTaskDecision,
  buildLearnSkillsDecision,
  buildToolDecision,
  filterAiRunEventsByType
} from '../testUtils'

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="#168aad" /></svg>'

describe('ai human mock-llm image generation backend', () => {
  it('human-image-generation', async () => {
    await runBackendCase({
      caseId: 'human-image-generation',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证 human 学习图片生成技能，通过真实工具生成图片并完成交付。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const outputPath = path.join(runtime.workspaceRoot, 'human-generated.png')
        const runner = createHumanTestRunner(runtime, {
          allowedToolNames: ['image_generate'],
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['image-generation'],
                  summary: '学习图片生成能力'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'image_generate',
                  args: { outputPath, svg: SVG },
                  summary: '生成目标图片'
                })
              },
              { output: buildCompleteTaskDecision({ summary: '图片已生成。' }) }
            ],
            'human.mouth': [
              {
                output: {
                  summary: '图片已生成。',
                  deliveryMarkdown: '图片已生成：human-generated.png'
                }
              }
            ]
          }
        })
        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请生成一张 40x30 的蓝色图片 human-generated.png。'
        })
        const bytes = await fs.readFile(outputPath)
        const image = await loadImage(bytes)
        return {
          output,
          events: runtime.eventCollector.snapshot(),
          signature: bytes.subarray(0, 8).toString('hex'),
          width: image.width,
          height: image.height
        }
      },
      assert: async (result, runtime) => {
        const steps = filterAiRunEventsByType(result.events, 'human_step')
        const stages = new Set(steps.map((event) => event.stage))
        const starts = filterAiRunEventsByType(result.events, 'tool_call_started')
        const artifacts = filterAiRunEventsByType(result.events, 'file_artifact')
        runtime.assertThat(
          result.output.status === 'completed' &&
            stages.has('human_learning') &&
            stages.has('human_hand') &&
            stages.has('human_mouth') &&
            starts.filter((event) => event.toolName === 'image_generate').length === 1 &&
            artifacts.some(
              (event) =>
                event.capability === 'image' &&
                event.fileName === 'human-generated.png' &&
                Boolean(event.applyId)
            ) &&
            result.signature === '89504e470d0a1a0a' &&
            result.width === 40 &&
            result.height === 30 &&
            result.output.deliveryMarkdown.includes('human-generated.png'),
          {
            name: 'human-image-generation-production-chain',
            message: 'human 应真实走通图片技能学习、生成、Artifact 和最终交付。',
            data: { stages: [...stages], starts, artifacts }
          }
        )
      }
    })
  })
})
