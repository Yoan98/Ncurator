#!/usr/bin/env node
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { listActiveCurrentCasesBySuite } from './lib/testCatalog.mjs'

const SUITE = 'main-ai-human'
const REPORT_ROOT = path.resolve(process.cwd(), 'tests', 'report', SUITE)
const BATCH_ROOT = path.join(REPORT_ROOT, 'batches')

const QUALITY_GRADES = [
  'hard_pass',
  'soft_pass',
  'expected_block',
  'unexpected_block',
  'harness_fail',
  'unknown'
]

const DEFAULT_PROFILES = ['p2-default']

const printUsage = () => {
  process.stdout.write(
    [
      'Usage: node scripts/human-batch-runner.mjs [options]',
      '',
      'Options:',
      '  --profile <name>       Case profile to run. Default: p2-default',
      '  --case <caseId>        Add one case id manually. Can be repeated.',
      '  --runs <count>         Runs per case. Default: 5',
      '  --batch-id <id>        Output batch id. Default: timestamp',
      '  --no-analyze           Skip global human assessment refresh.',
      '  --dry-run              Print run plan without executing vitest.',
      '  --help                 Show this message.',
      '',
      'Built-in profiles:',
      ...DEFAULT_PROFILES.map((profileId) => `  - ${profileId}`)
    ].join('\n')
  )
}

const pad2 = (value) => String(value).padStart(2, '0')

const createTimestampId = () => {
  const date = new Date()
  const year = date.getFullYear()
  const month = pad2(date.getMonth() + 1)
  const day = pad2(date.getDate())
  const hour = pad2(date.getHours())
  const minute = pad2(date.getMinutes())
  const second = pad2(date.getSeconds())
  return `${year}-${month}-${day}_${hour}-${minute}-${second}`
}

const toPercent = (value, total) => {
  if (total === 0) return '0.00%'
  return `${((value / total) * 100).toFixed(2)}%`
}

const median = (values) => {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle]
  return Number(((sorted[middle - 1] + sorted[middle]) / 2).toFixed(2))
}

const createQualityCounts = () => ({
  hard_pass: 0,
  soft_pass: 0,
  expected_block: 0,
  unexpected_block: 0,
  harness_fail: 0,
  unknown: 0
})

const isSuccessfulGrade = (grade) =>
  grade === 'hard_pass' || grade === 'soft_pass' || grade === 'expected_block'

const sanitizeBatchId = (value) =>
  String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')

const listDirectories = async (target) => {
  try {
    const entries = await readdir(target, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  } catch {
    return []
  }
}

const readJson = async (filePath) => {
  const raw = await readFile(filePath, 'utf8')
  return JSON.parse(raw)
}

const resolveCurrentHumanCases = async () => listActiveCurrentCasesBySuite(SUITE)

const resolveCaseFileMap = async () => {
  const currentCases = await resolveCurrentHumanCases()
  const mapping = new Map()

  for (const oneCase of currentCases) {
    if (mapping.has(oneCase.caseId)) {
      throw new Error(`duplicate human caseId mapping detected in current catalog: ${oneCase.caseId}`)
    }
    mapping.set(oneCase.caseId, path.resolve(process.cwd(), oneCase.sourceFile))
  }

  return mapping
}

const resolveProfileCaseIds = async (profileId) => {
  if (!profileId) return []
  const currentCases = await resolveCurrentHumanCases()
  return currentCases
    .filter((item) => Array.isArray(item.profiles) && item.profiles.includes(profileId))
    .map((item) => item.caseId)
    .sort()
}

const parseArgs = (argv) => {
  const options = {
    profile: 'p2-default',
    caseIds: [],
    runs: 5,
    batchId: '',
    analyze: true,
    dryRun: false
  }

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]

    if (current === '--') {
      continue
    }
    if (current === '--help') {
      options.help = true
      continue
    }
    if (current === '--profile') {
      options.profile = String(argv[index + 1] || '').trim()
      index += 1
      continue
    }
    if (current === '--case') {
      const caseId = String(argv[index + 1] || '').trim()
      if (!caseId) throw new Error('--case requires a value')
      options.caseIds.push(caseId)
      index += 1
      continue
    }
    if (current === '--runs') {
      const parsed = Number.parseInt(String(argv[index + 1] || ''), 10)
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error('--runs must be a positive integer')
      }
      options.runs = parsed
      index += 1
      continue
    }
    if (current === '--batch-id') {
      options.batchId = sanitizeBatchId(argv[index + 1])
      if (!options.batchId) {
        throw new Error('--batch-id must contain at least one valid character')
      }
      index += 1
      continue
    }
    if (current === '--no-analyze') {
      options.analyze = false
      continue
    }
    if (current === '--dry-run') {
      options.dryRun = true
      continue
    }

    throw new Error(`unknown argument: ${current}`)
  }

  return options
}

const summarizeRuns = (runRecords) => {
  const qualityCounts = createQualityCounts()
  const durations = []
  const humanSteps = []
  const stepBudgetUsage = []
  let successfulRuns = 0
  let totalToolErrors = 0
  let totalRepeatedToolCalls = 0
  let totalRecoveryAfterError = 0

  for (const run of runRecords) {
    const grade = run.metrics.qualityGrade || 'unknown'
    qualityCounts[grade] = (qualityCounts[grade] || 0) + 1
    if (isSuccessfulGrade(grade)) successfulRuns += 1
    durations.push(Number(run.metrics.durationMs || 0))
    humanSteps.push(Number(run.metrics.humanStepCount || 0))
    if (typeof run.metrics.stepBudgetUsage === 'number') {
      stepBudgetUsage.push(Number(run.metrics.stepBudgetUsage))
    }
    totalToolErrors += Number(run.metrics.toolErrorCount || 0)
    totalRepeatedToolCalls += Number(run.metrics.repeatedToolCallCount || 0)
    totalRecoveryAfterError += Number(run.metrics.recoveryAfterErrorCount || 0)
  }

  return {
    runCount: runRecords.length,
    successfulRuns,
    successRate: runRecords.length === 0 ? 0 : Number((successfulRuns / runRecords.length).toFixed(4)),
    qualityCounts,
    medianDurationMs: median(durations),
    medianHumanSteps: median(humanSteps),
    medianStepBudgetUsage: median(stepBudgetUsage),
    totalToolErrors,
    totalRepeatedToolCalls,
    totalRecoveryAfterError
  }
}

const buildBatchSummary = (input) => {
  const caseSummaries = input.caseIds.map((caseId) => {
    const runRecords = input.runRecords.filter((record) => record.caseId === caseId)
    return {
      caseId,
      testFile: input.caseFileMap.get(caseId),
      ...summarizeRuns(runRecords),
      runs: runRecords
    }
  })

  const totals = summarizeRuns(input.runRecords)
  return {
    suite: SUITE,
    batchId: input.batchId,
    status: input.status,
    profile: input.profile,
    caseIds: input.caseIds,
    requestedRunsPerCase: input.runs,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    analyzeUpdatedGlobalAssessment: input.analyze,
    caseSummaries,
    totals
  }
}

const toBatchMarkdown = (summary) => {
  const lines = []
  lines.push('# Human Batch Assessment')
  lines.push('')
  lines.push(`- suite: ${summary.suite}`)
  lines.push(`- batchId: ${summary.batchId}`)
  lines.push(`- status: ${summary.status || 'completed'}`)
  lines.push(`- profile: ${summary.profile || 'custom'}`)
  lines.push(`- requestedRunsPerCase: ${summary.requestedRunsPerCase}`)
  lines.push(`- caseCount: ${summary.caseIds.length}`)
  lines.push(`- totalRuns: ${summary.totals.runCount}`)
  lines.push(`- successRate: ${toPercent(summary.totals.successfulRuns, summary.totals.runCount)}`)
  lines.push('')
  lines.push('## Cases')
  lines.push('| Case | Runs | Success Rate | hard | soft | expected_block | unexpected_block | harness_fail | Median Duration | Median Steps |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const item of summary.caseSummaries) {
    lines.push(
      `| ${item.caseId} | ${item.runCount} | ${toPercent(item.successfulRuns, item.runCount)} | ${item.qualityCounts.hard_pass} | ${item.qualityCounts.soft_pass} | ${item.qualityCounts.expected_block} | ${item.qualityCounts.unexpected_block} | ${item.qualityCounts.harness_fail} | ${item.medianDurationMs ?? 'n/a'} | ${item.medianHumanSteps ?? 'n/a'} |`
    )
  }

  lines.push('')
  lines.push('## Totals')
  for (const grade of QUALITY_GRADES) {
    lines.push(`- ${grade}: ${summary.totals.qualityCounts[grade] || 0}`)
  }
  lines.push(`- totalToolErrors: ${summary.totals.totalToolErrors}`)
  lines.push(`- totalRepeatedToolCalls: ${summary.totals.totalRepeatedToolCalls}`)
  lines.push(`- totalRecoveryAfterError: ${summary.totals.totalRecoveryAfterError}`)

  lines.push('')
  lines.push('## Run Records')
  for (const item of summary.caseSummaries) {
    lines.push(`- ${item.caseId}:`)
    for (const run of item.runs) {
      lines.push(
        `  - run-${pad2(run.runIndex)}: ${run.metrics.qualityGrade || 'unknown'} / ${run.metrics.executionStatus}/${run.metrics.executionResultCode} / duration=${run.metrics.durationMs}`
      )
    }
  }

  return lines.join('\n')
}

const findNewReportDir = async (caseId, beforeRunDirs) => {
  const afterRunDirs = await listDirectories(path.join(REPORT_ROOT, caseId))
  const created = afterRunDirs.filter((item) => !beforeRunDirs.includes(item))
  if (created.length === 0) {
    throw new Error(`no new report generated for ${caseId}; check AI_LIVE_ENABLE and live model env`)
  }
  return created.sort().at(-1)
}

const runVitestCase = (testFile) => {
  return spawnSync(
    'pnpm',
    ['exec', 'vitest', '--config', 'vitest.ai.config.mts', 'run', testFile],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit'
    }
  )
}

const refreshGlobalAssessment = () => {
  const result = spawnSync('node', ['scripts/human-report-analyzer.mjs'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit'
  })

  if (result.status !== 0) {
    throw new Error(`human assessment refresh failed with exit code ${result.status ?? 'unknown'}`)
  }
}

const saveBatchSummary = async (input) => {
  const summary = buildBatchSummary(input)
  const summaryJsonPath = path.join(input.batchDir, 'batch-summary.json')
  const summaryMarkdownPath = path.join(input.batchDir, 'batch-summary.md')
  await writeFile(summaryJsonPath, JSON.stringify(summary, null, 2), 'utf8')
  await writeFile(summaryMarkdownPath, toBatchMarkdown(summary), 'utf8')
  return summaryMarkdownPath
}

const isInterruptedVitestRun = (result) => result.status === 130 || result.signal === 'SIGINT'

const copyRunReportIntoBatch = async (input) => {
  const sourceReportDir = path.join(REPORT_ROOT, input.caseId, input.reportDirName)
  const batchCaseDir = path.join(
    input.batchDir,
    'cases',
    input.caseId,
    `run-${pad2(input.runIndex)}`
  )
  await mkdir(path.dirname(batchCaseDir), { recursive: true })
  await cp(sourceReportDir, batchCaseDir, { recursive: true })

  const [assertions, metrics, signals] = await Promise.all([
    readJson(path.join(sourceReportDir, 'assertions.json')),
    readJson(path.join(sourceReportDir, 'metrics.json')),
    readJson(path.join(sourceReportDir, 'signals.json'))
  ])

  return {
    caseId: input.caseId,
    runIndex: input.runIndex,
    testFile: input.testFile,
    sourceReportDir,
    batchReportDir: batchCaseDir,
    assertions,
    metrics,
    signals
  }
}

const main = async () => {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printUsage()
    return
  }

  const caseFileMap = await resolveCaseFileMap()
  const profileCaseIds = await resolveProfileCaseIds(options.profile)
  if (options.profile && profileCaseIds.length === 0 && options.caseIds.length === 0) {
    throw new Error(`profile has no active human cases in current catalog: ${options.profile}`)
  }
  const caseIds = Array.from(new Set([...profileCaseIds, ...options.caseIds])).sort()

  if (caseIds.length === 0) {
    throw new Error('no human cases selected')
  }

  for (const caseId of caseIds) {
    if (!caseFileMap.has(caseId)) {
      throw new Error(`unknown human caseId: ${caseId}`)
    }
  }

  const batchId = options.batchId || createTimestampId()
  const batchDir = path.join(BATCH_ROOT, batchId)

  process.stdout.write(
    [
      `Human batch plan: ${batchId}`,
      `- profile: ${options.profile || 'custom'}`,
      `- runs per case: ${options.runs}`,
      `- cases: ${caseIds.join(', ')}`,
      `- dryRun: ${options.dryRun ? 'yes' : 'no'}`
    ].join('\n')
  )
  process.stdout.write('\n')

  if (options.dryRun) return

  const startedAt = Date.now()
  const runRecords = []
  let summaryPath = ''
  let batchStarted = false
  let interrupted = false
  let pendingError = null
  let assessmentRefreshed = false
  let shouldRefreshAssessment = false
  let interruptRequested = false
  const handleSigint = () => {
    interruptRequested = true
    process.stderr.write(
      '\nReceived SIGINT, stopping after the current run and saving a partial batch summary.\n'
    )
  }

  process.once('SIGINT', handleSigint)

  try {
    await mkdir(batchDir, { recursive: true })
    batchStarted = true

    batchLoop: for (const caseId of caseIds) {
      const testFile = caseFileMap.get(caseId)
      for (let runIndex = 1; runIndex <= options.runs; runIndex += 1) {
        if (interruptRequested) {
          interrupted = true
          break batchLoop
        }

        const beforeRunDirs = await listDirectories(path.join(REPORT_ROOT, caseId))
        process.stdout.write(`Running ${caseId} (${runIndex}/${options.runs})\n`)
        const vitestResult = runVitestCase(testFile)

        let newReportDirName = ''
        try {
          newReportDirName = await findNewReportDir(caseId, beforeRunDirs)
        } catch (error) {
          if (vitestResult.status === 0 && !vitestResult.error) {
            throw error
          }
        }

        if (newReportDirName) {
          runRecords.push(
            await copyRunReportIntoBatch({
              batchDir,
              caseId,
              reportDirName: newReportDirName,
              runIndex,
              testFile
            })
          )
          shouldRefreshAssessment = true
        }

        if (vitestResult.error) {
          throw vitestResult.error
        }
        if (vitestResult.status !== 0) {
          if (interruptRequested || isInterruptedVitestRun(vitestResult)) {
            interrupted = true
            break batchLoop
          }
          throw new Error(
            `vitest run failed for ${testFile} with exit code ${vitestResult.status ?? 'unknown'}`
          )
        }

        if (interruptRequested) {
          interrupted = true
          break batchLoop
        }
      }
    }
  } catch (error) {
    pendingError = error
  } finally {
    process.off('SIGINT', handleSigint)
  }

  if (batchStarted) {
    try {
      if (options.analyze && shouldRefreshAssessment) {
        process.stdout.write('Refreshing global human assessment\n')
        refreshGlobalAssessment()
        assessmentRefreshed = true
      }
    } catch (error) {
      pendingError ||= error
    }

    const finishedAt = Date.now()
    summaryPath = await saveBatchSummary({
      batchDir,
      batchId,
      status: interrupted ? 'partial_interrupted' : pendingError ? 'failed' : 'completed',
      profile: options.profile,
      caseIds,
      runs: options.runs,
      analyze: options.analyze && assessmentRefreshed,
      startedAt,
      finishedAt,
      caseFileMap,
      runRecords
    })
  }

  if (summaryPath) {
    process.stdout.write(`Saved batch summary: ${summaryPath}\n`)
  }

  if (pendingError) {
    throw pendingError
  }

  if (interrupted) {
    process.exitCode = 130
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
