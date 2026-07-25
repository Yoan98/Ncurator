import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
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
const DEFAULT_E2E_FILE_DELAY_MS = 1000
const USE_WINDOWS_SHELL = process.platform === 'win32'
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
    runDelayMs: 0,
    target: 'source',
    bundle: '',
    result: '',
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
    if (current === '--run-delay-ms' && next) {
      parsed.runDelayMs = Math.max(0, Number(next))
      index += 1
      continue
    }
    if (current === '--target' && next) {
      parsed.target = next
      index += 1
      continue
    }
    if (current === '--bundle' && next) {
      parsed.bundle = next
      index += 1
      continue
    }
    if (current === '--result' && next) {
      parsed.result = next
      index += 1
      continue
    }
    if (current === '--fresh-knowledge-cache') parsed.freshKnowledgeCache = true
    if (current === '--reuse-knowledge-cache') parsed.reuseKnowledgeCache = true
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
  try {
    const parsed = JSON.parse(await readFile(path.join(cachePath, 'stats.json'), 'utf8'))
    return {
      splitCacheHits: Number(parsed.splitCacheHits || 0),
      splitCacheMisses: Number(parsed.splitCacheMisses || 0),
      vectorCacheHits: Number(parsed.vectorCacheHits || 0),
      vectorCacheMisses: Number(parsed.vectorCacheMisses || 0)
    }
  } catch {
    return { ...EMPTY_KNOWLEDGE_CACHE_STATS }
  }
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

const runSpawn = (bin, args, env, omitNpmEnv) =>
  spawnSync(bin, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: USE_WINDOWS_SHELL && /\.(cmd|bat)$/iu.test(bin),
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
      bin: process.execPath,
      args: [VITEST_CLI, ...commandArgs]
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

const runE2ETestFilesSerially = async (testFiles, requestedDelayMs, env, testNamePattern) => {
  const e2eFileDelayMs = requestedDelayMs > 0 ? requestedDelayMs : DEFAULT_E2E_FILE_DELAY_MS
  let exitCode = 0
  const results = []

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
      exitCode = code
    }
    results.push({
      file: path.relative(ROOT, testFile),
      status: code === 0 ? 'passed' : 'failed',
      exitCode: code
    })
    if (e2eFileDelayMs > 0 && index < testFiles.length - 1) {
      process.stdout.write(
        `[test-workflow] waiting ${String(e2eFileDelayMs)}ms before next e2e file\n`
      )
      await sleep(e2eFileDelayMs)
    }
  }

  return { exitCode, results }
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
  }

  let exitCode = 0
  const e2eResults = []
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
          env: runtimeEnv,
          testNamePattern
        },
        {
          configPath: 'vitest.backend.live.config.mts',
          testFiles: liveFiles,
          env: runtimeEnv,
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
      const runResult = await runE2ETestFilesSerially(
        testFiles,
        input.runDelayMs,
        runtimeEnv,
        testNamePattern
      )
      e2eResults.push(...runResult.results)
      if (runResult.exitCode !== 0) {
        exitCode = runResult.exitCode
      }
    }

    if (runDelayMs > 0 && iteration < input.runs - 1) {
      process.stdout.write(
        `[test-workflow] waiting ${String(runDelayMs)}ms before next live run (${String(iteration + 2)}/${String(input.runs)})\n`
      )
      await sleep(runDelayMs)
    }
  }

  return { exitCode, e2eResults }
}

const main = async () => {
  removeNpmLifecycleEnv()
  const args = parseArgs(process.argv.slice(2))

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
  if (!args.domain && args.type !== 'e2e') {
    throw new Error('非纯 E2E 工作流必须提供 --domain')
  }
  if (args.target === 'package' && args.type !== 'e2e') {
    throw new Error('--target package 只能与 --type e2e 一起使用')
  }
  if (args.target === 'package' && !args.bundle) {
    throw new Error('--target package 必须提供 --bundle <release-bundle.json>')
  }
  if (args.target !== 'package' && args.bundle) {
    throw new Error('--bundle 只能与 --target package 一起使用')
  }
  if (args.target !== 'package' && args.result) {
    throw new Error('--result 只能与 --target package 一起使用')
  }
  if (args.freshKnowledgeCache && args.reuseKnowledgeCache) {
    throw new Error('--fresh-knowledge-cache 和 --reuse-knowledge-cache 不能同时使用')
  }

  const architectureValidationCode = validateTestArchitecture()
  if (architectureValidationCode !== 0) process.exit(architectureValidationCode)

  let exitCode = 0
  let packageSession = null
  let e2eEnv = {}
  let packageKnowledgeCache = null

  if (!args.type || args.type === 'e2e') {
    const validationCode = validateE2EContract()
    if (validationCode !== 0) process.exit(validationCode)
  }

  if (args.type === 'e2e' && args.target === 'package') {
    packageSession = await preparePackagedE2EApplication(args.bundle, { resultPath: args.result })
    packageKnowledgeCache = await prepareKnowledgeCache({
      namespace: 'package',
      buildFingerprint: packageSession.artifactSha256,
      fresh: args.freshKnowledgeCache,
      reuse: args.reuseKnowledgeCache
    })
    e2eEnv = { ...packageSession.env, ...packageKnowledgeCache.env }
  }

  if (!args.type || args.type === 'backend') {
    const result = await runTypeWorkflow({
      ...args,
      type: 'backend'
    })
    exitCode = result.exitCode
  }

  if (exitCode === 0 && (!args.type || args.type === 'e2e')) {
    const result = await runTypeWorkflow({
      ...args,
      type: 'e2e',
      e2eEnv
    })
    exitCode = result.exitCode
    packageSession?.writeSummary({
      status: exitCode === 0 ? 'passed' : 'failed',
      tests: result.e2eResults,
      knowledgeCache: packageKnowledgeCache
        ? {
            knowledgeCacheEnabled: packageKnowledgeCache.knowledgeCacheEnabled,
            knowledgeCachePath: packageKnowledgeCache.knowledgeCachePath,
            knowledgeCacheNamespace: packageKnowledgeCache.knowledgeCacheNamespace,
            buildFingerprint: packageKnowledgeCache.buildFingerprint,
            ...(await readKnowledgeCacheStats(packageKnowledgeCache.knowledgeCachePath))
          }
        : null
    })
  }

  process.exit(exitCode)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
