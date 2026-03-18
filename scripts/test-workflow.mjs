import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = process.cwd()
const TESTS_ROOT = path.join(ROOT, 'tests')
const resolveLocalBin = (name) =>
  path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name)
const VITEST_BIN = resolveLocalBin('vitest')
const ELECTRON_VITE_BIN = resolveLocalBin('electron-vite')

const parseArgs = (argv) => {
  const parsed = {
    domain: '',
    layer: '',
    suite: '',
    groups: [],
    caseId: '',
    runs: 1
  }

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    const next = argv[index + 1]
    if (current === '--domain' && next) {
      parsed.domain = next
      index += 1
      continue
    }
    if (current === '--layer' && next) {
      parsed.layer = next
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
    }
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

const resolveScopeDir = (input) => {
  const parts = [TESTS_ROOT]
  if (input.domain) parts.push(input.domain)
  if (input.layer) parts.push(input.layer)
  if (input.suite) parts.push(input.suite)
  if (input.groups.length > 0) parts.push(...input.groups)
  return path.join(...parts)
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
  return allFiles
    .filter((filePath) => filePath.endsWith('.test.ts'))
    .filter((filePath) => {
      if (input.caseId || input.groups.length > 0) return true
      const segments = filePath.split(path.sep)
      return !segments.includes('live')
    })
    .filter((filePath) => {
      if (!input.caseId) return true
      return path.basename(filePath, '.test.ts') === input.caseId
    })
    .sort()
}

const runVitest = (input) => {
  const commandArgs = ['--config', input.configPath, 'run', ...input.testFiles]
  const result = spawnSync(VITEST_BIN, commandArgs, {
    cwd: ROOT,
    stdio: 'inherit'
  })

  if (typeof result.status === 'number') return result.status
  return 1
}

const buildE2EApp = () => {
  const result = spawnSync(ELECTRON_VITE_BIN, ['build'], {
    cwd: ROOT,
    stdio: 'inherit'
  })

  if (typeof result.status === 'number') return result.status
  return 1
}

const formatScope = (input) =>
  [input.domain, input.layer, input.suite, ...input.groups].filter(Boolean).join('/')

const runLayerWorkflow = async (input) => {
  const testFiles = await findTestFiles(input)
  if (testFiles.length === 0) {
    process.stdout.write(`[test-workflow] no tests found for ${formatScope(input)}\n`)
    return 0
  }

  if (input.layer === 'e2e') {
    const buildCode = buildE2EApp()
    if (buildCode !== 0) {
      return buildCode
    }
  }

  let exitCode = 0
  for (let iteration = 0; iteration < input.runs; iteration += 1) {
    const code = runVitest({
      configPath: input.layer === 'backend' ? 'vitest.backend.config.mts' : 'vitest.e2e.config.mts',
      testFiles
    })
    if (code !== 0) {
      exitCode = code
      break
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

  if (!args.layer || args.layer === 'backend') {
    exitCode = await runLayerWorkflow({
      ...args,
      layer: 'backend'
    })
  }

  if (exitCode === 0 && args.layer === 'e2e') {
    exitCode = await runLayerWorkflow({
      ...args,
      layer: 'backend'
    })
  }

  if (exitCode === 0 && (!args.layer || args.layer === 'e2e')) {
    exitCode = await runLayerWorkflow({
      ...args,
      layer: 'e2e'
    })
  }

  process.exit(exitCode)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
