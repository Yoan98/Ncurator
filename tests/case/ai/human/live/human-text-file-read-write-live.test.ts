import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { filterAiRunEventsByType, runWithStructuredOutputRetry } from '../testUtils'

const hashFile = async (filePath: string): Promise<string> =>
  createHash('sha256').update(await fs.readFile(filePath)).digest('hex')

const seedCheckoutConfig = async (filePath: string): Promise<void> => {
  await fs.writeFile(
    filePath,
    [
      "export const primaryEndpoint = 'OLD_API_URL'",
      "export const fallbackEndpoint = 'OLD_API_URL'",
      'export const timeoutMs = 1000',
      'export const retryCount = 2',
      "export const telemetryChannel = 'checkout-prod'",
      ''
    ].join('\n'),
    'utf8'
  )
}

describe('ai human live text-file backend', () => {
  it('human-text-file-read-checkout-readiness-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-text-file-read-checkout-readiness-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description: 'Reads a checkout configuration and reports deployment readiness without modifying it.',
        fixtures: [],
        runMode: 'single',
        execute: async (runtime) => {
          const sourcePath = path.join(runtime.workspaceRoot, 'checkout-config.ts')
          await seedCheckoutConfig(sourcePath)
          const beforeHash = await hashFile(sourcePath)
          const output = await createHumanTestRunner(runtime, {
          }).run({
            taskId: runtime.taskId,
            userInput:
              'Before the checkout cutover, review checkout-config.ts and tell me whether the primary and fallback endpoints, timeout, retry count, and telemetry setting are ready. Do not modify the file.'
          })
          return {
            output,
            beforeHash,
            afterHash: await hashFile(sourcePath),
            events: runtime.eventCollector.snapshot()
          }
        },
        assert: async (result, runtime) => {
          const toolNames = filterAiRunEventsByType(result.events, 'tool_call_started').map(
            (event) => event.toolName
          )
          runtime.assertThat(
            result.output.status === 'completed' &&
              toolNames.includes('text_file_read') &&
              !toolNames.includes('text_file_edit') &&
              result.beforeHash === result.afterHash,
            {
              name: 'human-live-text-file-read-is-read-only',
              message: 'The live model must inspect the configuration without changing it.',
              data: { toolNames }
            }
          )
        }
      })
    })
  })

  it('human-text-file-write-checkout-cutover-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-text-file-write-checkout-cutover-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description: 'Makes a clearly specified checkout endpoint cutover while preserving unrelated configuration.',
        fixtures: [],
        runMode: 'single',
        execute: async (runtime) => {
          const sourcePath = path.join(runtime.workspaceRoot, 'checkout-config.ts')
          await seedCheckoutConfig(sourcePath)
          const output = await createHumanTestRunner(runtime, {
          }).run({
            taskId: runtime.taskId,
            userInput:
              'Perform the checkout endpoint cutover in checkout-config.ts: replace both OLD_API_URL values with API_BASE_URL, change timeoutMs to 3000, and leave retryCount and telemetryChannel unchanged. Verify the file after editing.'
          })
          return {
            output,
            finalContent: await fs.readFile(sourcePath, 'utf8'),
            events: runtime.eventCollector.snapshot()
          }
        },
        assert: async (result, runtime) => {
          const toolNames = filterAiRunEventsByType(result.events, 'tool_call_started').map(
            (event) => event.toolName
          )
          runtime.assertThat(
            result.output.status === 'completed' &&
              toolNames.includes('text_file_read') &&
              toolNames.includes('text_file_edit') &&
              !result.finalContent.includes('OLD_API_URL') &&
              result.finalContent.includes("primaryEndpoint = 'API_BASE_URL'") &&
              result.finalContent.includes("fallbackEndpoint = 'API_BASE_URL'") &&
              result.finalContent.includes('timeoutMs = 3000') &&
              result.finalContent.includes('retryCount = 2') &&
              result.finalContent.includes("telemetryChannel = 'checkout-prod'"),
            {
              name: 'human-live-text-file-write-is-scoped-and-complete',
              message: 'The live model must complete the explicit cutover without changing unrelated configuration.',
              data: { toolNames, finalContent: result.finalContent }
            }
          )
        }
      })
    })
  })
})
