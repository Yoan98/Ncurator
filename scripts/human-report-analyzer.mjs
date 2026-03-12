#!/usr/bin/env node
import { access, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const SUITE = 'main-ai-human'
const REPORT_ROOT = path.resolve(process.cwd(), 'tests', 'report', SUITE)
const OUTPUT_FILE = path.join(REPORT_ROOT, 'human-assessment.md')
const TEST_ROOT = path.resolve(process.cwd(), 'tests', 'main', 'ai', 'human')

const QUALITY_GRADES = [
  'hard_pass',
  'soft_pass',
  'expected_block',
  'unexpected_block',
  'harness_fail',
  'unknown'
]

const readJson = async (filePath) => {
  const raw = await readFile(filePath, 'utf8')
  return JSON.parse(raw)
}

const listDirectories = async (target) => {
  const entries = await readdir(target, { withFileTypes: true })
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
}

const listFiles = async (target) => {
  const entries = await readdir(target, { withFileTypes: true })
  return entries.filter((entry) => entry.isFile()).map((entry) => path.join(target, entry.name))
}

const extractCaseIdsFromTestSource = (source) => {
  const constantMap = new Map()
  for (const match of source.matchAll(/const\s+([A-Z0-9_]+)\s*=\s*'([^']+)'/g)) {
    constantMap.set(match[1], match[2])
  }

  const caseIds = new Set()
  for (const match of source.matchAll(/caseId:\s*('([^']+)'|([A-Z0-9_]+))/g)) {
    const literalValue = match[2]
    const constantName = match[3]
    if (literalValue) {
      caseIds.add(literalValue)
      continue
    }
    if (constantName && constantMap.has(constantName)) {
      caseIds.add(constantMap.get(constantName))
    }
  }

  return Array.from(caseIds)
}

const resolveCurrentCaseIds = async () => {
  const files = await listFiles(TEST_ROOT)
  const caseIds = new Set()

  for (const filePath of files) {
    if (!filePath.endsWith('.test.ts')) continue
    const source = await readFile(filePath, 'utf8')
    for (const caseId of extractCaseIdsFromTestSource(source)) {
      caseIds.add(caseId)
    }
  }

  return Array.from(caseIds).sort()
}

const reportDirExists = async (target) => {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

const loadRunReport = async (reportDir) => {
  const [assertions, metrics, signals] = await Promise.all([
    readJson(path.join(reportDir, 'assertions.json')),
    readJson(path.join(reportDir, 'metrics.json')),
    readJson(path.join(reportDir, 'signals.json'))
  ])

  return {
    reportDir,
    assertions,
    metrics,
    signals
  }
}

const loadCaseHistory = async (caseId) => {
  const caseRoot = path.join(REPORT_ROOT, caseId)
  if (!(await reportDirExists(caseRoot))) return null
  const runs = (await listDirectories(caseRoot)).sort()
  if (runs.length === 0) return null

  const records = await Promise.all(runs.map((runId) => loadRunReport(path.join(caseRoot, runId))))
  return {
    caseId,
    runs: records,
    latest: records.at(-1)
  }
}

const createQualityCounts = () => ({
  hard_pass: 0,
  soft_pass: 0,
  expected_block: 0,
  unexpected_block: 0,
  harness_fail: 0,
  unknown: 0
})

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

const isModernAssessmentRun = (run) => {
  return Object.prototype.hasOwnProperty.call(run.metrics || {}, 'qualityGrade')
}

const isSuccessfulRun = (run) => {
  const grade = run.metrics.qualityGrade || 'unknown'
  return grade === 'hard_pass' || grade === 'soft_pass' || grade === 'expected_block'
}

const summarizeLatestQualityCounts = (reports) => {
  const counts = createQualityCounts()

  for (const report of reports) {
    const grade = report.latest?.metrics?.qualityGrade || 'unknown'
    counts[grade] = (counts[grade] || 0) + 1
  }

  return counts
}

const summarizeHistoricalQualityCounts = (reports) => {
  const counts = createQualityCounts()

  for (const report of reports) {
    for (const run of report.runs) {
      if (!isModernAssessmentRun(run)) continue
      const grade = run.metrics.qualityGrade || 'unknown'
      counts[grade] = (counts[grade] || 0) + 1
    }
  }

  return counts
}

const buildSkillCoverage = (reports) => {
  const coverage = new Map()
  for (const report of reports) {
    const skills = report.latest?.signals?.skillActivationSequence || []
    for (const skillId of skills) {
      if (!coverage.has(skillId)) coverage.set(skillId, new Set())
      coverage.get(skillId).add(report.caseId)
    }
  }

  return Array.from(coverage.entries())
    .map(([skillId, caseIds]) => [skillId, Array.from(caseIds).sort()])
    .sort(([left], [right]) => left.localeCompare(right))
}

const collectRunTotals = (reports) => {
  let totalRuns = 0
  let totalToolErrors = 0
  let totalRepeatedToolCalls = 0
  let totalRecoveryAfterError = 0

  for (const report of reports) {
    for (const run of report.runs) {
      if (!isModernAssessmentRun(run)) continue
      totalRuns += 1
      totalToolErrors += Number(run.metrics.toolErrorCount || 0)
      totalRepeatedToolCalls += Number(run.metrics.repeatedToolCallCount || 0)
      totalRecoveryAfterError += Number(run.metrics.recoveryAfterErrorCount || 0)
    }
  }

  return {
    totalRuns,
    totalToolErrors,
    totalRepeatedToolCalls,
    totalRecoveryAfterError
  }
}

const summarizeCases = (reports) => {
  return reports.map((report) => {
    const assessmentRuns = report.runs.filter(isModernAssessmentRun)
    const qualityCounts = createQualityCounts()
    const durations = []
    const humanSteps = []
    const stepBudgetUsage = []
    let totalToolErrors = 0
    let totalRepeatedToolCalls = 0
    let totalRecoveryAfterError = 0

    for (const run of assessmentRuns) {
      const grade = run.metrics.qualityGrade || 'unknown'
      qualityCounts[grade] = (qualityCounts[grade] || 0) + 1
      durations.push(Number(run.metrics.durationMs || 0))
      humanSteps.push(Number(run.metrics.humanStepCount || 0))
      if (typeof run.metrics.stepBudgetUsage === 'number') {
        stepBudgetUsage.push(Number(run.metrics.stepBudgetUsage))
      }
      totalToolErrors += Number(run.metrics.toolErrorCount || 0)
      totalRepeatedToolCalls += Number(run.metrics.repeatedToolCallCount || 0)
      totalRecoveryAfterError += Number(run.metrics.recoveryAfterErrorCount || 0)
    }

    const successfulRuns = assessmentRuns.filter(isSuccessfulRun).length
    const softPassRuns = qualityCounts.soft_pass
    const unexpectedBlockRuns = qualityCounts.unexpected_block
    const harnessFailRuns = qualityCounts.harness_fail

    return {
      caseId: report.caseId,
      latest: report.latest,
      runCount: assessmentRuns.length,
      successfulRuns,
      successRate: assessmentRuns.length > 0 ? successfulRuns / assessmentRuns.length : 0,
      softPassRuns,
      unexpectedBlockRuns,
      harnessFailRuns,
      qualityCounts,
      medianDurationMs: median(durations),
      medianHumanSteps: median(humanSteps),
      medianStepBudgetUsage: median(stepBudgetUsage),
      totalToolErrors,
      totalRepeatedToolCalls,
      totalRecoveryAfterError
    }
  })
}

const collectFailureModes = (reports) => {
  const firstFailureStages = new Map()
  const resultCodes = new Map()

  for (const report of reports) {
    for (const run of report.runs) {
      if (!isModernAssessmentRun(run)) continue
      const grade = run.metrics.qualityGrade || 'unknown'
      if (grade === 'hard_pass' || grade === 'expected_block') continue

      const stage = String(run.signals.firstFailureStage || 'unknown')
      firstFailureStages.set(stage, (firstFailureStages.get(stage) || 0) + 1)

      const resultCode = String(run.metrics.executionResultCode || 'unknown')
      resultCodes.set(resultCode, (resultCodes.get(resultCode) || 0) + 1)
    }
  }

  return {
    firstFailureStages: Array.from(firstFailureStages.entries()).sort((left, right) => right[1] - left[1]),
    resultCodes: Array.from(resultCodes.entries()).sort((left, right) => right[1] - left[1])
  }
}

const buildRecommendations = (input) => {
  const items = []

  if (input.missingReportCases.length > 0) {
    items.push(`先补齐未生成报告的当前用例：${input.missingReportCases.join(', ')}`)
  }
  if (input.failedCases.length > 0) {
    items.push(`优先修复断言失败用例：${input.failedCases.join(', ')}`)
  }
  if (input.unexpectedBlockCases.length > 0) {
    items.push(`优先处理意外阻塞：${input.unexpectedBlockCases.join(', ')}`)
  }
  if (input.lowStabilityCases.length > 0) {
    items.push(`关键用例稳定性不足，需补多轮评估并定位 prompt/tool contract：${input.lowStabilityCases.join(', ')}`)
  }
  if (input.softPassCases.length > 0) {
    items.push(`重点优化软成功用例的重复调用或恢复成本：${input.softPassCases.join(', ')}`)
  }
  if (input.harnessFailCases.length > 0) {
    items.push(`harness_fail 仅作环境门禁，不纳入能力结论：${input.harnessFailCases.join(', ')}`)
  }
  if (input.staleReportCases.length > 0) {
    items.push(`清理或忽略 stale 报告目录：${input.staleReportCases.join(', ')}`)
  }
  if (items.length === 0) {
    items.push('当前 human 报告没有发现需要立即处理的结构性问题，可继续扩大覆盖或执行多轮评估。')
  }

  return items
}

const toMarkdown = (input) => {
  const lines = []
  lines.push('# Human Assessment')
  lines.push('')
  lines.push(`- suite: ${SUITE}`)
  lines.push(`- generatedAt: ${new Date().toISOString()}`)
  lines.push(`- currentCases: ${input.currentCaseIds.length}`)
  lines.push(`- reportedCases: ${input.reports.length}`)
  lines.push(`- totalRuns: ${input.runTotals.totalRuns}`)
  lines.push(`- latestHardPassRate: ${toPercent(input.latestQualityCounts.hard_pass, input.reports.length)}`)
  lines.push(`- latestSoftPassRate: ${toPercent(input.latestQualityCounts.soft_pass, input.reports.length)}`)
  lines.push(
    `- latestExpectedBlockRate: ${toPercent(input.latestQualityCounts.expected_block, input.reports.length)}`
  )
  lines.push(
    `- latestUnexpectedBlockRate: ${toPercent(input.latestQualityCounts.unexpected_block, input.reports.length)}`
  )
  lines.push(
    `- historicalSuccessfulRunRate: ${toPercent(input.historicalSuccessfulRuns, input.runTotals.totalRuns)}`
  )
  lines.push('')
  lines.push('## Current Cases')
  lines.push('| Case | Latest Quality | Latest Execution | Runs | Success Rate | Median Duration | Median Steps |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- |')
  for (const summary of input.caseSummaries) {
    lines.push(
      `| ${summary.caseId} | ${summary.latest.metrics.qualityGrade || 'unknown'} | ${summary.latest.metrics.executionStatus}/${summary.latest.metrics.executionResultCode} | ${summary.runCount} | ${toPercent(summary.successfulRuns, summary.runCount)} | ${summary.medianDurationMs ?? 'n/a'} | ${summary.medianHumanSteps ?? 'n/a'} |`
    )
  }

  if (input.missingReportCases.length > 0) {
    lines.push('')
    lines.push('## Missing Reports')
    for (const caseId of input.missingReportCases) {
      lines.push(`- ${caseId}`)
    }
  }

  lines.push('')
  lines.push('## Stability Signals')
  if (input.caseSummaries.length === 0) {
    lines.push('- none')
  } else {
    for (const summary of input.caseSummaries) {
      lines.push(
        `- ${summary.caseId}: success=${summary.successfulRuns}/${summary.runCount}, softPass=${summary.softPassRuns}, unexpectedBlock=${summary.unexpectedBlockRuns}, harnessFail=${summary.harnessFailRuns}, toolErrors=${summary.totalToolErrors}, repeatedToolCalls=${summary.totalRepeatedToolCalls}, recoveryAfterError=${summary.totalRecoveryAfterError}`
      )
    }
  }

  lines.push('')
  lines.push('## Skill Coverage')
  if (input.skillCoverage.length === 0) {
    lines.push('- none')
  } else {
    for (const [skillId, caseIds] of input.skillCoverage) {
      lines.push(`- ${skillId}: ${caseIds.join(', ')}`)
    }
  }

  lines.push('')
  lines.push('## Failure Modes')
  if (input.failureModes.firstFailureStages.length === 0 && input.failureModes.resultCodes.length === 0) {
    lines.push('- none')
  } else {
    if (input.failureModes.firstFailureStages.length > 0) {
      lines.push('- firstFailureStage:')
      for (const [stage, count] of input.failureModes.firstFailureStages.slice(0, 5)) {
        lines.push(`  - ${stage}: ${count}`)
      }
    }
    if (input.failureModes.resultCodes.length > 0) {
      lines.push('- executionResultCode:')
      for (const [resultCode, count] of input.failureModes.resultCodes.slice(0, 5)) {
        lines.push(`  - ${resultCode}: ${count}`)
      }
    }
  }

  lines.push('')
  lines.push('## Run Totals')
  lines.push(`- totalToolErrors: ${input.runTotals.totalToolErrors}`)
  lines.push(`- totalRepeatedToolCalls: ${input.runTotals.totalRepeatedToolCalls}`)
  lines.push(`- totalRecoveryAfterError: ${input.runTotals.totalRecoveryAfterError}`)

  lines.push('')
  lines.push('## Historical Quality Counts')
  for (const grade of QUALITY_GRADES) {
    lines.push(`- ${grade}: ${input.historicalQualityCounts[grade] || 0}`)
  }

  lines.push('')
  lines.push('## Stale Reports')
  if (input.staleReportCases.length === 0) {
    lines.push('- none')
  } else {
    for (const caseId of input.staleReportCases) {
      lines.push(`- ${caseId}`)
    }
  }

  lines.push('')
  lines.push('## Recommendations')
  for (const item of input.recommendations) {
    lines.push(`- ${item}`)
  }

  return lines.join('\n')
}

const main = async () => {
  const currentCaseIds = await resolveCurrentCaseIds()
  const allReportCaseDirs = (await reportDirExists(REPORT_ROOT)) ? await listDirectories(REPORT_ROOT) : []
  const staleReportCases = allReportCaseDirs.filter((caseId) => !currentCaseIds.includes(caseId)).sort()

  const reports = []
  const missingReportCases = []
  for (const caseId of currentCaseIds) {
    const history = await loadCaseHistory(caseId)
    if (!history) {
      missingReportCases.push(caseId)
      continue
    }
    reports.push(history)
  }

  if (reports.length === 0) {
    console.error(`no human case reports found under: ${REPORT_ROOT}`)
    process.exitCode = 1
    return
  }

  const latestQualityCounts = summarizeLatestQualityCounts(reports)
  const historicalQualityCounts = summarizeHistoricalQualityCounts(reports)
  const runTotals = collectRunTotals(reports)
  const skillCoverage = buildSkillCoverage(reports)
  const caseSummaries = summarizeCases(reports)
  const failureModes = collectFailureModes(reports)
  const failedCases = reports
    .filter(
      (report) =>
        report.latest.assertions.caseStatus !== 'passed' &&
        report.latest.metrics.qualityGrade !== 'harness_fail'
    )
    .map((report) => report.caseId)
  const harnessFailCases = caseSummaries
    .filter((summary) => summary.latest.metrics.qualityGrade === 'harness_fail')
    .map((summary) => summary.caseId)
  const softPassCases = caseSummaries
    .filter((summary) => summary.latest.metrics.qualityGrade === 'soft_pass')
    .map((summary) => summary.caseId)
  const unexpectedBlockCases = caseSummaries
    .filter((summary) => summary.latest.metrics.qualityGrade === 'unexpected_block')
    .map((summary) => summary.caseId)
  const lowStabilityCases = caseSummaries
    .filter(
      (summary) =>
        summary.runCount >= 3 &&
        summary.latest.metrics.qualityGrade !== 'harness_fail' &&
        summary.successRate < 0.8
    )
    .map((summary) => summary.caseId)
  const historicalSuccessfulRuns = caseSummaries.reduce(
    (sum, summary) => sum + summary.successfulRuns,
    0
  )

  const recommendations = buildRecommendations({
    missingReportCases,
    failedCases,
    unexpectedBlockCases,
    lowStabilityCases,
    softPassCases,
    staleReportCases,
    harnessFailCases
  })

  const markdown = toMarkdown({
    currentCaseIds,
    reports,
    missingReportCases,
    staleReportCases,
    latestQualityCounts,
    historicalQualityCounts,
    historicalSuccessfulRuns,
    runTotals,
    skillCoverage,
    caseSummaries,
    failureModes,
    recommendations
  })

  await writeFile(OUTPUT_FILE, markdown, 'utf8')
  process.stdout.write(markdown)
  process.stdout.write(`\n\nSaved: ${OUTPUT_FILE}\n`)
}

void main()
