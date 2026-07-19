import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, it } from 'vitest'
import { getUserRuntimeDir } from '../../../../../src/main/services/assets/WorkspaceAssetService'
import { terminalSessionManager } from '../../../../../src/main/services/ai/human/tools/terminal/TerminalSessionManager'
import {
  hasLiveLlmConfigInEnv,
  loadLiveLlmConfigFromEnv
} from '../../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { filterAiRunEventsByType, runWithStructuredOutputRetry } from '../testUtils'

const INLINE_RESULT = '338350'
const SCRIPT_MARKER = 'NCURATOR_RUNTIME_SCRIPT_OK'
const NODE_DOWNLOAD_MARKER = 'NCURATOR_DOWNLOADED_NODE_OK'
const PYTHON_DOWNLOAD_MARKER = '271828'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

const cleanupDirectories = new Set<string>()
const IS_WINDOWS = process.platform === 'win32'
const SUPPORTED_PLATFORMS = new Set<NodeJS.Platform>(['darwin', 'win32'])

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

const writeUnavailableCommand = async (directoryPath: string, commandName: string) => {
  const commandPath = path.join(directoryPath, IS_WINDOWS ? `${commandName}.cmd` : commandName)
  await fs.writeFile(
    commandPath,
    IS_WINDOWS ? '@echo off\r\nexit /b 127\r\n' : '#!/bin/sh\nexit 127\n',
    'utf8'
  )
  if (!IS_WINDOWS) await fs.chmod(commandPath, 0o755)
}

const createMissingRuntimePath = async (commandNames: readonly string[]): Promise<string> => {
  const binPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-missing-runtime-'))
  cleanupDirectories.add(binPath)
  await Promise.all(
    commandNames.map((commandName) => writeUnavailableCommand(binPath, commandName))
  )
  const systemPaths = IS_WINDOWS
    ? [process.env.SystemRoot, path.join(process.env.SystemRoot || 'C:\\Windows', 'System32')]
    : ['/usr/bin', '/bin', '/usr/sbin', '/sbin']
  return [binPath, ...systemPaths.filter(Boolean)].join(path.delimiter)
}

const createUserRuntimeTestDirectory = (): string => {
  const directoryPath = path.join(getUserRuntimeDir(), randomUUID())
  cleanupDirectories.add(directoryPath)
  return directoryPath
}

const isRuntimeInstallationArtifact = (filePath: string): boolean => {
  const fileName = path.basename(filePath)
  return (
    /\.(?:dmg|pkg|tar|tar\.gz|tgz|txz|xz|zip)$/iu.test(fileName) ||
    /^node(?:\.exe)?$/iu.test(fileName) ||
    /^python(?:3(?:\.\d+)*)?(?:\.exe)?$/iu.test(fileName)
  )
}

const collectTerminalCommands = (events: Parameters<typeof filterAiRunEventsByType>[0]): string[] =>
  filterAiRunEventsByType(events, 'tool_call_started')
    .filter((event) => event.toolName === 'terminal_run')
    .map((event) => event.input.command)
    .filter((command): command is string => typeof command === 'string')

const collectTerminalResultText = (events: Parameters<typeof filterAiRunEventsByType>[0]): string =>
  JSON.stringify(
    filterAiRunEventsByType(events, 'tool_call_result')
      .filter((event) => event.toolName === 'terminal_run')
      .map((event) => event.result?.data)
  )

const buildRuntimeDownloadGuidance = (
  runtimeName: 'node' | 'python',
  installDirectory: string
): string => {
  if (!IS_WINDOWS && runtimeName === 'node') return ''
  if (!IS_WINDOWS) {
    return `为避免下载源不可达，请从 https://ghfast.top/https://github.com/mmomtchev/python-xpack/releases/download/v3.12.11-2/python-xpack-3.12.11-2-darwin-arm64.tar.gz 下载预编译的独立 Python 压缩包到 ${installDirectory}/downloads/python.tar.gz，然后解压到 ${installDirectory}/python，压缩包的顶层目录需要去掉一层。解压后的 Python 可执行文件位于 ${installDirectory}/python/.content/python。请始终复用同一个终端；下载返回 running 时只需继续读取并等待它自然完成，不要停止或重复执行。`
  }

  if (runtimeName === 'node') {
    return `请下载 Windows x64 免安装包 https://nodejs.org/dist/v22.12.0/node-v22.12.0-win-x64.zip 到 ${path.join(installDirectory, 'downloads', 'node.zip')}，使用 PowerShell Expand-Archive 解压到 ${path.join(installDirectory, 'node')}，然后运行解压目录中的 node.exe。下载返回 running 时只需继续读取并等待它自然完成，不要停止或重复执行。`
  }
  return `请下载 Windows x64 embeddable 包 https://www.python.org/ftp/python/3.12.11/python-3.12.11-embed-amd64.zip 到 ${path.join(installDirectory, 'downloads', 'python.zip')}，使用 PowerShell Expand-Archive 解压到 ${path.join(installDirectory, 'python')}，然后运行 ${path.join(installDirectory, 'python', 'python.exe')}。下载返回 running 时只需继续读取并等待它自然完成，不要停止或重复执行。`
}

const normalizeCommandPath = (value: string): string => value.replace(/\\/g, '/').toLowerCase()

afterEach(async () => {
  const directories = [...cleanupDirectories]
  cleanupDirectories.clear()
  await Promise.all(
    directories.map((directoryPath) => fs.rm(directoryPath, { recursive: true, force: true }))
  )
})

describe.skipIf(!SUPPORTED_PLATFORMS.has(process.platform))('ai human live backend', () => {
  it('human-runtime-inline-code-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-runtime-inline-code-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description: '验证真实模型在一次性计算场景中使用内联代码，不生成脚本或中间文件。',
        fixtures: [],
        runMode: 'single',
        runtimeModelName: hasLiveLlmConfigInEnv() ? loadLiveLlmConfigFromEnv().model_name : null,
        execute: async (runtime) => {
          if (!hasLiveLlmConfigInEnv()) {
            return { skipped: true, output: null, events: [], scriptFiles: [] }
          }

          await runtime.seedLlmConfig(loadLiveLlmConfigFromEnv())
          const sessionId = 'human-runtime-inline-code-live-session'
          const runner = createHumanTestRunner(runtime, {
            sessionId,
            allowedToolNames: ['terminal_run', 'terminal_read', 'terminal_stop'],
            humanRuntimeOverrides: { hardActionLimit: 10 }
          })
          try {
            const output = await runner.run({
              taskId: runtime.taskId,
              userInput:
                '请使用 Node.js 或 Python 真实运行一次性代码，计算 1 到 100 每个整数平方的总和。这次不需要保存脚本或生成中间文件，请让程序只输出计算结果，然后核对结果。'
            })
            return {
              skipped: false,
              output,
              events: runtime.eventCollector.snapshot(),
              scriptFiles: await listFiles(
                path.join(runtime.workspaceRoot, '.ncurator', 'runtime', 'scripts')
              )
            }
          } finally {
            await terminalSessionManager.closeByChatSession(sessionId)
          }
        },
        assert: async (result, runtime) => {
          if (result.skipped) {
            runtime.assertThat(true, {
              name: 'live-config-not-provided',
              message: '未提供 live 模型配置，已跳过 runtime inline live case。'
            })
            return
          }

          const commands = collectTerminalCommands(result.events)
          const resultText = collectTerminalResultText(result.events)
          runtime.assertThat(
            result.output?.status === 'completed' &&
              commands.some((command) =>
                /(?:node\s+-e|python(?:3)?\s+-c)(?:\s|$)/iu.test(command)
              ) &&
              resultText.includes(INLINE_RESULT) &&
              result.scriptFiles.length === 0,
            {
              name: 'human-live-uses-inline-code-for-one-off-calculation',
              message: 'live human 应用内联代码完成一次性计算，不生成脚本文件。',
              data: { commands, resultText, scriptFiles: result.scriptFiles }
            }
          )
        }
      })
    })
  }, 240_000)

  it('human-runtime-script-assets-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-runtime-script-assets-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description:
          '验证真实模型可使用 runtime scripts 执行临时脚本，并将临时产物放入 UUID assets 目录。',
        fixtures: [],
        runMode: 'single',
        runtimeModelName: hasLiveLlmConfigInEnv() ? loadLiveLlmConfigFromEnv().model_name : null,
        execute: async (runtime) => {
          if (!hasLiveLlmConfigInEnv()) {
            return { skipped: true, output: null, events: [], scriptFiles: [], assetFiles: [] }
          }

          await runtime.seedLlmConfig(loadLiveLlmConfigFromEnv())
          const sessionId = 'human-runtime-script-assets-live-session'
          const runner = createHumanTestRunner(runtime, {
            sessionId,
            allowedToolNames: ['terminal_run', 'terminal_read', 'terminal_stop', 'text_file_edit'],
            humanRuntimeOverrides: { hardActionLimit: 14 }
          })
          try {
            const output = await runner.run({
              taskId: runtime.taskId,
              userInput: `请编写并真实执行一个本次任务使用的临时 Node.js 或 Python 脚本。这个脚本和它生成的 JSON 都不是正式交付文件，不要放在工作区普通目录：脚本请使用系统提供的临时脚本目录，JSON 请使用系统提供的临时资源目录及其 UUID 子目录。JSON 内容要包含标记 ${SCRIPT_MARKER}。完成后请读回核对 JSON 内容。`
            })
            const scriptsRoot = path.join(runtime.workspaceRoot, '.ncurator', 'runtime', 'scripts')
            const assetsRoot = path.join(runtime.workspaceRoot, '.ncurator', 'runtime', 'assets')
            const assetFiles = await listFiles(assetsRoot)
            return {
              skipped: false,
              output,
              events: runtime.eventCollector.snapshot(),
              scriptFiles: await listFiles(scriptsRoot),
              assetFiles,
              assetContents: await Promise.all(
                assetFiles
                  .filter((filePath) => filePath.endsWith('.json'))
                  .map((filePath) => fs.readFile(filePath, 'utf8').catch(() => ''))
              )
            }
          } finally {
            await terminalSessionManager.closeByChatSession(sessionId)
          }
        },
        assert: async (result, runtime) => {
          if (result.skipped) {
            runtime.assertThat(true, {
              name: 'live-config-not-provided',
              message: '未提供 live 模型配置，已跳过 runtime script assets live case。'
            })
            return
          }

          const assetsRoot = path.join(runtime.workspaceRoot, '.ncurator', 'runtime', 'assets')
          const assetBucketNames = result.assetFiles.map(
            (filePath) => path.relative(assetsRoot, filePath).split(path.sep)[0] || ''
          )
          runtime.assertThat(
            result.output?.status === 'completed' &&
              result.scriptFiles.some((filePath) => /\.(?:js|mjs|cjs|py)$/iu.test(filePath)) &&
              result.assetFiles.length > 0 &&
              assetBucketNames.every((name) => UUID_PATTERN.test(name)) &&
              result.assetContents.some((content) => content.includes(SCRIPT_MARKER)),
            {
              name: 'human-live-uses-runtime-script-and-uuid-assets',
              message:
                'live human 应执行 runtime 脚本，并把临时 JSON 产物写入 UUID assets 子目录。',
              data: {
                scriptFiles: result.scriptFiles.map((filePath) =>
                  path.relative(runtime.workspaceRoot, filePath)
                ),
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

  for (const runtimeName of ['node', 'python'] as const) {
    it(`human-runtime-download-${runtimeName}-live`, async () => {
      await runWithStructuredOutputRetry(async () => {
        await runBackendCase({
          caseId: `human-runtime-download-${runtimeName}-live`,
          harnessMode: 'live',
          domain: 'ai',
          suite: 'human',
          groups: ['live'],
          description: `验证真实模型在本地缺少 ${runtimeName} 时，下载真实可执行环境到 user_runtime 并完成任务。`,
          fixtures: [],
          runMode: 'single',
          runtimeModelName: hasLiveLlmConfigInEnv() ? loadLiveLlmConfigFromEnv().model_name : null,
          execute: async (runtime) => {
            if (!hasLiveLlmConfigInEnv()) {
              return {
                skipped: true,
                output: null,
                events: [],
                installedFiles: [],
                workspaceInstallationArtifacts: [],
                installDirectory: ''
              }
            }

            const missingCommands =
              runtimeName === 'node' ? ['node', 'nodejs'] : ['python', 'python3']
            const runtimePath = await createMissingRuntimePath(missingCommands)
            const installDirectory = createUserRuntimeTestDirectory()
            const marker = runtimeName === 'node' ? NODE_DOWNLOAD_MARKER : PYTHON_DOWNLOAD_MARKER
            const languageLabel = runtimeName === 'node' ? 'Node.js' : 'Python'
            const downloadGuidance = buildRuntimeDownloadGuidance(runtimeName, installDirectory)
            const sessionId = `human-runtime-download-${runtimeName}-live-session`
            await runtime.seedLlmConfig(loadLiveLlmConfigFromEnv())
            const runner = createHumanTestRunner(runtime, {
              sessionId,
              allowedToolNames: ['terminal_run', 'terminal_read', 'terminal_stop'],
              humanRuntimeOverrides: {
                hardActionLimit: 24,
                terminalEnvironment: { PATH: runtimePath }
              }
            })

            try {
              const output = await runner.run({
                taskId: runtime.taskId,
                userInput: `请使用 ${languageLabel} 真实运行程序并输出标记 ${marker}。当前终端中 ${languageLabel} 不可用，请下载无需系统安装的真实可执行环境，将本次测试的全部运行环境文件放在 ${installDirectory} 下，然后使用下载后的环境执行代码。${downloadGuidance}`
              })
              return {
                skipped: false,
                output,
                events: runtime.eventCollector.snapshot(),
                installedFiles: await listFiles(installDirectory),
                workspaceInstallationArtifacts: (await listFiles(runtime.workspaceRoot)).filter(
                  isRuntimeInstallationArtifact
                ),
                installDirectory
              }
            } finally {
              await terminalSessionManager.closeByChatSession(sessionId)
            }
          },
          assert: async (result, runtime) => {
            if (result.skipped) {
              runtime.assertThat(true, {
                name: 'live-config-not-provided',
                message: `未提供 live 模型配置，已跳过 ${runtimeName} download live case。`
              })
              return
            }

            const marker = runtimeName === 'node' ? NODE_DOWNLOAD_MARKER : PYTHON_DOWNLOAD_MARKER
            const commands = collectTerminalCommands(result.events)
            const resultText = collectTerminalResultText(result.events)
            const deliveryText = String(result.output?.deliveryMarkdown || '')
            const executableFiles = result.installedFiles.filter((filePath) =>
              runtimeName === 'node'
                ? /^node(?:\.exe)?$/iu.test(path.basename(filePath))
                : /^python(?:3(?:\.\d+)*)?(?:\.exe)?$/iu.test(path.basename(filePath))
            )
            const usedInstalledRuntime = commands.some((command) => {
              const normalizedCommand = normalizeCommandPath(command)
              return (
                normalizedCommand.includes(normalizeCommandPath(result.installDirectory)) &&
                (runtimeName === 'node'
                  ? /\/node(?:\.exe)?(?:[\s"']|$)/iu.test(normalizedCommand)
                  : /\/python(?:3(?:\.\d+)*)?(?:\.exe)?(?:[\s"']|$)/iu.test(normalizedCommand))
              )
            })

            runtime.assertThat(
              result.output?.status === 'completed' &&
                result.installedFiles.length > 0 &&
                executableFiles.length > 0 &&
                usedInstalledRuntime &&
                (resultText.includes(marker) || deliveryText.includes(marker)) &&
                result.workspaceInstallationArtifacts.length === 0,
              {
                name: `human-live-downloads-and-runs-${runtimeName}-from-user-runtime`,
                message: `live human 应在缺少 ${runtimeName} 时将真实运行环境下载到 user_runtime 独立目录，并用它执行代码。`,
                data: {
                  commands,
                  resultText,
                  deliveryText,
                  installDirectory: result.installDirectory,
                  installedFiles: result.installedFiles,
                  executableFiles,
                  workspaceInstallationArtifacts: result.workspaceInstallationArtifacts
                }
              }
            )
          }
        })
      })
    }, 480_000)
  }
})
