import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, it } from 'vitest'
import { terminalSessionManager } from '../../../../../src/main/services/ai/human/tools/terminal/TerminalSessionManager'
import {
  hasLiveLlmConfigInEnv,
  loadLiveLlmConfigFromEnv
} from '../../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { filterAiRunEventsByType, runWithStructuredOutputRetry } from '../testUtils'

type RuntimeProfile = 'node-only' | 'python-only'

const tempDirectories: string[] = []

const createTempDirectory = async (): Promise<string> => {
  const directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-runtime-profile-'))
  tempDirectories.push(directoryPath)
  return directoryPath
}

const writeUnavailableCommand = async (directoryPath: string, commandName: string) => {
  const commandPath = path.join(directoryPath, commandName)
  await fs.writeFile(commandPath, '#!/bin/sh\nexit 127\n', 'utf8')
  await fs.chmod(commandPath, 0o755)
}

const createRuntimeProfilePath = async (profile: RuntimeProfile): Promise<string> => {
  const binPath = await createTempDirectory()
  if (profile === 'node-only') {
    await fs.symlink(process.execPath, path.join(binPath, 'node'))
    await writeUnavailableCommand(binPath, 'python')
    await writeUnavailableCommand(binPath, 'python3')
  } else {
    await writeUnavailableCommand(binPath, 'node')
    await writeUnavailableCommand(binPath, 'nodejs')
    await fs.symlink('/usr/bin/python3', path.join(binPath, 'python'))
    await fs.symlink('/usr/bin/python3', path.join(binPath, 'python3'))
  }
  return `${binPath}:/usr/bin:/bin`
}

const listFiles = async (rootPath: string): Promise<string[]> => {
  const entries = await fs.readdir(rootPath, { withFileTypes: true }).catch(() => [])
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(rootPath, entry.name)
      return entry.isDirectory() ? await listFiles(entryPath) : [entryPath]
    })
  )
  return nested.flat()
}

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directoryPath) => fs.rm(directoryPath, { recursive: true, force: true }))
  )
})

describe.skipIf(process.platform !== 'darwin')('ai human live backend', () => {
  for (const profile of ['node-only', 'python-only'] as const) {
    it(`human-runtime-script-${profile}-live`, async () => {
      await runWithStructuredOutputRetry(async () => {
        await runBackendCase({
          caseId: `human-runtime-script-${profile}-live`,
          harnessMode: 'live',
          domain: 'ai',
          suite: 'human',
          groups: ['live'],
          description: `验证真实模型在 ${profile} 环境中选择可用语言，并遵守 workspace runtime 目录约定。`,
          fixtures: [],
          runMode: 'single',
          runtimeModelName: hasLiveLlmConfigInEnv() ? loadLiveLlmConfigFromEnv().model_name : null,
          execute: async (runtime) => {
            if (!hasLiveLlmConfigInEnv()) {
              return {
                skipped: true,
                output: null,
                events: [],
                scriptFiles: [],
                assetFiles: [],
                assetContents: []
              }
            }

            const previousPath = process.env.PATH
            const sessionId = `human-runtime-script-${profile}-session`
            process.env.PATH = await createRuntimeProfilePath(profile)
            await runtime.seedLlmConfig(loadLiveLlmConfigFromEnv())
            const runner = createHumanTestRunner(runtime, {
              sessionId,
              allowedToolNames: ['terminal_run', 'terminal_read', 'terminal_stop', 'file_edit'],
              humanRuntimeOverrides: { hardActionLimit: 14 }
            })

            try {
              const output = await runner.run({
                taskId: runtime.taskId,
                userInput:
                  '请先检查本机 Node.js 和 Python 环境，然后选择当前可用的一种语言，编写并真实执行一个临时脚本。脚本必须生成一个仅用于本次验证的临时 JSON 文件，内容包含标记 NCURATOR_RUNTIME_PROFILE_OK。完成后核对文件内容并告诉我使用了哪种语言。'
              })
              const scriptsRoot = path.join(
                runtime.workspaceRoot,
                '.ncurator',
                'runtime',
                'scripts'
              )
              const assetsRoot = path.join(runtime.workspaceRoot, '.ncurator', 'runtime', 'assets')
              const scriptFiles = await listFiles(scriptsRoot)
              const assetFiles = await listFiles(assetsRoot)
              const assetContents = await Promise.all(
                assetFiles
                  .filter((filePath) => filePath.endsWith('.json'))
                  .map((filePath) => fs.readFile(filePath, 'utf8').catch(() => ''))
              )
              return {
                skipped: false,
                output,
                events: runtime.eventCollector.snapshot(),
                scriptFiles,
                assetFiles,
                assetContents
              }
            } finally {
              process.env.PATH = previousPath
              await terminalSessionManager.closeByChatSession(sessionId)
            }
          },
          assert: async (result, runtime) => {
            if (result.skipped) {
              runtime.assertThat(true, {
                name: 'live-config-not-provided',
                message: '未提供 live 模型配置，已跳过 runtime script live case。'
              })
              return
            }

            const commands = filterAiRunEventsByType(result.events, 'tool_call_started')
              .filter((event) => event.toolName === 'terminal_run')
              .map((event) => event.input.command)
              .filter((command): command is string => typeof command === 'string')
            const relativeScriptFiles = result.scriptFiles.map((filePath) =>
              path.relative(runtime.workspaceRoot, filePath)
            )
            const expectedExtension = profile === 'node-only' ? /\.(?:js|mjs|cjs)$/u : /\.py$/u
            const unexpectedExtension = /\.(?:sh|zsh|ps1)$/u

            runtime.assertThat(
              result.output?.status === 'completed' &&
                commands.some((command) => /node(?:js)?\b/iu.test(command)) &&
                commands.some((command) => /python(?:3)?\b/iu.test(command)) &&
                relativeScriptFiles.some((filePath) => expectedExtension.test(filePath)) &&
                relativeScriptFiles.every((filePath) => !unexpectedExtension.test(filePath)),
              {
                name: `human-live-selects-${profile}-runtime`,
                message: `live human 应先检查 Node.js/Python，并在 ${profile} 环境中生成对应语言脚本。`,
                data: {
                  commands,
                  relativeScriptFiles,
                  status: result.output?.status
                }
              }
            )

            runtime.assertThat(
              result.assetFiles.length > 0 &&
                result.assetContents.some((content) =>
                  content.includes('NCURATOR_RUNTIME_PROFILE_OK')
                ),
              {
                name: 'human-live-writes-script-result-under-runtime-assets',
                message: '临时脚本运行结果应写入 workspace 的 runtime assets 目录。',
                data: {
                  assetFiles: result.assetFiles.map((filePath) =>
                    path.relative(runtime.workspaceRoot, filePath)
                  ),
                  assetContents: result.assetContents
                }
              }
            )
          }
        })
      })
    }, 240_000)
  }
})
