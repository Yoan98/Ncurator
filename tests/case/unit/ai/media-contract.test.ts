import { describe, it, expect } from 'vitest'
import {
  emptyRecipe,
  remapRecipe,
  recipeDuration
} from '../../../../src/main/services/media/video/recipe'
import { snapVideoTime } from '../../../../src/shared/videoFeedback'
import { DRAWING_SYSTEM_PREFIX } from '../../../../src/main/services/media/engine/protocol'
import { buildBrainSystemPrompt } from '../../../../src/main/services/ai/human/prompts/brain'
import { videoFeedbackUserMessage } from '../../../../src/main/services/ai/human/memory/videoFeedback'
import type { AiRunContext } from '../../../../src/main/services/ai/types'
import type { VideoFeedbackNode } from '../../../../src/shared/types'

describe('media timeline and context invariants', () => {
  it('snaps only within both limits and releases immediately or with Alt', () => {
    expect(snapVideoTime(10.5, [10], 100, 1000)).toBe(10)
    expect(snapVideoTime(11, [10], 100, 1000)).toBe(11)
    expect(snapVideoTime(12.1, [10], 1000, 100)).toBe(12.1)
    expect(snapVideoTime(10.5, [10], 100, 1000, true)).toBe(10.5)
  })
  it('remaps linked content while preserving timeline audio and muted repeats', () => {
    const recipe = emptyRecipe({ width: 320, height: 180, fps: '10' })
    recipe.clips = [
      {
        id: 'clip',
        path: '/original.mp4',
        sourceStart: 2,
        duration: 4,
        rate: 1,
        includeAudio: true,
        preservePitch: true,
        fit: 'contain'
      }
    ]
    recipe.captions = [{ id: 'caption', text: '出发', range: { startSeconds: 0, endSeconds: 4 } }]
    recipe.audio = [
      {
        id: 'linked',
        path: '/voice.wav',
        range: { startSeconds: 0, endSeconds: 4 },
        binding: 'content',
        fadeInSeconds: 1,
        envelope: [
          { atSeconds: 0, gainDb: -6 },
          { atSeconds: 4, gainDb: 0 }
        ]
      },
      {
        id: 'music',
        path: '/music.wav',
        range: { startSeconds: 0, endSeconds: 4 },
        binding: 'timeline'
      }
    ]
    const speed = remapRecipe(recipe, [{ start: 0, end: 4, rate: 2 }])
    expect(recipeDuration(speed)).toBe(2)
    expect(speed.captions[0].range.endSeconds).toBe(2)
    expect(speed.audio.find((item) => item.id === 'linked')).toMatchObject({
      rate: 2,
      range: { startSeconds: 0, endSeconds: 2 }
    })
    expect(speed.audio.find((item) => item.id === 'music')?.range.endSeconds).toBe(4)
    const repeat = remapRecipe(recipe, [
      { start: 0, end: 4, rate: 1 },
      { start: 0, end: 4, rate: 1, audio: false }
    ])
    expect(repeat.clips[1].includeAudio).toBe(false)
    expect(repeat.audio.filter((item) => item.id === 'linked')).toHaveLength(1)
    expect(recipe.clips[0].sourceStart).toBe(2)
    expect(speed.audio.find((item) => item.id === 'linked')?.automation?.fade).toMatchObject({
      offset: 0,
      rate: 2,
      duration: 4
    })
    const cropped = remapRecipe(speed, [{ start: 0.5, end: 1.5, rate: 1 }])
    expect(cropped.audio.find((item) => item.id === 'linked')?.automation?.envelope).toMatchObject({
      offset: 1,
      rate: 2
    })
  })
  it('keeps one fixed drawing prefix through rebuilt System prompts', () => {
    const ctx = {
      platform: 'macos',
      partnerId: 'p',
      partnerName: '测试',
      workspaceRoots: [],
      agentProfile: 'drawing',
      preference: 'default',
      executionPermission: 'review',
      referenceScope: { selectedReferences: [], attachments: [] }
    } as AiRunContext
    const initial = buildBrainSystemPrompt({ ctx }),
      rebuilt = buildBrainSystemPrompt({ ctx: { ...ctx, runId: 'resume' } })
    expect(initial.startsWith(DRAWING_SYSTEM_PREFIX)).toBe(true)
    expect(initial.split(DRAWING_SYSTEM_PREFIX)).toHaveLength(2)
    expect(rebuilt).toBe(initial)
    expect(buildBrainSystemPrompt({ ctx: { ...ctx, agentProfile: undefined } })).not.toContain(
      DRAWING_SYSTEM_PREFIX
    )
  })
  it('projects screenshot references into the actual user multimodal message', () => {
    const node = {
      kind: 'video_feedback',
      id: 'frame',
      filePath: '/video.mp4',
      version: 'v1',
      timeSeconds: 1,
      screenshotPath: '/frame.png',
      screenshotSize: { width: 320, height: 180, sizeBytes: 500 },
      annotations: [{ number: 1, kind: 'rectangle', text: '提亮' }],
      geometry: [{ number: 1, kind: 'rectangle', x1: 0, y1: 0, x2: 1, y2: 1 }]
    } satisfies VideoFeedbackNode
    const message = videoFeedbackUserMessage('修改画面', [node, node])
    expect(Array.isArray(message.content)).toBe(true)
    expect(message.content).toHaveLength(2)
    expect(JSON.stringify(message.content)).not.toContain('x1')
  })
})
