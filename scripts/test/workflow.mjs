import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { preparePackagedE2EApplication } from './package-app.mjs'

const ROOT = process.cwd()
const require = createRequire(import.meta.url)
const TESTS_ROOT = path.join(ROOT, 'tests')
const TEST_CASES_ROOT = path.join(TESTS_ROOT, 'case')
const resolveLocalBin = (name) =>
  path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name)
const PNPM_BIN = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const VITEST_CLI = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs')
const E2E_CONTRACT_SCRIPT = path.join(ROOT, 'scripts', 'test', 'validate-e2e-contract.mjs')
const TEST_ARCHITECTURE_SCRIPT = path.join(
  ROOT,
  'scripts',
  'test',
  'validate-test-architecture.mjs'
)
const ELECTRON_VITE_BIN = resolveLocalBin('electron-vite')
const NATIVE_PREPARE_SCRIPT = path.join(ROOT, 'scripts', 'build', 'native', 'better-sqlite3.mjs')
const NODE_PTY_NATIVE_PREPARE_SCRIPT = path.join(ROOT, 'scripts', 'build', 'native', 'node-pty.mjs')
const BETTER_SQLITE_NATIVE_BINDING_ENV = 'NCURATOR_BETTER_SQLITE3_NATIVE_BINDING'
const LIVE_BACKEND_NODE_OLD_SPACE_MB = 8192
const BACKEND_WORKERS = 6
const E2E_WORKERS = 3
const LIVE_WORKERS = 2
const RUNNER_DEADLINE_MS = 55 * 60 * 1000
const DEADLINE_EXIT_CODE = 124
const E2E_EXECUTION_CLASSES = new Set(['normal', 'live', 'exclusive', 'warmup'])
const USE_WINDOWS_SHELL = process.platform === 'win32'
const activeAsyncChildren = new Set()
let stoppingActiveChildren = false
const KNOWLEDGE_CACHE_ROOT = path.join(TESTS_ROOT, '.cache', 'workspace-knowledge')
const EMPTY_KNOWLEDGE_CACHE_STATS = {
  splitCacheHits: 0,
  splitCacheMisses: 0,
  vectorCacheHits: 0,
  vectorCacheMisses: 0
}

const loadRootEnv = () => {
  if (String(process.env.AI_TEST_DISABLE_DOTENV || '').trim() === '1') return
  for (const fileName of ['.env.local', '.env']) {
    let raw = ''
    try {
      raw = readFileSync(path.resolve(ROOT, fileName), 'utf8')
    } catch {
      continue
    }
    for (const line of raw.split(/\r?\n/u)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const separator = trimmed.indexOf('=')
      if (separator <= 0) continue
      const key = trimmed.slice(0, separator).trim()
      const value = trimmed.slice(separator + 1).trim()
      if (!key || String(process.env[key] || '').trim()) continue
      process.env[key] =
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
          ? value.slice(1, -1)
          : value
    }
  }
}

loadRootEnv()

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
    excludeGroups: [],
    caseId: '',
    runs: 1,
    target: 'source',
    bundles: [],
    results: [],
    freshKnowledgeCache: false,
    reuseKnowledgeCache: false
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
    if (current === '--exclude-group' && next) {
      parsed.excludeGroups.push(next)
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
    if (current === '--target' && next) {
      parsed.target = next
      index += 1
      continue
    }
    if (current === '--bundle' && next) {
      parsed.bundles.push(next)
      index += 1
      continue
    }
    if (current === '--result' && next) {
      parsed.results.push(next)
      index += 1
      continue
    }
    if (current === '--fresh-knowledge-cache') parsed.freshKnowledgeCache = true
    if (current === '--reuse-knowledge-cache') parsed.reuseKnowledgeCache = true
  }

  return parsed
}

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

const hashBuildDirectories = async (directories) => {
  const hash = createHash('sha256')
  for (const directory of directories) {
    const files = (await walk(directory)).sort()
    for (const filePath of files) {
      const relativePath = path.relative(ROOT, filePath).split(path.sep).join('/')
      hash.update(relativePath)
      hash.update('\0')
      hash.update(await readFile(filePath))
      hash.update('\0')
    }
  }
  return hash.digest('hex')
}

const readKnowledgeCacheStats = async (cachePath) => {
  const totals = { ...EMPTY_KNOWLEDGE_CACHE_STATS }
  let files = []
  try {
    files = await walk(cachePath)
  } catch {
    return totals
  }
  for (const filePath of files.filter((item) => path.basename(item) === 'stats.json')) {
    try {
      const parsed = JSON.parse(await readFile(filePath, 'utf8'))
      for (const key of Object.keys(totals)) totals[key] += Number(parsed[key] || 0)
    } catch {
      // A failed case may leave no usable cache statistics.
    }
  }
  return totals
}

const prepareKnowledgeCache = async (input) => {
  const cachePath = input.reuse
    ? path.join(KNOWLEDGE_CACHE_ROOT, 'debug-reuse', input.namespace)
    : path.join(KNOWLEDGE_CACHE_ROOT, input.namespace, input.buildFingerprint)
  if (input.fresh) await rm(cachePath, { recursive: true, force: true })
  await mkdir(cachePath, { recursive: true })
  return {
    knowledgeCacheEnabled: true,
    knowledgeCachePath: cachePath,
    knowledgeCacheNamespace: input.namespace,
    buildFingerprint: input.buildFingerprint,
    env: {
      NCURATOR_WORKSPACE_KNOWLEDGE_CACHE: '1',
      NCURATOR_WORKSPACE_KNOWLEDGE_CACHE_PATH: cachePath,
      NCURATOR_E2E_KNOWLEDGE_CACHE_NAMESPACE: input.namespace,
      NCURATOR_E2E_BUILD_FINGERPRINT: input.buildFingerprint
    }
  }
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

const readE2EExecutionClass = async (filePath) => {
  const source = await readFile(filePath, 'utf8')
  const matches = [
    ...source.matchAll(/\bexecution\s*:\s*['"](normal|live|exclusive|warmup)['"]/gu)
  ].map((match) => match[1])
  const declared = [...new Set(matches)]
  if (declared.length > 1) {
    throw new Error(`${path.relative(ROOT, filePath)} declares multiple E2E execution classes`)
  }
  const execution = declared[0] || 'normal'
  if (!E2E_EXECUTION_CLASSES.has(execution)) {
    throw new Error(`${path.relative(ROOT, filePath)} has unsupported execution class ${execution}`)
  }
  return execution
}

const buildCaseKnowledgeCacheEnv = async (env, testFile) => {
  const basePath = String(env.NCURATOR_WORKSPACE_KNOWLEDGE_CACHE_PATH || '').trim()
  if (!basePath) return env
  const relativePath = path.relative(TEST_CASES_ROOT, testFile).split(path.sep).join('/')
  const caseKey = `${toCaseId(testFile)}-${createHash('sha256').update(relativePath).digest('hex').slice(0, 12)}`
  const casePath = path.join(basePath, 'cases', caseKey)
  await mkdir(casePath, { recursive: true })
  return {
    ...env,
    NCURATOR_WORKSPACE_KNOWLEDGE_CACHE_PATH: casePath,
    NCURATOR_E2E_KNOWLEDGE_CACHE_NAMESPACE: `${String(
      env.NCURATOR_E2E_KNOWLEDGE_CACHE_NAMESPACE || 'e2e'
    )}/${caseKey}`
  }
}

const seedCaseKnowledgeCache = async (caseEnv, seedPath) => {
  const casePath = String(caseEnv.NCURATOR_WORKSPACE_KNOWLEDGE_CACHE_PATH || '').trim()
  if (!seedPath || !casePath || path.resolve(seedPath) === path.resolve(casePath)) return
  await cp(seedPath, casePath, {
    recursive: true,
    force: false,
    errorOnExist: false,
    filter: (source) => path.basename(source) !== 'stats.json'
  })
}

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
      if (input.excludeGroups.length === 0) return true
      const segments = path.relative(TEST_CASES_ROOT, filePath).split(path.sep)
      return !input.excludeGroups.some((group) => segments.includes(group))
    })
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

const terminateProcessTree = (child) => {
  if (!child?.pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true
    })
    return
  }
  child.kill('SIGTERM')
}

const stopActiveChildren = (signal) => {
  if (stoppingActiveChildren) return
  stoppingActiveChildren = true
  process.stderr.write(
    `[test-workflow] received ${signal}; stopping ${String(activeAsyncChildren.size)} active test process tree(s)\n`
  )
  for (const child of activeAsyncChildren) terminateProcessTree(child)
  process.exit(signal === 'SIGINT' ? 130 : 143)
}

process.once('SIGINT', () => stopActiveChildren('SIGINT'))
process.once('SIGTERM', () => stopActiveChildren('SIGTERM'))

const runSpawn = (bin, args, env, omitNpmEnv) =>
  spawnSync(bin, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: USE_WINDOWS_SHELL && /\.(cmd|bat)$/iu.test(bin),
    env: buildCommandEnv(env, { omitNpmEnv })
  })

const runSpawnAsync = (bin, args, env, omitNpmEnv, deadlineAt) =>
  new Promise((resolve) => {
    const remainingMs = deadlineAt - Date.now()
    if (remainingMs <= 0) {
      resolve(DEADLINE_EXIT_CODE)
      return
    }
    const controller = new AbortController()
    let settled = false
    let timedOut = false
    const finish = (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      activeAsyncChildren.delete(child)
      resolve(code)
    }
    const timer = setTimeout(() => {
      timedOut = true
      process.stderr.write(
        `[test-workflow] deadline reached; stopping ${formatCommand(bin, args)}\n`
      )
      controller.abort()
      terminateProcessTree(child)
    }, remainingMs)
    const child = spawn(bin, args, {
      cwd: ROOT,
      stdio: 'inherit',
      shell: USE_WINDOWS_SHELL && /\.(cmd|bat)$/iu.test(bin),
      env: buildCommandEnv(env, { omitNpmEnv }),
      signal: controller.signal
    })
    activeAsyncChildren.add(child)
    child.once('error', (error) => {
      if (!timedOut) {
        process.stderr.write(
          `[test-workflow] command failed to start: ${formatCommand(bin, args)}\n${String(error)}\n`
        )
      }
      finish(timedOut ? DEADLINE_EXIT_CODE : 1)
    })
    child.once('exit', (code) => finish(timedOut ? DEADLINE_EXIT_CODE : (code ?? 1)))
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

const runVitest = async (input) => {
  const extraArgs = ['--maxWorkers', String(input.workers)]
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
  return await runSpawnAsync(
    process.execPath,
    [VITEST_CLI, ...commandArgs],
    env,
    input.configPath.includes('e2e'),
    input.deadlineAt
  )
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

const validateE2EContract = () => {
  const result = runSpawn(process.execPath, [E2E_CONTRACT_SCRIPT], undefined, true)
  if (result.error || typeof result.status !== 'number') return 1
  return result.status
}

const validateTestArchitecture = () => {
  const result = runSpawn(process.execPath, [TEST_ARCHITECTURE_SCRIPT], undefined, true)
  if (result.error || typeof result.status !== 'number') return 1
  return result.status
}

const formatScope = (input) =>
  [[input.domain, input.suite, ...input.groups].filter(Boolean).join('/'), input.type]
    .filter(Boolean)
    .join(' ')

const runE2ETestFilesConcurrently = async (testFiles, targets, testNamePattern, deadlineAt) => {
  const fileTasks = await Promise.all(
    testFiles.map(async (testFile) => ({
      testFile,
      execution: await readE2EExecutionClass(testFile)
    }))
  )
  const tasks = targets
    .flatMap((target) =>
      fileTasks.map((task) => ({
        ...task,
        targetId: target.id,
        env: target.env
      }))
    )
    .map((task, index) => ({ ...task, index }))
  const warmupTasks = tasks.filter((task) => task.execution === 'warmup')
  const concurrentTasks = tasks.filter(
    (task) => task.execution !== 'exclusive' && task.execution !== 'warmup'
  )
  const exclusiveTasks = tasks.filter((task) => task.execution === 'exclusive')
  const results = []
  let exitCode = 0
  let liveActive = 0
  let completed = 0
  const warmupCacheByTarget = new Map()

  const recordDeadline = (task) => {
    exitCode = DEADLINE_EXIT_CODE
    results.push({
      index: task.index,
      file: path.relative(ROOT, task.testFile),
      targetId: task.targetId,
      execution: task.execution,
      status: 'timed_out',
      exitCode: DEADLINE_EXIT_CODE
    })
  }

  const runTask = async (task, seedPath = '') => {
    completed += 1
    const relativeFile = path.relative(ROOT, task.testFile)
    process.stdout.write(
      `[test-workflow] e2e ${String(completed)}/${String(tasks.length)} [${task.targetId}/${task.execution}] ${relativeFile}\n`
    )
    const startedAt = Date.now()
    const caseEnv = await buildCaseKnowledgeCacheEnv(task.env, task.testFile)
    await seedCaseKnowledgeCache(caseEnv, seedPath)
    const code = await runVitest({
      configPath: 'vitest.e2e.config.mts',
      testFiles: [task.testFile],
      env: caseEnv,
      testNamePattern,
      workers: 1,
      deadlineAt
    })
    if (code !== 0) exitCode = code === DEADLINE_EXIT_CODE ? DEADLINE_EXIT_CODE : exitCode || code
    results.push({
      index: task.index,
      file: relativeFile,
      targetId: task.targetId,
      execution: task.execution,
      status: code === 0 ? 'passed' : code === DEADLINE_EXIT_CODE ? 'timed_out' : 'failed',
      exitCode: code,
      durationMs: Date.now() - startedAt
    })
    return {
      code,
      cachePath: String(caseEnv.NCURATOR_WORKSPACE_KNOWLEDGE_CACHE_PATH || '').trim()
    }
  }

  for (let index = 0; index < warmupTasks.length; index += 1) {
    const task = warmupTasks[index]
    if (Date.now() >= deadlineAt) {
      for (const remaining of warmupTasks.slice(index)) recordDeadline(remaining)
      return {
        exitCode,
        results: results.sort((left, right) => left.index - right.index)
      }
    }
    process.stdout.write(
      `[test-workflow] vector warm-up ${String(index + 1)}/${String(warmupTasks.length)} must pass before parallel E2E starts\n`
    )
    const outcome = await runTask(task)
    if (outcome.code !== 0) {
      process.stderr.write(
        '[test-workflow] vector warm-up failed; parallel E2E will not start on a cold cache\n'
      )
      return {
        exitCode,
        results: results.sort((left, right) => left.index - right.index)
      }
    }
    warmupCacheByTarget.set(task.targetId, outcome.cachePath)
  }

  if (warmupCacheByTarget.size > 0) {
    process.stdout.write(
      `[test-workflow] vector warm-up passed; isolated E2E caches will be seeded for ${String(warmupCacheByTarget.size)} target(s)\n`
    )
  }

  const pending = [...concurrentTasks]
  const active = new Set()
  while (pending.length > 0 || active.size > 0) {
    while (pending.length > 0 && active.size < E2E_WORKERS && Date.now() < deadlineAt) {
      const nextIndex = pending.findIndex(
        (task) => task.execution !== 'live' || liveActive < LIVE_WORKERS
      )
      if (nextIndex < 0) break
      const [task] = pending.splice(nextIndex, 1)
      if (task.execution === 'live') liveActive += 1
      let running
      running = runTask(task, warmupCacheByTarget.get(task.targetId)).finally(() => {
        if (task.execution === 'live') liveActive -= 1
        active.delete(running)
      })
      active.add(running)
    }
    if (Date.now() >= deadlineAt && pending.length > 0) {
      for (const task of pending.splice(0)) recordDeadline(task)
    }
    if (active.size > 0) await Promise.race(active)
  }

  for (let index = 0; index < exclusiveTasks.length; index += 1) {
    const task = exclusiveTasks[index]
    if (Date.now() >= deadlineAt) {
      for (const remaining of exclusiveTasks.slice(index)) recordDeadline(remaining)
      break
    }
    await runTask(task, warmupCacheByTarget.get(task.targetId))
  }

  return {
    exitCode,
    results: results.sort((left, right) => left.index - right.index)
  }
}

const runTypeWorkflow = async (input) => {
  const testFiles = await findTestFiles(input)
  if (testFiles.length === 0) {
    process.stdout.write(`[test-workflow] no tests found for ${formatScope(input)}\n`)
    return { exitCode: 0, e2eResults: [] }
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
  let runtimeEnv = input.e2eEnv || {}
  let e2eTargets = input.e2eTargets || []
  if (input.type === 'e2e') {
    const e2eTempRoot = path.resolve(
      String(process.env.NCURATOR_E2E_TEMP_ROOT || '').trim() ||
        path.join(TESTS_ROOT, '.tmp', 'e2e')
    )
    await mkdir(e2eTempRoot, { recursive: true })
    runtimeEnv = {
      ...runtimeEnv,
      NCURATOR_E2E_TEMP_ROOT: e2eTempRoot
    }
    e2eTargets = e2eTargets.map((target) => ({
      ...target,
      env: { ...target.env, NCURATOR_E2E_TEMP_ROOT: e2eTempRoot }
    }))
  }
  if (input.type === 'e2e' && input.target === 'package') {
    const nativeCode = prepareBetterSqliteNative('node')
    if (nativeCode !== 0) {
      return { exitCode: nativeCode, e2eResults: [] }
    }
  }
  if (input.type !== 'e2e' || input.target === 'source') {
    const nativeCode = prepareBetterSqliteNative(nativeTarget)
    if (nativeCode !== 0) {
      return { exitCode: nativeCode, e2eResults: [] }
    }
    const nodePtyNativeCode = prepareNodePtyNative(nativeTarget)
    if (nodePtyNativeCode !== 0) {
      return { exitCode: nodePtyNativeCode, e2eResults: [] }
    }
    const nativeBinding = resolveBetterSqliteNativeBinding(nativeTarget)
    if (!nativeBinding.ok) {
      return { exitCode: 1, e2eResults: [] }
    }
    runtimeEnv = { ...nativeBinding.env, ...runtimeEnv }
  }

  if (input.type === 'e2e' && input.target === 'source') {
    const buildCode = buildE2EApp(runtimeEnv)
    if (buildCode !== 0) {
      return { exitCode: buildCode, e2eResults: [] }
    }
    runtimeEnv.NCURATOR_E2E_APP_TARGET = 'source'
    const buildFingerprint = await hashBuildDirectories([
      path.join(ROOT, 'out', 'main'),
      path.join(ROOT, 'out', 'preload')
    ])
    const knowledgeCache = await prepareKnowledgeCache({
      namespace: 'source',
      buildFingerprint,
      fresh: input.freshKnowledgeCache,
      reuse: input.reuseKnowledgeCache
    })
    runtimeEnv = { ...runtimeEnv, ...knowledgeCache.env }
    e2eTargets = [{ id: 'source', env: runtimeEnv }]
  }

  let exitCode = 0
  const e2eResults = []
  for (let iteration = 0; iteration < input.runs; iteration += 1) {
    if (input.type === 'backend') {
      const { nonLiveFiles, liveFiles } = partitionBackendTestFiles(testFiles)
      const groups = [
        {
          configPath: 'vitest.backend.config.mts',
          testFiles: nonLiveFiles,
          env: runtimeEnv,
          testNamePattern,
          workers: BACKEND_WORKERS,
          deadlineAt: input.deadlineAt
        },
        {
          configPath: 'vitest.backend.live.config.mts',
          testFiles: liveFiles,
          env: runtimeEnv,
          testNamePattern,
          workers: LIVE_WORKERS,
          deadlineAt: input.deadlineAt
        }
      ].filter((group) => group.testFiles.length > 0)

      for (const group of groups) {
        const code = await runVitest(group)
        if (code !== 0) {
          exitCode = code
        }
      }
    } else {
      const runResult = await runE2ETestFilesConcurrently(
        testFiles,
        e2eTargets,
        testNamePattern,
        input.deadlineAt
      )
      e2eResults.push(...runResult.results)
      if (runResult.exitCode !== 0) {
        exitCode = runResult.exitCode
      }
    }
  }

  return { exitCode, e2eResults }
}

const main = async () => {
  removeNpmLifecycleEnv()
  const args = parseArgs(process.argv.slice(2))
  const deadlineAt = Date.now() + RUNNER_DEADLINE_MS

  const expectedTypeByDomain = {
    ai: 'backend',
    unit: 'backend',
    settings: 'e2e',
    workbench: 'e2e'
  }
  if (args.domain) {
    const expectedType = expectedTypeByDomain[args.domain]
    if (!expectedType) throw new Error(`unsupported --domain: ${args.domain}`)
    if (!args.type) args.type = expectedType
    if (args.type !== expectedType) {
      throw new Error(`${args.domain} 测试只允许 --type ${expectedType}`)
    }
  }

  if (!['source', 'package'].includes(args.target)) {
    throw new Error(`unsupported --target: ${args.target}`)
  }
  if (args.target === 'package' && args.type !== 'e2e') {
    throw new Error('--target package 只能与 --type e2e 一起使用')
  }
  if (args.target === 'package' && args.bundles.length === 0) {
    throw new Error('--target package 必须提供 --bundle <release-bundle.json>')
  }
  if (args.target !== 'package' && args.bundles.length > 0) {
    throw new Error('--bundle 只能与 --target package 一起使用')
  }
  if (args.target !== 'package' && args.results.length > 0) {
    throw new Error('--result 只能与 --target package 一起使用')
  }
  if (args.freshKnowledgeCache && args.reuseKnowledgeCache) {
    throw new Error('--fresh-knowledge-cache 和 --reuse-knowledge-cache 不能同时使用')
  }

  const architectureValidationCode = validateTestArchitecture()
  if (architectureValidationCode !== 0) process.exit(architectureValidationCode)

  let exitCode = 0
  let packageTargets = []

  if (!args.type || args.type === 'e2e') {
    const validationCode = validateE2EContract()
    if (validationCode !== 0) process.exit(validationCode)
  }

  if (args.type === 'e2e' && args.target === 'package') {
    if (args.results.length > 0 && args.results.length !== args.bundles.length) {
      throw new Error('each --bundle must have a matching --result when result paths are provided')
    }
    packageTargets = await Promise.all(
      args.bundles.map(async (bundle, index) => {
        const session = await preparePackagedE2EApplication(bundle, {
          resultPath: args.results[index] || ''
        })
        const knowledgeCache = await prepareKnowledgeCache({
          namespace: `package/${session.releasePlatform}`,
          buildFingerprint: session.artifactSha256,
          fresh: args.freshKnowledgeCache,
          reuse: args.reuseKnowledgeCache
        })
        return {
          id: session.releasePlatform,
          env: { ...session.env, ...knowledgeCache.env },
          session,
          knowledgeCache
        }
      })
    )
  }

  if (!args.type || args.type === 'backend') {
    const result = await runTypeWorkflow({
      ...args,
      type: 'backend',
      deadlineAt
    })
    exitCode = result.exitCode
  }

  if (exitCode === 0 && (!args.type || args.type === 'e2e')) {
    const result = await runTypeWorkflow({
      ...args,
      type: 'e2e',
      e2eTargets: packageTargets.map(({ id, env }) => ({ id, env })),
      deadlineAt
    })
    exitCode = result.exitCode
    for (const target of packageTargets) {
      target.session.writeSummary({
        status: exitCode === 0 ? 'passed' : 'failed',
        tests: result.e2eResults.filter((test) => test.targetId === target.id),
        knowledgeCache: {
          knowledgeCacheEnabled: target.knowledgeCache.knowledgeCacheEnabled,
          knowledgeCachePath: target.knowledgeCache.knowledgeCachePath,
          knowledgeCacheNamespace: target.knowledgeCache.knowledgeCacheNamespace,
          buildFingerprint: target.knowledgeCache.buildFingerprint,
          ...(await readKnowledgeCacheStats(target.knowledgeCache.knowledgeCachePath))
        }
      })
    }
  }

  process.exit(exitCode)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
