import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../../../../src/shared/types'
import { formatPreviousTurns } from '../../../../src/main/services/ai/utils/runContext'

const message = (input: {
  id: string
  role: ChatMessage['role']
  content: string
  artifacts?: ChatMessage['artifacts']
}): ChatMessage => ({
  id: input.id,
  session_id: 'session-1',
  role: input.role,
  content: input.content,
  timestamp: 1,
  artifacts: input.artifacts
})

describe('ai run context conversation history', () => {
  it('excludes the current run messages and their projected artifacts', () => {
    const recentTurnsText = formatPreviousTurns({
      messages: [
        message({ id: 'current-user', role: 'user', content: '创建贪吃蛇游戏' }),
        message({
          id: 'current-assistant',
          role: 'assistant',
          content: '',
          artifacts: [
            {
              kind: 'file',
              path: '/workspace/snake.html',
              fileName: 'snake.html',
              summary: 'text file created: snake.html'
            }
          ]
        })
      ],
      currentUserMessageId: 'current-user',
      currentAssistantMessageId: 'current-assistant'
    })

    expect(recentTurnsText).toBe('')
  })

  it('keeps completed messages and artifacts from previous runs', () => {
    const recentTurnsText = formatPreviousTurns({
      messages: [
        message({ id: 'previous-user', role: 'user', content: '创建贪吃蛇游戏' }),
        message({
          id: 'previous-assistant',
          role: 'assistant',
          content: '游戏已经创建完成。',
          artifacts: [
            {
              kind: 'file',
              path: '/workspace/snake.html',
              fileName: 'snake.html',
              summary: 'text file created: snake.html'
            }
          ]
        }),
        message({ id: 'current-user', role: 'user', content: '增加暂停功能' }),
        message({ id: 'current-assistant', role: 'assistant', content: '' })
      ],
      currentUserMessageId: 'current-user',
      currentAssistantMessageId: 'current-assistant'
    })

    expect(JSON.parse(recentTurnsText)).toEqual([
      {
        turn_index: 1,
        user_message: '创建贪吃蛇游戏',
        assistant_message: '游戏已经创建完成。',
        artifacts: [
          {
            kind: 'file',
            path: '/workspace/snake.html',
            fileName: 'snake.html',
            summary: 'text file created: snake.html'
          }
        ]
      }
    ])
  })

  it('keeps previous interrupted turns while excluding only the current run placeholders', () => {
    const recentTurnsText = formatPreviousTurns({
      messages: [
        message({ id: 'interrupted-user', role: 'user', content: '整理材料 A' }),
        message({
          id: 'interrupted-assistant',
          role: 'assistant',
          content: '**[失败]** 无法连接模型服务，请检查网络后重试。'
        }),
        message({ id: 'current-user', role: 'user', content: '补充材料 B 后继续整理' }),
        message({ id: 'current-assistant', role: 'assistant', content: '' })
      ],
      currentUserMessageId: 'current-user',
      currentAssistantMessageId: 'current-assistant'
    })

    expect(JSON.parse(recentTurnsText)).toEqual([
      {
        turn_index: 1,
        user_message: '整理材料 A',
        assistant_message: '**[失败]** 无法连接模型服务，请检查网络后重试。',
        artifacts: []
      }
    ])
  })

  it('separates multiple completed user and assistant turns', () => {
    const recentTurnsText = formatPreviousTurns({
      messages: [
        message({ id: 'user-1', role: 'user', content: '第一轮问题' }),
        message({ id: 'assistant-1', role: 'assistant', content: '第一轮回答\n包含 Markdown。' }),
        message({ id: 'user-2', role: 'user', content: '第二轮问题' }),
        message({ id: 'assistant-2', role: 'assistant', content: '第二轮回答' }),
        message({ id: 'current-user', role: 'user', content: '当前问题' }),
        message({ id: 'current-assistant', role: 'assistant', content: '' })
      ],
      currentUserMessageId: 'current-user',
      currentAssistantMessageId: 'current-assistant'
    })

    expect(JSON.parse(recentTurnsText)).toEqual([
      {
        turn_index: 1,
        user_message: '第一轮问题',
        assistant_message: '第一轮回答\n包含 Markdown。',
        artifacts: []
      },
      {
        turn_index: 2,
        user_message: '第二轮问题',
        assistant_message: '第二轮回答',
        artifacts: []
      }
    ])
  })
})
