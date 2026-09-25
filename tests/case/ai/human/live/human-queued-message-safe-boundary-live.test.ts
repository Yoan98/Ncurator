import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import type { BaseMessage } from '@langchain/core/messages'
import type { AiRunDeps } from '../../../../../src/main/services/ai/types'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { filterAiRunEventsByType, runWithStructuredOutputRetry } from '../testUtils'

const CASE_ID = 'human-queued-message-safe-boundary-live'
const FIRST_INPUT =
  '请查阅当前工作区中的 handoff-live-note.txt，记住文件中的校验词，并简要告诉我它是什么。'
const FOLLOW_UP_INPUT = '继续处理，并说明这个校验词在文件里对应什么内容。'
const LIVE_MARKER = `HANDOFF_LIVE_${Date.now()}`

describe('ai human live backend', () => {
  it(CASE_ID, async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: CASE_ID,
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description:
          '真实模型执行文件读取期间收到追加消息，验证工具结果持久化后让出，再按原文和追加消息顺序续接。',
        fixtures: [],
        runMode: 'single',
        execute: async (runtime) => {
          const sourcePath = path.join(runtime.workspaceRoot, 'handoff-live-note.txt')
          await fs.writeFile(
            sourcePath,
            `校验词：${LIVE_MARKER}\n用途：检查运行中追加消息的安全交接。\n`,
            'utf8'
          )
          let queuedDuringRead = false
          const firstRunner = createHumanTestRunner(runtime, {
            partnerId: `${CASE_ID}-partner`,
            runId: `${runtime.runId}-first`,
            hasPendingUserMessages: () => queuedDuringRead,
            observeEvent: (event) => {
              if (event.type === 'tool_call_started' && event.toolName === 'text_file_read') {
                queuedDuringRead = true
              }
            }
          })
          const firstOutput = await firstRunner.run({
            taskId: `${runtime.taskId}-first`,
            userInput: FIRST_INPUT
          })
          const firstLog = await firstRunner.ctx.loadMessageLog()
          const firstEvents = runtime.eventCollector.snapshot()

          let secondBrainMessages: BaseMessage[] | null = null
          const captureSecondBrain: NonNullable<AiRunDeps['chatToolsWrapper']> =
            (realChatTools) => async (request) => {
              if (request.caller === 'human.brain' && !secondBrainMessages) {
                secondBrainMessages = [...request.messages]
              }
              return await realChatTools(request)
            }
          const secondRunner = createHumanTestRunner(runtime, {
            partnerId: `${CASE_ID}-partner`,
            runId: `${runtime.runId}-second`,
            chatToolsWrapper: captureSecondBrain
          })
          const secondOutput = await secondRunner.run({
            taskId: `${runtime.taskId}-second`,
            userInput: FOLLOW_UP_INPUT
          })
          const firstToolLog = firstLog.find(
            (record) =>
              record.entry.kind === 'tool' &&
              record.entry.toolName === 'text_file_read' &&
              record.entry.content.includes(LIVE_MARKER)
          )
          const secondToolResultIndex = secondBrainMessages?.findIndex(
            (message) => message.getType() === 'tool'
          )
          const appendedUserIndex = secondBrainMessages?.findIndex(
            (message, index) =>
              index > (secondToolResultIndex ?? -1) &&
              message.getType() === 'human' &&
              typeof message.content === 'string' &&
              message.content.includes(FOLLOW_UP_INPUT)
          )
          const hasPriorMarker = (secondBrainMessages || []).some(
            (message) =>
              typeof message.content === 'string' && message.content.includes(LIVE_MARKER)
          )

          return {
            firstOutput,
            secondOutput,
            queuedDuringRead,
            firstEvents,
            toolNames: filterAiRunEventsByType(firstEvents, 'tool_call_started').map(
              (event) => event.toolName
            ),
            firstToolLog: firstToolLog?.entry,
            secondToolResultIndex,
            appendedUserIndex,
            hasPriorMarker,
            finalAnswer: secondOutput.deliveryMarkdown
          }
        },
        assert: async (result, runtime) => {
          runtime.assertThat(
            result.queuedDuringRead &&
              result.firstOutput.status === 'yielded' &&
              result.toolNames.includes('text_file_read') &&
              result.firstToolLog?.kind === 'tool' &&
              result.firstToolLog.content.includes(LIVE_MARKER) &&
              result.secondOutput.status === 'completed' &&
              result.secondToolResultIndex !== undefined &&
              result.appendedUserIndex !== undefined &&
              result.secondToolResultIndex < result.appendedUserIndex &&
              result.hasPriorMarker,
            {
              name: 'live-queued-message-resumes-after-file-result',
              message:
                '真实模型的工具结果必须先进入 transcript；续接时原工具结果与追加用户消息保持顺序。',
              data: {
                firstOutput: result.firstOutput,
                secondOutput: result.secondOutput,
                queuedDuringRead: result.queuedDuringRead,
                toolNames: result.toolNames,
                firstToolLog: result.firstToolLog,
                secondToolResultIndex: result.secondToolResultIndex,
                appendedUserIndex: result.appendedUserIndex,
                hasPriorMarker: result.hasPriorMarker,
                finalAnswer: result.finalAnswer
              }
            }
          )
        }
      })
    })
  })
})
