#!/usr/bin/env node
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const SUITE = 'main-ai-capability'
const REPORT_ROOT = path.resolve(process.cwd(), 'tests', 'report', SUITE)
const OUTPUT_FILE = path.join(REPORT_ROOT, 'tool-capability-assessment.md')
const TEST_ROOT = path.resolve(process.cwd(), 'tests', 'main', 'ai', 'capability')

const EXPECTED_TOOLS = {
  docx: [
    'docx_open',
    'docx_outline',
    'docx_get_block',
    'docx_search',
    'docx_apply_ops',
    'docx_get_history',
    'docx_rollback',
    'docx_render_preview',
    'docx_save',
    'docx_validate'
  ],
  terminal_exec: ['terminal_run_command'],
  local_kb_retrieval: [
    'kb_hybrid_search_chunks',
    'kb_vector_search_chunks',
    'kb_fts_search_chunks',
    'kb_list_documents'
  ]
}

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

const latestCaseDir = async (caseRoot) => {
  const dirs = await listDirectories(caseRoot)
  return dirs.sort((a, b) => b.localeCompare(a))[0] || null
}

const loadCaseReport = async (caseId) => {
  const caseRoot = path.join(REPORT_ROOT, caseId)
  const latest = await latestCaseDir(caseRoot)
  if (!latest) return null

  const reportDir = path.join(caseRoot, latest)
  const [assertions, metrics, signals] = await Promise.all([
    readJson(path.join(reportDir, 'assertions.json')),
    readJson(path.join(reportDir, 'metrics.json')),
    readJson(path.join(reportDir, 'signals.json'))
  ])

  return {
    caseId,
    reportDir,
    assertions,
    metrics,
    signals
  }
}

const buildCoverageMatrix = (cases) => {
  const byTool = new Map()

  for (const oneCase of cases) {
    const toolCounts = oneCase.signals?.toolCounts || {}
    for (const toolName of Object.keys(toolCounts)) {
      if (!byTool.has(toolName)) byTool.set(toolName, [])
      byTool.get(toolName).push(oneCase.caseId)
    }
  }

  const rows = []
  const missing = []

  for (const [family, toolList] of Object.entries(EXPECTED_TOOLS)) {
    for (const toolName of toolList) {
      const coveredBy = byTool.get(toolName) || []
      if (coveredBy.length === 0) missing.push(toolName)
      rows.push({
        family,
        toolName,
        coveredBy
      })
    }
  }

  return {
    rows,
    missing
  }
}

const summarizeExecution = (cases) => {
  const total = cases.length
  const passed = cases.filter((item) => item.assertions?.caseStatus === 'passed').length
  const failedCases = cases.filter((item) => item.assertions?.caseStatus !== 'passed')
  const explicitGapCases = cases.filter((item) => item.signals?.expectedOutcome === 'explicit_gap')
  const unexpectedExecutionCases = cases.filter((item) => {
    const expected = item.signals?.expectedOutcome || 'success'
    const status = item.metrics?.executionStatus || 'unknown'
    if (expected === 'success') return status !== 'completed'
    if (expected === 'blocked') return status !== 'blocked'
    if (expected === 'explicit_gap') return status !== 'failed'
    return false
  })

  return {
    total,
    passed,
    failedCases,
    explicitGapCases,
    unexpectedExecutionCases,
    passRate: total > 0 ? (passed / total) * 100 : 0
  }
}

const buildRecommendations = (input) => {
  const p0 = []
  const p1 = []

  if (input.failedCases.length > 0) {
    p0.push(`存在失败用例：${input.failedCases.map((item) => item.caseId).join(', ')}`)
  }

  if (input.missingTools.length > 0) {
    p0.push(`存在未覆盖工具：${input.missingTools.join(', ')}`)
  }

  if (input.unexpectedExecutionCases.length > 0) {
    p1.push(
      `存在执行语义偏差：${input.unexpectedExecutionCases
        .map((item) => `${item.caseId}(${item.metrics.executionStatus})`)
        .join(', ')}`
    )
  }

  if (input.explicitGapCases.length > 0) {
    p1.push(
      `存在显式能力缺口：${input.explicitGapCases
        .map((item) => `${item.caseId}(${item.metrics.executionResultCode})`)
        .join(', ')}`
    )
  }

  const verdict =
    p0.length > 0 ? '需要优化（P0）' : p1.length > 0 ? '基本可用（建议继续优化）' : '能力达标'

  return {
    verdict,
    p0,
    p1
  }
}

const toMarkdown = (input) => {
  const lines = []
  lines.push('# Tool Capability Assessment')
  lines.push('')
  lines.push(`- suite: ${SUITE}`)
  lines.push(`- generatedAt: ${new Date().toISOString()}`)
  lines.push(`- totalCases: ${input.execution.total}`)
  lines.push(`- passedCases: ${input.execution.passed}`)
  lines.push(`- passRate: ${input.execution.passRate.toFixed(2)}%`)
  lines.push(`- verdict: ${input.recommendations.verdict}`)
  lines.push('')
  lines.push('## Coverage Matrix')
  lines.push('| Family | Tool | Covered Cases |')
  lines.push('| --- | --- | --- |')
  for (const row of input.coverage.rows) {
    lines.push(
      `| ${row.family} | ${row.toolName} | ${row.coveredBy.length > 0 ? row.coveredBy.join(', ') : '(none)'} |`
    )
  }
  lines.push('')
  lines.push('## Explicit Gaps')
  if (input.execution.explicitGapCases.length === 0) {
    lines.push('- none')
  } else {
    for (const oneCase of input.execution.explicitGapCases) {
      lines.push(
        `- ${oneCase.caseId}: executionResultCode=${oneCase.metrics.executionResultCode}, executionStatus=${oneCase.metrics.executionStatus}`
      )
    }
  }
  lines.push('')
  lines.push('## Optimization Suggestions')
  if (input.recommendations.p0.length === 0 && input.recommendations.p1.length === 0) {
    lines.push('- 当前无需额外优化，建议继续保持回归。')
  } else {
    if (input.recommendations.p0.length > 0) {
      for (const note of input.recommendations.p0) {
        lines.push(`- P0: ${note}`)
      }
    }
    if (input.recommendations.p1.length > 0) {
      for (const note of input.recommendations.p1) {
        lines.push(`- P1: ${note}`)
      }
    }
  }

  return lines.join('\n')
}

const main = async () => {
  let caseIds = []
  try {
    caseIds = await resolveCurrentCaseIds()
  } catch {
    console.error(`failed to resolve current capability cases from: ${TEST_ROOT}`)
    process.exitCode = 1
    return
  }

  const reports = (await Promise.all(caseIds.map((caseId) => loadCaseReport(caseId)))).filter(
    (item) => item !== null
  )

  if (reports.length === 0) {
    console.error(`no case reports found under: ${REPORT_ROOT}`)
    process.exitCode = 1
    return
  }

  const coverage = buildCoverageMatrix(reports)
  const execution = summarizeExecution(reports)
  const recommendations = buildRecommendations({
    missingTools: coverage.missing,
    failedCases: execution.failedCases,
    explicitGapCases: execution.explicitGapCases,
    unexpectedExecutionCases: execution.unexpectedExecutionCases
  })

  const markdown = toMarkdown({ coverage, execution, recommendations })
  await writeFile(OUTPUT_FILE, markdown, 'utf8')
  process.stdout.write(markdown)
  process.stdout.write(`\n\nSaved: ${OUTPUT_FILE}\n`)
}

void main()
