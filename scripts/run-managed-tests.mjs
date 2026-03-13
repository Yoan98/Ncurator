#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { readCurrentCaseCatalog } from './lib/testCatalog.mjs'

const ROOT = process.cwd()

const parseArgs = () => {
  const args = process.argv.slice(2)
  const options = {
    runPolicy: null,
    lifecycle: 'active'
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--run-policy') {
      options.runPolicy = args[index + 1] || null
      index += 1
      continue
    }
    if (arg === '--lifecycle') {
      options.lifecycle = args[index + 1] || options.lifecycle
      index += 1
      continue
    }
    throw new Error(`unsupported argument: ${arg}`)
  }

  return options
}

const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit'
  })

  return result.status || 0
}

const normalizeFileList = (files) => Array.from(new Set(files)).sort()

const filterCases = (currentCases, options) =>
  currentCases.filter((item) => {
    if (options.lifecycle && item.lifecycle !== options.lifecycle) {
      return false
    }
    if (options.runPolicy && item.runPolicy !== options.runPolicy) {
      return false
    }
    return true
  })

const classifySourceFiles = (sourceFiles) => {
  const mainFiles = []
  const rendererFiles = []
  const e2eFiles = []

  for (const oneFile of sourceFiles) {
    if (oneFile.startsWith('tests/main/')) {
      mainFiles.push(oneFile)
      continue
    }
    if (oneFile.startsWith('tests/renderer/')) {
      rendererFiles.push(oneFile)
      continue
    }
    if (oneFile.startsWith('tests/e2e/')) {
      e2eFiles.push(oneFile)
      continue
    }
    throw new Error(`unsupported managed case file: ${oneFile}`)
  }

  return {
    mainFiles: normalizeFileList(mainFiles),
    rendererFiles: normalizeFileList(rendererFiles),
    e2eFiles: normalizeFileList(e2eFiles)
  }
}

const main = async () => {
  const options = parseArgs()
  const catalog = await readCurrentCaseCatalog()
  const filteredCases = filterCases(catalog.currentCases, options)

  if (filteredCases.length === 0) {
    process.stdout.write('No managed cases matched the requested filters.\n')
    return
  }

  const sourceFiles = normalizeFileList(filteredCases.map((item) => item.sourceFile))
  const { mainFiles, rendererFiles, e2eFiles } = classifySourceFiles(sourceFiles)
  const exitCodes = []

  if (mainFiles.length > 0) {
    exitCodes.push(run('pnpm', ['exec', 'vitest', '--config', 'vitest.ai.config.mts', 'run', ...mainFiles]))
  }

  if (rendererFiles.length > 0) {
    exitCodes.push(
      run('pnpm', ['exec', 'vitest', '--config', 'vitest.renderer.config.mts', 'run', ...rendererFiles])
    )
  }

  if (e2eFiles.length > 0) {
    exitCodes.push(run('pnpm', ['exec', 'electron-vite', 'build']))
    exitCodes.push(run('pnpm', ['exec', 'vitest', '--config', 'vitest.e2e.config.mts', 'run', ...e2eFiles]))
  }

  if (exitCodes.some((code) => code !== 0)) {
    process.exit(1)
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
