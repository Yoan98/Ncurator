import { readdir, readFile, stat, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = process.cwd()
const TESTS_ROOT = path.join(ROOT, 'tests')
const LOGS_ROOT = path.join(TESTS_ROOT, 'logs')
const REPORT_ROOT = path.join(TESTS_ROOT, 'report')
const FACTS_ROOT = path.join(REPORT_ROOT, 'ai', 'facts')
const PNPM_BIN = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

const parseArgs = (argv) => {
  const parsed = {
    domain: '',
    layer: '',
    suite: '',
    capability: '',
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
    if (current === '--capability' && next) {
      parsed.capability = next
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
  if (input.capability) parts.push(input.capability)
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
    .filter((filePath) => (input.caseId ? path.basename(filePath).includes(input.caseId) : true))
    .sort()
}

const runVitest = (input) => {
  const commandArgs = ['exec', 'vitest', '--config', input.configPath, 'run', ...input.testFiles]
  const result = spawnSync(PNPM_BIN, commandArgs, {
    cwd: ROOT,
    stdio: 'inherit'
  })

  if (typeof result.status === 'number') return result.status
  return 1
}

const buildE2EApp = () => {
  const result = spawnSync(PNPM_BIN, ['exec', 'electron-vite', 'build'], {
    cwd: ROOT,
    stdio: 'inherit'
  })

  if (typeof result.status === 'number') return result.status
  return 1
}

const readJson = async (filePath) => JSON.parse(await readFile(filePath, 'utf8'))

const readTimeline = async (filePath) => {
  const raw = await readFile(filePath, 'utf8')
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

const collectMetaFiles = async (target) => {
  try {
    const entries = await walk(target)
    return entries.filter((entry) => entry.endsWith('meta.json')).sort()
  } catch {
    return []
  }
}

const buildFactsMarkdown = (input) => {
  const successRate = input.totalRuns === 0 ? '0.0%' : `${((input.passedRuns / input.totalRuns) * 100).toFixed(1)}%`
  const runLines = input.runs.map((run) => {
    const relativeMeta = path.relative(ROOT, run.metaPath)
    const relativeTimeline = path.relative(ROOT, run.timelinePath)
    return `- ${run.meta.runId}: ${run.meta.status} | startedAt=${run.meta.startedAt} | meta=${relativeMeta} | timeline=${relativeTimeline}`
  })

  const failedLines = input.runs
    .filter((run) => run.meta.status === 'failed')
    .flatMap((run) => {
      const relativeTimeline = path.relative(ROOT, run.timelinePath)
      const failureMessages = run.timeline
        .filter((event) => event.status === 'failed')
        .map((event) => `  - ${event.message}`)

      if (failureMessages.length === 0) {
        return [`- ${run.meta.runId}: no explicit failed event found | timeline=${relativeTimeline}`]
      }

      return [`- ${run.meta.runId} | timeline=${relativeTimeline}`, ...failureMessages]
    })

  return [
    `# Facts: ${input.caseId}`,
    '',
    '## Overview',
    `- scope: ${input.scope}`,
    `- caseId: ${input.caseId}`,
    `- generatedAt: ${new Date().toISOString()}`,
    '',
    '## Success Rate',
    `- totalRuns: ${input.totalRuns}`,
    `- passedRuns: ${input.passedRuns}`,
    `- failedRuns: ${input.failedRuns}`,
    `- successRate: ${successRate}`,
    '',
    '## Run List',
    ...(runLines.length > 0 ? runLines : ['- none']),
    '',
    '## Failed Runs',
    ...(failedLines.length > 0 ? failedLines : ['- none']),
    '',
    '## Artifact References',
    `- logsRoot: ${path.relative(ROOT, input.logsRoot)}`,
    `- codexReportTarget: tests/report/${input.domain}/report.md`,
    `- codexSummaryTarget: tests/report/${input.domain}/current-summary.md`,
    '',
    '## Pending Codex Analysis',
    '- 读取本 facts 文档。',
    '- 必要时回看失败 run 的 meta.json 与 timeline.jsonl。',
    '- 产出或更新该业务域的 report.md。',
    '- 更新 current-summary.md。',
    '- 不得写入没有事实依据的失败原因或优化建议。'
  ].join('\n')
}

const writeFacts = async (input) => {
  const scopeParts = [FACTS_ROOT]
  if (input.layer) scopeParts.push(input.layer)
  if (input.suite) scopeParts.push(input.suite)
  if (input.capability) scopeParts.push(input.capability)
  await mkdir(path.join(...scopeParts), { recursive: true })

  const filePath = path.join(...scopeParts, `${input.caseId}.md`)
  await writeFile(filePath, buildFactsMarkdown(input), 'utf8')
}

const generateFacts = async (input) => {
  const scopeParts = [LOGS_ROOT]
  if (input.domain) scopeParts.push(input.domain)
  if (input.layer) scopeParts.push(input.layer)
  if (input.suite) scopeParts.push(input.suite)
  if (input.capability) scopeParts.push(input.capability)
  const logsRoot = path.join(...scopeParts)

  const metaFiles = await collectMetaFiles(logsRoot)
  const records = []
  for (const metaPath of metaFiles) {
    const meta = await readJson(metaPath)
    const startedAtMs = Date.parse(meta.startedAt)
    if (Number.isNaN(startedAtMs) || startedAtMs < input.sessionStart) continue
    if (input.caseId && meta.caseId !== input.caseId) continue
    const timelinePath = path.join(path.dirname(metaPath), 'timeline.jsonl')
    const timeline = await readTimeline(timelinePath)
    records.push({
      meta,
      metaPath,
      timelinePath,
      timeline
    })
  }

  const grouped = new Map()
  for (const record of records) {
    const current = grouped.get(record.meta.caseId) || []
    current.push(record)
    grouped.set(record.meta.caseId, current)
  }

  for (const [caseId, runs] of grouped.entries()) {
    const passedRuns = runs.filter((run) => run.meta.status === 'passed').length
    await writeFacts({
      domain: input.domain,
      layer: input.layer,
      suite: input.suite,
      capability: input.capability,
      caseId,
      scope: [input.domain, input.layer, input.suite, input.capability, caseId].filter(Boolean).join('/'),
      totalRuns: runs.length,
      passedRuns,
      failedRuns: runs.length - passedRuns,
      runs,
      logsRoot
    })
  }
}

const runLayerWorkflow = async (input) => {
  const testFiles = await findTestFiles(input)
  if (testFiles.length === 0) {
    process.stdout.write(`[test-workflow] no tests found for ${[input.domain, input.layer, input.suite, input.capability].filter(Boolean).join('/')}\n`)
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

  await generateFacts({
    ...input,
    sessionStart: input.sessionStart
  })

  return exitCode
}

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  const sessionStart = Date.now()

  if (!args.domain) {
    throw new Error('missing required flag: --domain')
  }

  let exitCode = 0

  if (!args.layer || args.layer === 'backend') {
    exitCode = await runLayerWorkflow({
      ...args,
      layer: 'backend',
      sessionStart
    })
  }

  if (exitCode === 0 && args.layer === 'e2e') {
    exitCode = await runLayerWorkflow({
      ...args,
      layer: 'backend',
      sessionStart
    })
  }

  if (exitCode === 0 && (!args.layer || args.layer === 'e2e')) {
    exitCode = await runLayerWorkflow({
      ...args,
      layer: 'e2e',
      sessionStart
    })
  }

  process.exit(exitCode)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
