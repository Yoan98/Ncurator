import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = process.cwd()
const TESTS_ROOT = path.join(ROOT, 'tests')
const TEST_CASES_ROOT = path.join(TESTS_ROOT, 'case')
const resolveLocalBin = (name) =>
  path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name)
const PNPM_BIN = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const VITEST_BIN = resolveLocalBin('vitest')
const ELECTRON_VITE_BIN = resolveLocalBin('electron-vite')
const NATIVE_PREPARE_SCRIPT = path.join(ROOT, 'scripts', 'build', 'native', 'better-sqlite3.mjs')
const NODE_PTY_NATIVE_PREPARE_SCRIPT = path.join(ROOT, 'scripts', 'build', 'native', 'node-pty.mjs')
const BETTER_SQLITE_NATIVE_BINDING_ENV = 'NCURATOR_BETTER_SQLITE3_NATIVE_BINDING'
const LIVE_BACKEND_NODE_OLD_SPACE_MB = 8192
const DEFAULT_E2E_FILE_DELAY_MS = 1000
const USE_WINDOWS_SHELL = process.platform === 'win32'

const removeNpmLifecycleEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('npm_')) {
      delete process.env[key]
    }
  }
}

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
  const parts = [TEST_CASES_ROOT]
  if (input.domain) parts.push(input.domain)
  if (input.suite) parts.push(input.suite)
  if (input.groups.length > 0) parts.push(...input.groups)
  return path.join(...parts)
}

const isE2EFile = (filePath) => path.basename(filePath).endsWith('.e2e.test.ts')
const isLiveBackendFile = (filePath) =>
  filePath.includes(`${path.sep}live${path.sep}`) && !isE2EFile(filePath)
const toCaseId = (filePath) => path.basename(filePath).replace(/\.e2e\.test\.ts$|\.test\.ts$/u, '')

const fileContainsCaseId = async (filePath, caseId) => {
  if (toCaseId(filePath) === caseId) return true
  const source = await readFile(filePath, 'utf8')
  return source.includes(caseId)
}

const fileDeclaresCaseId = async (filePath, caseId) => {
  const source = await readFile(filePath, 'utf8')
  return source.includes(`caseId: '${caseId}'`) || source.includes(`caseId: "${caseId}"`)
}

const findTestFiles = async (input) => {
  const scopeDir = resolveScopeDir(input)
  try {
    const scopeStat = await stat(scopeDir)
    if (!scopeStat.isDirectory()) return []
  } catch {
    return []
  }

  const allFiles = await walk(scopeDir)
  const candidates = allFiles
    .filter((filePath) => filePath.endsWith('.test.ts'))
    .filter((filePath) => {
      if (!input.type) return true
      return input.type === 'e2e' ? isE2EFile(filePath) : !isE2EFile(filePath)
    })
  if (!input.caseId) return candidates.sort()
  const matches = await Promise.all(
    candidates.map(async (filePath) => ({
      filePath,
      matches: await fileContainsCaseId(filePath, input.caseId)
    }))
  )
  return matches
    .filter((item) => item.matches)
    .map((item) => item.filePath)
    .sort()
}

const appendNodeOption = (existing, option) => {
  const current = String(existing || '').trim()
  if (!current) return option
  return current.includes(option) ? current : `${current} ${option}`.trim()
}

const buildCommandEnv = (overrides = {}, options = {}) => {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (options.omitNpmEnv && key.startsWith('npm_')) continue
    env[key] = value
  }
  return {
    ...env,
    ...overrides
  }
}

const formatCommand = (bin, args) => [bin, ...args].join(' ')

const runSpawn = (bin, args, env, omitNpmEnv) =>
  spawnSync(bin, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: USE_WINDOWS_SHELL,
    env: buildCommandEnv(env, { omitNpmEnv })
  })

const reportSpawnFailure = (label, bin, args, result) => {
  if (result.error) {
    process.stderr.write(
      `[test-workflow] ${label} failed to start: ${formatCommand(bin, args)}\n${String(result.error)}\n`
    )
    return
  }
  if (typeof result.status !== 'number') {
    process.stderr.write(
      `[test-workflow] ${label} exited without a numeric status: ${formatCommand(bin, args)}\n`
    )
  }
}

const runCommandWithFallback = (input) => {
  if (input.preferFallback) {
    const fallbackResult = runSpawn(
      input.fallback.bin,
      input.fallback.args,
      input.env,
      input.omitNpmEnv
    )
    reportSpawnFailure('fallback command', input.fallback.bin, input.fallback.args, fallbackResult)
    if (typeof fallbackResult.status === 'number') return fallbackResult.status
    return 1
  }

  const primaryResult = runSpawn(input.primary.bin, input.primary.args, input.env, input.omitNpmEnv)

  if (!primaryResult.error) {
    reportSpawnFailure('primary command', input.primary.bin, input.primary.args, primaryResult)
    if (typeof primaryResult.status === 'number') return primaryResult.status
    return 1
  }

  reportSpawnFailure('primary command', input.primary.bin, input.primary.args, primaryResult)
  const fallbackResult = runSpawn(
    input.fallback.bin,
    input.fallback.args,
    input.env,
    input.omitNpmEnv
  )
  reportSpawnFailure('fallback command', input.fallback.bin, input.fallback.args, fallbackResult)
  if (typeof fallbackResult.status === 'number') return fallbackResult.status
  return 1
}

const prepareBetterSqliteNative = (target) => {
  const result = runSpawn(process.execPath, [NATIVE_PREPARE_SCRIPT, 'ensure', target])
  reportSpawnFailure(
    `native prepare ${target}`,
    process.execPath,
    [NATIVE_PREPARE_SCRIPT, 'ensure', target],
    result
  )
  if (typeof result.status === 'number') return result.status
  return 1
}

const prepareNodePtyNative = (target) => {
  const result = runSpawn(process.execPath, [NODE_PTY_NATIVE_PREPARE_SCRIPT, 'ensure', target])
  reportSpawnFailure(
    `node-pty native prepare ${target}`,
    process.execPath,
    [NODE_PTY_NATIVE_PREPARE_SCRIPT, 'ensure', target],
    result
  )
  if (typeof result.status === 'number') return result.status
  return 1
}

const resolveBetterSqliteNativeBinding = (target) => {
  const result = spawnSync(process.execPath, [NATIVE_PREPARE_SCRIPT, 'path', target], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: USE_WINDOWS_SHELL,
    env: buildCommandEnv(undefined)
  })
  reportSpawnFailure(
    `native path ${target}`,
    process.execPath,
    [NATIVE_PREPARE_SCRIPT, 'path', target],
    result
  )
  if (result.status !== 0) {
    return { ok: false, env: {} }
  }
  const nativeBinding =
    String(result.stdout || '')
      .trim()
      .split(/\r?\n/u)
      .at(-1) || ''
  return {
    ok: nativeBinding.length > 0,
    env: nativeBinding ? { [BETTER_SQLITE_NATIVE_BINDING_ENV]: nativeBinding } : {}
  }
}

const runVitest = (input) => {
  const requiresSingleWorker =
    input.configPath.includes('e2e') ||
    input.testFiles.some((filePath) => isLiveBackendFile(filePath))
  const extraArgs = requiresSingleWorker ? ['--maxWorkers', '1'] : []
  const env = input.testFiles.some((filePath) => isLiveBackendFile(filePath))
    ? {
        NODE_OPTIONS: appendNodeOption(
          process.env.NODE_OPTIONS,
          `--max-old-space-size=${String(LIVE_BACKEND_NODE_OLD_SPACE_MB)}`
        ),
        ...input.env
      }
    : input.env
  const caseArgs = input.testNamePattern ? ['--testNamePattern', input.testNamePattern] : []
  const commandArgs = [
    'run',
    '--config',
    input.configPath,
    ...extraArgs,
    ...caseArgs,
    ...input.testFiles
  ]
  return runCommandWithFallback({
    env,
    omitNpmEnv: input.configPath.includes('e2e'),
    preferFallback: true,
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

const buildE2EApp = (env) => {
  return runCommandWithFallback({
    env,
    preferFallback: true,
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
  [[input.domain, input.suite, ...input.groups].filter(Boolean).join('/'), input.type]
    .filter(Boolean)
    .join(' ')

const runE2ETestFilesSerially = async (testFiles, requestedDelayMs, env, testNamePattern) => {
  const e2eFileDelayMs = requestedDelayMs > 0 ? requestedDelayMs : DEFAULT_E2E_FILE_DELAY_MS
  let exitCode = 0

  for (let index = 0; index < testFiles.length; index += 1) {
    const testFile = testFiles[index]
    process.stdout.write(
      `[test-workflow] e2e ${String(index + 1)}/${String(testFiles.length)} ${path.relative(ROOT, testFile)}\n`
    )
    const code = runVitest({
      configPath: 'vitest.e2e.config.mts',
      testFiles: [testFile],
      env,
      testNamePattern
    })
    if (code !== 0) {
      process.stdout.write(
        `[test-workflow] e2e failed; stopping remaining files to avoid repeated Electron launches\n`
      )
      return code
    }
    if (e2eFileDelayMs > 0 && index < testFiles.length - 1) {
      process.stdout.write(
        `[test-workflow] waiting ${String(e2eFileDelayMs)}ms before next e2e file\n`
      )
      await sleep(e2eFileDelayMs)
    }
  }

  return exitCode
}

const runTypeWorkflow = async (input) => {
  const testFiles = await findTestFiles(input)
  if (testFiles.length === 0) {
    process.stdout.write(`[test-workflow] no tests found for ${formatScope(input)}\n`)
    return 0
  }

  const nativeTarget = input.type === 'e2e' ? 'electron' : 'node'
  const shouldFilterByTestName =
    Boolean(input.caseId) &&
    input.domain !== 'unit' &&
    (input.type === 'e2e' ||
      testFiles.some((filePath) => toCaseId(filePath) !== input.caseId) ||
      (
        await Promise.all(
          testFiles.map(async (filePath) => await fileDeclaresCaseId(filePath, input.caseId))
        )
      ).some(Boolean))
  const testNamePattern = shouldFilterByTestName ? input.caseId : ''
  const nativeCode = prepareBetterSqliteNative(nativeTarget)
  if (nativeCode !== 0) {
    return nativeCode
  }
  const nodePtyNativeCode = prepareNodePtyNative(nativeTarget)
  if (nodePtyNativeCode !== 0) {
    return nodePtyNativeCode
  }
  const nativeBinding = resolveBetterSqliteNativeBinding(nativeTarget)
  if (!nativeBinding.ok) {
    return 1
  }

  if (input.type === 'e2e') {
    const buildCode = buildE2EApp(nativeBinding.env)
    if (buildCode !== 0) {
      return buildCode
    }
  }

  let exitCode = 0
  const { liveFiles } =
    input.type === 'backend' ? partitionBackendTestFiles(testFiles) : { liveFiles: [] }
  const runDelayMs =
    input.runs > 1 && liveFiles.length > 0 ? (input.runDelayMs > 0 ? input.runDelayMs : 3000) : 0

  for (let iteration = 0; iteration < input.runs; iteration += 1) {
    if (input.type === 'backend') {
      const { nonLiveFiles, liveFiles } = partitionBackendTestFiles(testFiles)
      const groups = [
        {
          configPath: 'vitest.backend.config.mts',
          testFiles: nonLiveFiles,
          env: nativeBinding.env,
          testNamePattern
        },
        {
          configPath: 'vitest.backend.live.config.mts',
          testFiles: liveFiles,
          env: nativeBinding.env,
          testNamePattern
        }
      ].filter((group) => group.testFiles.length > 0)

      for (const group of groups) {
        const code = runVitest(group)
        if (code !== 0) {
          exitCode = code
        }
      }
    } else {
      const code = await runE2ETestFilesSerially(
        testFiles,
        input.runDelayMs,
        nativeBinding.env,
        testNamePattern
      )
      if (code !== 0) {
        exitCode = code
      }
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
  removeNpmLifecycleEnv()
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
