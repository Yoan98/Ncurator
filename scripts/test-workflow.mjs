import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = process.cwd()
const TESTS_ROOT = path.join(ROOT, 'tests')
const resolveLocalBin = (name) =>
  path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name)
const PNPM_BIN = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const VITEST_BIN = resolveLocalBin('vitest')
const ELECTRON_VITE_BIN = resolveLocalBin('electron-vite')
const LIVE_BACKEND_NODE_OLD_SPACE_MB = 8192

const parseArgs = (argv) => {
  const parsed = {
    domain: '',
    type: '',
    suite: '',
    groups: [],
    caseId: '',
    runs: 1,
    runDelayMs: 0
  }

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    const next = argv[index + 1]
    if (current === '--domain' && next) {
      parsed.domain = next
      index += 1
      continue
    }
    if (current === '--type' && next) {
      parsed.type = next
      index += 1
      continue
    }
    if (current === '--suite' && next) {
      parsed.suite = next
      index += 1
      continue
    }
    if (current === '--group' && next) {
      parsed.groups.push(next)
      index += 1
      continue
    }
    if (current === '--case' && next) {
      parsed.caseId = next
      index += 1
      continue
    }
    if (current === '--runs' && next) {
      parsed.runs = Math.max(1, Number(next))
      index += 1
      continue
    }
    if (current === '--run-delay-ms' && next) {
      parsed.runDelayMs = Math.max(0, Number(next))
      index += 1
    }
  }

  return parsed
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const walk = async (target) => {
  const entries = await readdir(target, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const resolved = path.join(target, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walk(resolved)))
      continue
    }
    files.push(resolved)
  }
  return files
}

const resolveScopeDir = (input) => {
  const parts = [TESTS_ROOT]
  if (input.domain) parts.push(input.domain)
  if (input.suite) parts.push(input.suite)
  if (input.groups.length > 0) parts.push(...input.groups)
  return path.join(...parts)
}

const isE2EFile = (filePath) => path.basename(filePath).endsWith('.e2e.test.ts')
const isLiveBackendFile = (filePath) => filePath.includes(`${path.sep}live${path.sep}`) && !isE2EFile(filePath)

const findTestFiles = async (input) => {
  const scopeDir = resolveScopeDir(input)
  try {
    const scopeStat = await stat(scopeDir)
    if (!scopeStat.isDirectory()) return []
  } catch {
    return []
  }

  const allFiles = await walk(scopeDir)
  return allFiles
    .filter((filePath) => filePath.endsWith('.test.ts'))
    .filter((filePath) => {
      if (!input.type) return true
      return input.type === 'e2e' ? isE2EFile(filePath) : !isE2EFile(filePath)
    })
    .filter((filePath) => {
      if (!input.caseId) return true
      return path.basename(filePath, '.test.ts') === input.caseId
    })
    .sort()
}

const appendNodeOption = (existing, option) => {
  const current = String(existing || '').trim()
  if (!current) return option
  return current.includes(option) ? current : `${current} ${option}`.trim()
}

const buildCommandEnv = (overrides) => ({
  ...process.env,
  ...overrides
})

const runCommandWithFallback = (input) => {
  const primaryResult = spawnSync(input.primary.bin, input.primary.args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: buildCommandEnv(input.env)
  })

  if (!primaryResult.error) {
    if (typeof primaryResult.status === 'number') return primaryResult.status
    return 1
  }

  const fallbackResult = spawnSync(input.fallback.bin, input.fallback.args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: buildCommandEnv(input.env)
  })
  if (typeof fallbackResult.status === 'number') return fallbackResult.status
  return 1
}

const runVitest = (input) => {
  const extraArgs = input.testFiles.some((filePath) => isLiveBackendFile(filePath))
    ? ['--maxWorkers', '1']
    : []
  const env = input.testFiles.some((filePath) => isLiveBackendFile(filePath))
    ? {
        NODE_OPTIONS: appendNodeOption(
          process.env.NODE_OPTIONS,
          `--max-old-space-size=${String(LIVE_BACKEND_NODE_OLD_SPACE_MB)}`
        )
      }
    : undefined
  const commandArgs = ['--config', input.configPath, ...extraArgs, 'run', ...input.testFiles]
  return runCommandWithFallback({
    env,
    primary: {
      bin: PNPM_BIN,
      args: ['exec', 'vitest', ...commandArgs]
    },
    fallback: {
      bin: VITEST_BIN,
      args: commandArgs
    }
  })
}

const partitionBackendTestFiles = (testFiles) => ({
  nonLiveFiles: testFiles.filter((filePath) => !isLiveBackendFile(filePath)),
  liveFiles: testFiles.filter((filePath) => isLiveBackendFile(filePath))
})

const buildE2EApp = () => {
  return runCommandWithFallback({
    primary: {
      bin: PNPM_BIN,
      args: ['exec', 'electron-vite', 'build']
    },
    fallback: {
      bin: ELECTRON_VITE_BIN,
      args: ['build']
    }
  })
}

const formatScope = (input) =>
  [[input.domain, input.suite, ...input.groups].filter(Boolean).join('/'), input.type].filter(Boolean).join(' ')

const runTypeWorkflow = async (input) => {
  const testFiles = await findTestFiles(input)
  if (testFiles.length === 0) {
    process.stdout.write(`[test-workflow] no tests found for ${formatScope(input)}\n`)
    return 0
  }

  if (input.type === 'e2e') {
    const buildCode = buildE2EApp()
    if (buildCode !== 0) {
      return buildCode
    }
  }

  let exitCode = 0
  const { liveFiles } =
    input.type === 'backend'
      ? partitionBackendTestFiles(testFiles)
      : { liveFiles: [] }
  const runDelayMs =
    input.runs > 1 && liveFiles.length > 0
      ? input.runDelayMs > 0
        ? input.runDelayMs
        : 3000
      : 0

  for (let iteration = 0; iteration < input.runs; iteration += 1) {
    if (input.type === 'backend') {
      const { nonLiveFiles, liveFiles } = partitionBackendTestFiles(testFiles)
      const groups = [
        {
          configPath: 'vitest.backend.config.mts',
          testFiles: nonLiveFiles
        },
        {
          configPath: 'vitest.backend.live.config.mts',
          testFiles: liveFiles
        }
      ].filter((group) => group.testFiles.length > 0)

      for (const group of groups) {
        const code = runVitest(group)
        if (code !== 0) {
          exitCode = code
          break
        }
      }
    } else {
      const code = runVitest({
        configPath: 'vitest.e2e.config.mts',
        testFiles
      })
      if (code !== 0) {
        exitCode = code
      }
    }

    if (exitCode !== 0) {
      break
    }

    if (runDelayMs > 0 && iteration < input.runs - 1) {
      process.stdout.write(
        `[test-workflow] waiting ${String(runDelayMs)}ms before next live run (${String(iteration + 2)}/${String(input.runs)})\n`
      )
      await sleep(runDelayMs)
    }
  }

  return exitCode
}

const main = async () => {
  const args = parseArgs(process.argv.slice(2))

  if (!args.domain) {
    throw new Error('missing required flag: --domain')
  }

  let exitCode = 0

  if (!args.type || args.type === 'backend') {
    exitCode = await runTypeWorkflow({
      ...args,
      type: 'backend'
    })
  }

  if (exitCode === 0 && (!args.type || args.type === 'e2e')) {
    exitCode = await runTypeWorkflow({
      ...args,
      type: 'e2e'
    })
  }

  process.exit(exitCode)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
