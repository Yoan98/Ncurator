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

    expect(recentTurnsText).toContain('user: 创建贪吃蛇游戏')
    expect(recentTurnsText).toContain('assistant: 游戏已经创建完成。')
    expect(recentTurnsText).toContain('fileName=snake.html')
    expect(recentTurnsText).not.toContain('增加暂停功能')
  })
})
