import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, it } from 'vitest'
import { getPartnerScriptsRootDir } from '../../../../../src/main/services/assets/WorkspaceAssetService'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { terminalSessionManager } from '../../../../../src/main/services/ai/human/tools/terminal/TerminalSessionManager'
import type { AiRunEvent } from '../../../../../src/shared/types'
import { filterAiRunEventsByType, runWithStructuredOutputRetry } from '../testUtils'

const SQUARE_SUM_MARKER = '338350'
const IS_WINDOWS = process.platform === 'win32'
const SUPPORTED_PLATFORMS = new Set<NodeJS.Platform>(['darwin', 'win32'])

const cleanupDirectories = new Set<string>()

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

const collectTerminalCommands = (events: readonly AiRunEvent[]): string[] =>
  filterAiRunEventsByType(events, 'tool_call_started')
    .filter((event) => event.toolName === 'terminal_run')
    .map((event) => event.input.command)
    .filter((command): command is string => typeof command === 'string')

const collectTerminalResultText = (events: readonly AiRunEvent[]): string =>
  JSON.stringify(
    filterAiRunEventsByType(events, 'tool_call_result')
      .filter((event) => event.toolName === 'terminal_run')
      .map((event) => event.result?.data)
  )

const writeUnavailableCommand = async (directoryPath: string, commandName: string): Promise<void> => {
  const commandPath = path.join(directoryPath, IS_WINDOWS ? `${commandName}.cmd` : commandName)
  await fs.writeFile(
    commandPath,
    IS_WINDOWS ? '@echo off\r\nexit /b 127\r\n' : '#!/bin/sh\nexit 127\n',
    'utf8'
  )
  if (!IS_WINDOWS) await fs.chmod(commandPath, 0o755)
}

const createMissingPythonPath = async (): Promise<string> => {
  const binPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-missing-python-'))
  cleanupDirectories.add(binPath)
  await Promise.all(['python', 'python3'].map((name) => writeUnavailableCommand(binPath, name)))
  const systemPaths = IS_WINDOWS
    ? [process.env.SystemRoot, path.join(process.env.SystemRoot || 'C:\\Windows', 'System32')]
    : ['/usr/bin', '/bin', '/usr/sbin', '/sbin']
  return [binPath, ...systemPaths.filter(Boolean)].join(path.delimiter)
}

const PYTHON_PATH_REF =
  /(?:\.\/|\.\.\/|\/|\\|[a-z]:)[^\s"'`]*python(?:3(?:\.\d+)*)?(?:\.exe)?(?:[\s"'`]|$)/iu
const DOWNLOAD_KEYWORD =
  /(?:curl|wget|git\s+clone|Expand-Archive|Invoke-WebRequest|Invoke-RestMethod|tar\b|unzip|7z\b|uv\b|pipx|pyenv|brew\b|conda|mise\b|asdf\b|winget|choco)\b/iu

afterEach(async () => {
  const directories = [...cleanupDirectories]
  cleanupDirectories.clear()
  await Promise.all(
    directories.map((directoryPath) => fs.rm(directoryPath, { recursive: true, force: true }))
  )
})

describe.skipIf(!SUPPORTED_PLATFORMS.has(process.platform))('ai human live runtime script', () => {
  it('human-runtime-script-system-python-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-runtime-script-system-python-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description:
          '验证 live 模型用本机 Python 在临时脚本目录编写并运行临时脚本，完成确定性计算并核对结果。',
        fixtures: [],
        runMode: 'single',
        execute: async (runtime) => {
          const sessionId = 'human-runtime-script-system-python-live-session'
          const runner = createHumanTestRunner(runtime, { sessionId })
          try {
            const output = await runner.run({
              taskId: runtime.taskId,
              userInput:
                '请用 Python 写一个临时脚本，计算 1 到 100 每个整数的平方之和并核对结果。脚本是临时用途，请放在临时脚本目录，不要在工作区普通目录留下文件。'
            })
            return {
              output,
              events: runtime.eventCollector.snapshot(),
              scriptsRoot: getPartnerScriptsRootDir(sessionId),
              scriptFiles: await listFiles(getPartnerScriptsRootDir(sessionId))
            }
          } finally {
            await terminalSessionManager.closeByChatSession(sessionId)
          }
        },
        assert: async (result, runtime) => {
          const commands = collectTerminalCommands(result.events)
          const resultText = collectTerminalResultText(result.events)
          runtime.assertThat(
            result.output.status === 'completed' &&
              resultText.includes(SQUARE_SUM_MARKER) &&
              commands.some((command) => /python(?:3)?(?:\s|$)/iu.test(command)) &&
              result.scriptFiles.some((filePath) => filePath.endsWith('.py')),
            {
              name: 'human-live-runs-temp-script-with-system-python',
              message:
                'live human 应用本机 Python 在临时脚本目录（runtime_paths.scripts）运行临时脚本，得到正确计算结果且不污染工作区普通目录。',
              data: {
                commands,
                resultText,
                scriptsRoot: result.scriptsRoot,
                scriptFiles: result.scriptFiles.map((filePath) =>
                  path.relative(result.scriptsRoot, filePath)
                )
              }
            }
          )
        }
      })
    })
  })

  it('human-runtime-download-python-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-runtime-download-python-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description:
          '验证 live 模型在本机 Python 不可用时自行下载无需系统安装的 Python，再运行临时脚本完成确定性计算。',
        fixtures: [],
        runMode: 'single',
        execute: async (runtime) => {
          const sessionId = 'human-runtime-download-python-live-session'
          const missingPythonPath = await createMissingPythonPath()
          const runner = createHumanTestRunner(runtime, {
            sessionId,
            humanRuntimeOverrides: {
              terminalEnvironment: { PATH: missingPythonPath }
            }
          })
          try {
            const output = await runner.run({
              taskId: runtime.taskId,
              userInput:
                '这台电脑上 Python 环境不可用，请你先自己准备好一个无需系统安装的 Python 运行环境，再写一个临时脚本计算 1 到 100 每个整数的平方之和并核对结果。脚本是临时用途，请放在临时脚本目录，不要在工作区普通目录留下文件。'
            })
            return {
              output,
              events: runtime.eventCollector.snapshot(),
              scriptsRoot: getPartnerScriptsRootDir(sessionId),
              scriptFiles: await listFiles(getPartnerScriptsRootDir(sessionId))
            }
          } finally {
            await terminalSessionManager.closeByChatSession(sessionId)
          }
        },
        assert: async (result, runtime) => {
          const commands = collectTerminalCommands(result.events)
          const resultText = collectTerminalResultText(result.events)
          const usesDownloadedPython = commands.some(
            (command) => PYTHON_PATH_REF.test(command) || DOWNLOAD_KEYWORD.test(command)
          )
          runtime.assertThat(
            result.output.status === 'completed' &&
              resultText.includes(SQUARE_SUM_MARKER) &&
              result.scriptFiles.some((filePath) => filePath.endsWith('.py')) &&
              usesDownloadedPython,
            {
              name: 'human-live-downloads-python-and-runs-temp-script',
              message:
                'live human 应在 Python 不可用时自行下载可运行环境，用它在临时脚本目录（runtime_paths.scripts）执行临时脚本并得到正确结果。',
              data: {
                commands,
                resultText,
                scriptsRoot: result.scriptsRoot,
                scriptFiles: result.scriptFiles.map((filePath) =>
                  path.relative(result.scriptsRoot, filePath)
                ),
                usesDownloadedPython
              }
            }
          )
        }
      })
    })
  })
})
