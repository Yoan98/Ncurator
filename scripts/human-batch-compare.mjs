#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const SUITE = 'main-ai-human'
const REPORT_ROOT = path.resolve(process.cwd(), 'tests', 'report', SUITE)
const BATCH_ROOT = path.join(REPORT_ROOT, 'batches')
const COMPARE_ROOT = path.join(REPORT_ROOT, 'compare')

const printUsage = () => {
  process.stdout.write(
    [
      'Usage: node scripts/human-batch-compare.mjs --before <batchId> --after <batchId>',
      '',
      'Options:',
      '  --before <batchId>     Baseline batch id.',
      '  --after <batchId>      Candidate batch id.',
      '  --help                 Show this message.'
    ].join('\n')
  )
}

const toPercent = (value) => `${(value * 100).toFixed(2)}%`

const readJson = async (filePath) => {
  const raw = await readFile(filePath, 'utf8')
  return JSON.parse(raw)
}

const parseArgs = (argv) => {
  const options = {
    before: '',
    after: ''
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
    if (current === '--before') {
      options.before = String(argv[index + 1] || '').trim()
      index += 1
      continue
    }
    if (current === '--after') {
      options.after = String(argv[index + 1] || '').trim()
      index += 1
      continue
    }
    throw new Error(`unknown argument: ${current}`)
  }

  return options
}

const loadBatchSummary = async (batchId) => {
  const filePath = path.join(BATCH_ROOT, batchId, 'batch-summary.json')
  return readJson(filePath)
}

const summarizeGradeDelta = (beforeItem, afterItem, grade) => {
  const beforeCount = beforeItem?.qualityCounts?.[grade] || 0
  const afterCount = afterItem?.qualityCounts?.[grade] || 0
  return afterCount - beforeCount
}

const createCaseMap = (summary) =>
  new Map(summary.caseSummaries.map((item) => [item.caseId, item]))

const createCheck = (label, pass, details) => ({
  label,
  pass,
  details
})

const buildCompareSummary = (beforeSummary, afterSummary) => {
  const beforeMap = createCaseMap(beforeSummary)
  const afterMap = createCaseMap(afterSummary)
  const caseIds = Array.from(new Set([...beforeMap.keys(), ...afterMap.keys()])).sort()

  const cases = caseIds.map((caseId) => {
    const beforeItem = beforeMap.get(caseId)
    const afterItem = afterMap.get(caseId)
    const beforeSuccessRate = beforeItem?.successRate || 0
    const afterSuccessRate = afterItem?.successRate || 0
    return {
      caseId,
      before: beforeItem || null,
      after: afterItem || null,
      delta: {
        successRate: Number((afterSuccessRate - beforeSuccessRate).toFixed(4)),
        medianDurationMs:
          beforeItem?.medianDurationMs == null || afterItem?.medianDurationMs == null
            ? null
            : afterItem.medianDurationMs - beforeItem.medianDurationMs,
        medianHumanSteps:
          beforeItem?.medianHumanSteps == null || afterItem?.medianHumanSteps == null
            ? null
            : afterItem.medianHumanSteps - beforeItem.medianHumanSteps,
        totalToolErrors:
          (afterItem?.totalToolErrors || 0) - (beforeItem?.totalToolErrors || 0),
        totalRepeatedToolCalls:
          (afterItem?.totalRepeatedToolCalls || 0) - (beforeItem?.totalRepeatedToolCalls || 0),
        totalRecoveryAfterError:
          (afterItem?.totalRecoveryAfterError || 0) - (beforeItem?.totalRecoveryAfterError || 0),
        hardPass: summarizeGradeDelta(beforeItem, afterItem, 'hard_pass'),
        softPass: summarizeGradeDelta(beforeItem, afterItem, 'soft_pass'),
        expectedBlock: summarizeGradeDelta(beforeItem, afterItem, 'expected_block'),
        unexpectedBlock: summarizeGradeDelta(beforeItem, afterItem, 'unexpected_block'),
        harnessFail: summarizeGradeDelta(beforeItem, afterItem, 'harness_fail')
      }
    }
  })

  const beforeSuccessRate = beforeSummary.totals.runCount
    ? beforeSummary.totals.successfulRuns / beforeSummary.totals.runCount
    : 0
  const afterSuccessRate = afterSummary.totals.runCount
    ? afterSummary.totals.successfulRuns / afterSummary.totals.runCount
    : 0

  const compareSummary = {
    suite: SUITE,
    beforeBatchId: beforeSummary.batchId,
    afterBatchId: afterSummary.batchId,
    generatedAt: Date.now(),
    beforeProfile: beforeSummary.profile || null,
    afterProfile: afterSummary.profile || null,
    caseIds,
    totals: {
      beforeRunCount: beforeSummary.totals.runCount,
      afterRunCount: afterSummary.totals.runCount,
      beforeSuccessRate,
      afterSuccessRate,
      successRateDelta: Number((afterSuccessRate - beforeSuccessRate).toFixed(4)),
      totalToolErrorsDelta:
        (afterSummary.totals.totalToolErrors || 0) - (beforeSummary.totals.totalToolErrors || 0),
      totalRepeatedToolCallsDelta:
        (afterSummary.totals.totalRepeatedToolCalls || 0) -
        (beforeSummary.totals.totalRepeatedToolCalls || 0),
      totalRecoveryAfterErrorDelta:
        (afterSummary.totals.totalRecoveryAfterError || 0) -
        (beforeSummary.totals.totalRecoveryAfterError || 0)
    },
    cases
  }

  compareSummary.gate = evaluateCompareGate(compareSummary)
  return compareSummary
}

const addCaseCheck = (checks, regressions, label, pass, details) => {
  checks.push(createCheck(label, pass, details))
  if (!pass) regressions.push(`${label}: ${details}`)
}

const evaluateCompareGate = (summary) => {
  const checks = []
  const regressions = []
  const caseMap = new Map(summary.cases.map((item) => [item.caseId, item]))

  addCaseCheck(
    checks,
    regressions,
    'default batch success rate not below baseline',
    summary.totals.successRateDelta >= 0,
    `delta=${toPercent(summary.totals.successRateDelta)}`
  )
  addCaseCheck(
    checks,
    regressions,
    'no global repeated tool call regression',
    summary.totals.totalRepeatedToolCallsDelta <= 0,
    `delta=${summary.totals.totalRepeatedToolCallsDelta}`
  )

  for (const caseId of ['human-docx-edit', 'human-local-kb-answer']) {
    const item = caseMap.get(caseId)
    if (!item || !item.before || !item.after) {
      addCaseCheck(checks, regressions, `${caseId} present in compare`, false, 'missing before/after summary')
      continue
    }
    addCaseCheck(
      checks,
      regressions,
      `${caseId} success rate not below baseline`,
      item.delta.successRate >= 0,
      `delta=${toPercent(item.delta.successRate)}`
    )
    addCaseCheck(
      checks,
      regressions,
      `${caseId} hard pass count not below baseline`,
      item.delta.hardPass >= 0,
      `delta=${item.delta.hardPass}`
    )
    addCaseCheck(
      checks,
      regressions,
      `${caseId} no new unexpected block`,
      item.delta.unexpectedBlock <= 0,
      `delta=${item.delta.unexpectedBlock}`
    )
  }

  const multiSkill = caseMap.get('human-multi-skill-kb-then-shell')
  if (!multiSkill || !multiSkill.before || !multiSkill.after) {
    addCaseCheck(
      checks,
      regressions,
      'human-multi-skill-kb-then-shell present in compare',
      false,
      'missing before/after summary'
    )
  } else {
    addCaseCheck(
      checks,
      regressions,
      'human-multi-skill-kb-then-shell success rate not below baseline',
      multiSkill.delta.successRate >= 0,
      `delta=${toPercent(multiSkill.delta.successRate)}`
    )
    addCaseCheck(
      checks,
      regressions,
      'human-multi-skill-kb-then-shell hard pass count not below baseline',
      multiSkill.delta.hardPass >= 0,
      `delta=${multiSkill.delta.hardPass}`
    )
    addCaseCheck(
      checks,
      regressions,
      'human-multi-skill-kb-then-shell soft pass count not above baseline',
      multiSkill.delta.softPass <= 0,
      `delta=${multiSkill.delta.softPass}`
    )
    addCaseCheck(
      checks,
      regressions,
      'human-multi-skill-kb-then-shell repeated tool calls not above baseline',
      multiSkill.delta.totalRepeatedToolCalls <= 0,
      `delta=${multiSkill.delta.totalRepeatedToolCalls}`
    )
  }

  const recovery = caseMap.get('human-tool-error-recovery')
  if (!recovery || !recovery.before || !recovery.after) {
    addCaseCheck(
      checks,
      regressions,
      'human-tool-error-recovery present in compare',
      false,
      'missing before/after summary'
    )
  } else {
    addCaseCheck(
      checks,
      regressions,
      'human-tool-error-recovery success rate not below baseline',
      recovery.delta.successRate >= 0,
      `delta=${toPercent(recovery.delta.successRate)}`
    )
    addCaseCheck(
      checks,
      regressions,
      'human-tool-error-recovery soft pass count not above baseline',
      recovery.delta.softPass <= 0,
      `delta=${recovery.delta.softPass}`
    )
    addCaseCheck(
      checks,
      regressions,
      'human-tool-error-recovery repeated tool calls not above baseline',
      recovery.delta.totalRepeatedToolCalls <= 0,
      `delta=${recovery.delta.totalRepeatedToolCalls}`
    )
    addCaseCheck(
      checks,
      regressions,
      'human-tool-error-recovery recovery count not above baseline',
      recovery.delta.totalRecoveryAfterError <= 0,
      `delta=${recovery.delta.totalRecoveryAfterError}`
    )
  }

  return {
    status: regressions.length === 0 ? 'ready' : 'blocked',
    regressions,
    checks
  }
}

const toMarkdown = (summary) => {
  const lines = []
  lines.push('# Human Batch Compare')
  lines.push('')
  lines.push(`- suite: ${summary.suite}`)
  lines.push(`- beforeBatchId: ${summary.beforeBatchId}`)
  lines.push(`- afterBatchId: ${summary.afterBatchId}`)
  lines.push(`- beforeSuccessRate: ${toPercent(summary.totals.beforeSuccessRate)}`)
  lines.push(`- afterSuccessRate: ${toPercent(summary.totals.afterSuccessRate)}`)
  lines.push(`- successRateDelta: ${toPercent(summary.totals.successRateDelta)}`)
  lines.push(`- totalToolErrorsDelta: ${summary.totals.totalToolErrorsDelta}`)
  lines.push(`- totalRepeatedToolCallsDelta: ${summary.totals.totalRepeatedToolCallsDelta}`)
  lines.push(`- totalRecoveryAfterErrorDelta: ${summary.totals.totalRecoveryAfterErrorDelta}`)
  lines.push(`- gateStatus: ${summary.gate.status}`)
  lines.push('')
  lines.push('## Cases')
  lines.push('| Case | Before Success | After Success | Delta | hardPass Δ | softPass Δ | unexpectedBlock Δ | harnessFail Δ |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const item of summary.cases) {
    const beforeSuccess = item.before ? toPercent(item.before.successRate || 0) : 'n/a'
    const afterSuccess = item.after ? toPercent(item.after.successRate || 0) : 'n/a'
    const delta = toPercent(item.delta.successRate)
    lines.push(
      `| ${item.caseId} | ${beforeSuccess} | ${afterSuccess} | ${delta} | ${item.delta.hardPass} | ${item.delta.softPass} | ${item.delta.unexpectedBlock} | ${item.delta.harnessFail} |`
    )
  }
  lines.push('')
  lines.push('## Gate Checks')
  for (const check of summary.gate.checks) {
    lines.push(`- ${check.pass ? 'pass' : 'fail'}: ${check.label} (${check.details})`)
  }
  lines.push('')
  lines.push('## Regressions')
  if (summary.gate.regressions.length === 0) {
    lines.push('- none')
  } else {
    for (const item of summary.gate.regressions) {
      lines.push(`- ${item}`)
    }
  }
  return lines.join('\n')
}

const main = async () => {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printUsage()
    return
  }
  if (!options.before || !options.after) {
    throw new Error('--before and --after are required')
  }

  const [beforeSummary, afterSummary] = await Promise.all([
    loadBatchSummary(options.before),
    loadBatchSummary(options.after)
  ])
  const compareSummary = buildCompareSummary(beforeSummary, afterSummary)
  const compareId = `${options.before}-vs-${options.after}`.replace(/[^a-zA-Z0-9._-]+/g, '-')

  await mkdir(COMPARE_ROOT, { recursive: true })
  const jsonPath = path.join(COMPARE_ROOT, `${compareId}.json`)
  const markdownPath = path.join(COMPARE_ROOT, `${compareId}.md`)
  await writeFile(jsonPath, JSON.stringify(compareSummary, null, 2), 'utf8')
  await writeFile(markdownPath, toMarkdown(compareSummary), 'utf8')

  process.stdout.write(`Saved compare report: ${markdownPath}\n`)
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
