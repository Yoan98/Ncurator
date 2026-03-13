#!/usr/bin/env node
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'
import { ARCHIVED_CASE_RECORDS } from '../tests/catalog/case-governance.mjs'

const TEST_ROOT = path.resolve(process.cwd(), 'tests')
const REPORT_ROOT = path.join(TEST_ROOT, 'report')
const CATALOG_ROOT = path.join(TEST_ROOT, 'catalog')
const CURRENT_CATALOG_JSON = path.join(CATALOG_ROOT, 'current-cases.json')
const CURRENT_CATALOG_MD = path.join(CATALOG_ROOT, 'current-cases.md')
const ARCHIVED_CATALOG_JSON = path.join(CATALOG_ROOT, 'archived-cases.json')
const ARCHIVED_CATALOG_MD = path.join(CATALOG_ROOT, 'archived-cases.md')
const REPORT_META_DIRS = new Set(['batches', 'compare'])
const REQUIRED_METADATA_FIELDS = [
  'description',
  'scenarioTags',
  'expectedOutcome',
  'requiredFixtures',
  'retentionTier',
  'lifecycle',
  'runPolicy',
  'capabilityArea'
]
const VALID_RETENTION_TIERS = new Set(['canonical', 'coverage', 'diagnostic', 'live-eval', 'archived'])
const VALID_LIFECYCLES = new Set(['active', 'quarantined', 'deprecated', 'archived'])
const VALID_RUN_POLICIES = new Set(['gating', 'non_gating', 'manual', 'batch_only'])
const VALID_EXPECTED_OUTCOMES = new Set(['success', 'blocked', 'explicit_gap', 'failure'])

const suiteFromRelativePath = (relativePath) => {
  if (relativePath.startsWith('main/ai/capability/')) return 'main-ai-capability'
  if (relativePath.startsWith('main/ai/runtime/')) return 'main-ai-runtime'
  if (relativePath.startsWith('main/ai/human/')) return 'main-ai-human'
  if (relativePath.startsWith('main/workspace/service/')) return 'main-workspace-service'
  if (relativePath.startsWith('main/workspace/migration/')) return 'main-workspace-migration'
  if (relativePath.startsWith('renderer/chat/contract/')) return 'renderer-chat-contract'
  if (relativePath.startsWith('renderer/import/contract/')) return 'renderer-import-contract'
  if (relativePath.startsWith('renderer/search/contract/')) return 'renderer-search-contract'
  if (relativePath.startsWith('e2e/chat/ai-live/')) return 'e2e-chat-ai-live'
  if (relativePath.startsWith('e2e/chat/deterministic/')) return 'e2e-chat'
  if (relativePath.startsWith('e2e/import/deterministic/')) return 'e2e-import'
  if (relativePath.startsWith('e2e/search/deterministic/')) return 'e2e-search'
  throw new Error(`unsupported test suite path: ${relativePath}`)
}

const listTestFiles = async (root) => {
  const results = []
  const walk = async (dir) => {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (
          fullPath === REPORT_ROOT ||
          fullPath === CATALOG_ROOT ||
          fullPath.includes('/harness/') ||
          fullPath.includes('/fixtures/') ||
          fullPath.includes('/unit/')
        ) {
          continue
        }
        await walk(fullPath)
        continue
      }
      if (/\.(test|spec)\.[cm]?tsx?$/.test(entry.name)) {
        results.push(fullPath)
      }
    }
  }

  await walk(root)
  return results.sort()
}

const createScopeStack = (filePath) => {
  const rootScope = new Map()
  rootScope.set('__dirname', path.dirname(filePath))
  return [rootScope]
}

const pushScope = (scopes) => [...scopes, new Map()]

const setScopedValue = (scopes, name, value) => {
  scopes[scopes.length - 1].set(name, value)
}

const getScopedValue = (scopes, name) => {
  for (let index = scopes.length - 1; index >= 0; index -= 1) {
    if (scopes[index].has(name)) return scopes[index].get(name)
  }
  return undefined
}

const evaluateExpression = (node, scopes) => {
  if (!node) return undefined
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) {
    return evaluateExpression(node.expression, scopes)
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (ts.isNumericLiteral(node)) return Number(node.text)
  if (ts.isIdentifier(node)) {
    return getScopedValue(scopes, node.text)
  }
  if (ts.isPropertyAccessExpression(node)) {
    const base = evaluateExpression(node.expression, scopes)
    if (base && typeof base === 'object' && !Array.isArray(base)) {
      return base[node.name.text]
    }
  }
  if (ts.isArrayLiteralExpression(node)) {
    const values = []
    for (const element of node.elements) {
      const resolved = evaluateExpression(element, scopes)
      if (resolved !== undefined) values.push(resolved)
    }
    return values
  }
  if (ts.isObjectLiteralExpression(node)) {
    const value = {}
    for (const property of node.properties) {
      if (ts.isSpreadAssignment(property)) {
        const resolved = evaluateExpression(property.expression, scopes)
        if (resolved && typeof resolved === 'object' && !Array.isArray(resolved)) {
          Object.assign(value, resolved)
        }
        continue
      }
      if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue
      const name = ts.isShorthandPropertyAssignment(property)
        ? property.name.text
        : ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
          ? property.name.text
          : null
      if (!name) continue
      const resolved = ts.isShorthandPropertyAssignment(property)
        ? getScopedValue(scopes, property.name.text)
        : evaluateExpression(property.initializer, scopes)
      if (resolved !== undefined) {
        value[name] = resolved
      }
    }
    return value
  }
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)) {
    const targetName = node.expression.expression.text
    const methodName = node.expression.name.text
    if (targetName === 'path' && (methodName === 'resolve' || methodName === 'join')) {
      const resolvedArgs = node.arguments
        .map((argument) => evaluateExpression(argument, scopes))
        .filter((value) => typeof value === 'string')
      if (resolvedArgs.length === node.arguments.length) {
        return methodName === 'resolve' ? path.resolve(...resolvedArgs) : path.join(...resolvedArgs)
      }
    }
  }
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'process' &&
    node.expression.name.text === 'cwd' &&
    node.arguments.length === 0
  ) {
    return process.cwd()
  }
  return undefined
}

const humanizeCaseId = (caseId) =>
  caseId
    .split('-')
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ')

const normalizeStringArray = (value) =>
  Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []

const formatSourceRef = (sourceFile, node) => {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart())
  return `${path.relative(process.cwd(), sourceFile.fileName)}:${line + 1}:${character + 1}`
}

const validateCaseMetadata = (caseId, metadata, sourceRef) => {
  for (const field of REQUIRED_METADATA_FIELDS) {
    if (!(field in metadata)) {
      throw new Error(`case ${caseId} missing metadata field "${field}" at ${sourceRef}`)
    }
  }
  if (typeof metadata.description !== 'string' || metadata.description.length === 0) {
    throw new Error(`case ${caseId} has invalid metadata.description at ${sourceRef}`)
  }
  if (!Array.isArray(metadata.scenarioTags) || metadata.scenarioTags.some((item) => typeof item !== 'string')) {
    throw new Error(`case ${caseId} has invalid metadata.scenarioTags at ${sourceRef}`)
  }
  if (
    !Array.isArray(metadata.requiredFixtures) ||
    metadata.requiredFixtures.some((item) => typeof item !== 'string')
  ) {
    throw new Error(`case ${caseId} has invalid metadata.requiredFixtures at ${sourceRef}`)
  }
  if (typeof metadata.expectedOutcome !== 'string' || !VALID_EXPECTED_OUTCOMES.has(metadata.expectedOutcome)) {
    throw new Error(`case ${caseId} has invalid metadata.expectedOutcome at ${sourceRef}`)
  }
  if (typeof metadata.retentionTier !== 'string' || !VALID_RETENTION_TIERS.has(metadata.retentionTier)) {
    throw new Error(`case ${caseId} has invalid metadata.retentionTier at ${sourceRef}`)
  }
  if (typeof metadata.lifecycle !== 'string' || !VALID_LIFECYCLES.has(metadata.lifecycle)) {
    throw new Error(`case ${caseId} has invalid metadata.lifecycle at ${sourceRef}`)
  }
  if (typeof metadata.runPolicy !== 'string' || !VALID_RUN_POLICIES.has(metadata.runPolicy)) {
    throw new Error(`case ${caseId} has invalid metadata.runPolicy at ${sourceRef}`)
  }
  if (typeof metadata.capabilityArea !== 'string' || metadata.capabilityArea.length === 0) {
    throw new Error(`case ${caseId} has invalid metadata.capabilityArea at ${sourceRef}`)
  }
}

const extractCaseObjectsFromFile = async (filePath) => {
  const sourceText = await readFile(filePath, 'utf8')
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const relativePath = path.relative(TEST_ROOT, filePath)
  const suite = suiteFromRelativePath(relativePath)
  const seenCaseIds = new Set()
  const cases = []

  const visit = (node, scopes) => {
    if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node)) {
      const nextScopes = ts.isSourceFile(node) ? scopes : pushScope(scopes)
      for (const statement of node.statements) {
        visit(statement, nextScopes)
      }
      return
    }

    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue
        const resolved = evaluateExpression(declaration.initializer, scopes)
        if (resolved !== undefined) {
          setScopedValue(scopes, declaration.name.text, resolved)
        }
        if (declaration.initializer) {
          visit(declaration.initializer, scopes)
        }
      }
      return
    }

    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
      if (node.body) {
        visit(node.body, pushScope(scopes))
      }
      return
    }

    if (ts.isObjectLiteralExpression(node)) {
      const resolved = evaluateExpression(node, scopes)
      if (resolved && typeof resolved === 'object' && !Array.isArray(resolved) && typeof resolved.caseId === 'string') {
        const caseId = resolved.caseId
        if (!seenCaseIds.has(caseId)) {
          const sourceRef = formatSourceRef(sourceFile, node)
          const metadata =
            resolved.caseMetadata && typeof resolved.caseMetadata === 'object' && !Array.isArray(resolved.caseMetadata)
              ? resolved.caseMetadata
              : resolved
          validateCaseMetadata(caseId, metadata, sourceRef)
          const descriptionValue = metadata.description
          const taskGoalValue =
            (typeof metadata.taskGoal === 'string' && metadata.taskGoal) ||
            (typeof resolved.taskGoal === 'string' && resolved.taskGoal) ||
            (typeof resolved.objective === 'string' && resolved.objective) ||
            descriptionValue

          cases.push(
            {
              suite,
              caseId,
              title: humanizeCaseId(caseId),
              description: descriptionValue,
              taskGoal: taskGoalValue,
              scenarioTags: normalizeStringArray(metadata.scenarioTags),
              expectedOutcome: metadata.expectedOutcome,
              requiredFixtures: normalizeStringArray(metadata.requiredFixtures),
              retentionTier: metadata.retentionTier,
              lifecycle: metadata.lifecycle,
              runPolicy: metadata.runPolicy,
              capabilityArea: metadata.capabilityArea,
              sourceFile: path.join('tests', relativePath),
              profiles: normalizeStringArray(metadata.profiles)
            }
          )
          seenCaseIds.add(caseId)
        }
      }
    }

    ts.forEachChild(node, (child) => visit(child, scopes))
  }

  visit(sourceFile, createScopeStack(filePath))
  return cases
}

const reportDirExists = async (target) => {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

const readJson = async (filePath) => {
  const raw = await readFile(filePath, 'utf8')
  return JSON.parse(raw)
}

const resolveLatestReportForCase = async (suite, caseId) => {
  const caseRoot = path.join(REPORT_ROOT, suite, caseId)
  if (!(await reportDirExists(caseRoot))) {
    return {
      latestReport: null,
      latestStatus: null,
      latestRunAt: null,
      latestCaseStatus: null,
      latestExecutionStatus: null,
      latestExecutionResultCode: null
    }
  }

  const entries = await readdir(caseRoot, { withFileTypes: true })
  const latestDirName = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left))[0]

  if (!latestDirName) {
    return {
      latestReport: null,
      latestStatus: null,
      latestRunAt: null,
      latestCaseStatus: null,
      latestExecutionStatus: null,
      latestExecutionResultCode: null
    }
  }

  const latestReportDir = path.join(caseRoot, latestDirName)
  const [assertions, metrics] = await Promise.all([
    readJson(path.join(latestReportDir, 'assertions.json')),
    readJson(path.join(latestReportDir, 'metrics.json'))
  ])

  return {
    latestReport: path.relative(process.cwd(), latestReportDir),
    latestStatus: `${assertions.caseStatus}/${metrics.executionStatus}`,
    latestRunAt: latestDirName,
    latestCaseStatus: assertions.caseStatus,
    latestExecutionStatus: metrics.executionStatus,
    latestExecutionResultCode: metrics.executionResultCode
  }
}

const buildCurrentCatalog = async () => {
  const testFiles = await listTestFiles(TEST_ROOT)
  const currentCases = []
  const allCaseIds = new Map()

  for (const filePath of testFiles) {
    const extractedCases = await extractCaseObjectsFromFile(filePath)
    for (const oneCase of extractedCases) {
      if (allCaseIds.has(oneCase.caseId)) {
        throw new Error(
          `duplicate current caseId detected: ${oneCase.caseId} in ${oneCase.sourceFile} and ${allCaseIds.get(oneCase.caseId)}`
        )
      }
      allCaseIds.set(oneCase.caseId, oneCase.sourceFile)
      currentCases.push(oneCase)
    }
  }

  const hydratedCases = []
  for (const oneCase of currentCases.sort((left, right) => left.caseId.localeCompare(right.caseId))) {
    hydratedCases.push({
      ...oneCase,
      ...(await resolveLatestReportForCase(oneCase.suite, oneCase.caseId))
    })
  }

  return {
    generatedAt: new Date().toISOString(),
    currentCases: hydratedCases,
    suiteCounts: hydratedCases.reduce((counts, item) => {
      counts[item.suite] = (counts[item.suite] || 0) + 1
      return counts
    }, {})
  }
}

const buildArchivedCatalog = async (currentCatalog) => {
  const currentPairs = new Set(currentCatalog.currentCases.map((item) => `${item.suite}/${item.caseId}`))
  const activeArchivedPairs = new Set(ARCHIVED_CASE_RECORDS.map((item) => `${item.suite}/${item.caseId}`))
  const unknownStaleEntries = []

  const reportSuites = await readdir(REPORT_ROOT, { withFileTypes: true })
  for (const suiteEntry of reportSuites) {
    if (!suiteEntry.isDirectory()) continue
    const suiteRoot = path.join(REPORT_ROOT, suiteEntry.name)
    const caseEntries = await readdir(suiteRoot, { withFileTypes: true })
    for (const caseEntry of caseEntries) {
      if (!caseEntry.isDirectory()) continue
      if (REPORT_META_DIRS.has(caseEntry.name)) continue
      const pair = `${suiteEntry.name}/${caseEntry.name}`
      if (currentPairs.has(pair) || activeArchivedPairs.has(pair)) continue
      unknownStaleEntries.push(pair)
    }
  }

  if (unknownStaleEntries.length > 0) {
    throw new Error(
      `archived case records missing for stale report dirs: ${unknownStaleEntries.join(', ')}`
    )
  }

  const archivedCases = []
  for (const record of ARCHIVED_CASE_RECORDS) {
    const latestReport = await resolveLatestReportForCase(record.suite, record.caseId)
    archivedCases.push({
      ...record,
      latestReport: latestReport.latestReport,
      latestStatus: latestReport.latestStatus,
      latestRunAt: latestReport.latestRunAt
    })
  }

  return {
    generatedAt: new Date().toISOString(),
    archivedCases
  }
}

const toCurrentMarkdown = (catalog) => {
  const lines = ['# Current Test Cases', '', `- generatedAt: ${catalog.generatedAt}`, '']
  const grouped = new Map()
  for (const oneCase of catalog.currentCases) {
    if (!grouped.has(oneCase.suite)) grouped.set(oneCase.suite, [])
    grouped.get(oneCase.suite).push(oneCase)
  }

  for (const suite of Array.from(grouped.keys()).sort()) {
    lines.push(`## ${suite}`)
    lines.push('')
    lines.push('| Case | Retention | Lifecycle | Run Policy | Latest | Source |')
    lines.push('| --- | --- | --- | --- | --- | --- |')
    for (const oneCase of grouped.get(suite)) {
      lines.push(
        `| ${oneCase.caseId} | ${oneCase.retentionTier} | ${oneCase.lifecycle} | ${oneCase.runPolicy} | ${oneCase.latestStatus || 'none'} | ${oneCase.sourceFile} |`
      )
    }
    lines.push('')
  }

  return lines.join('\n')
}

const toArchivedMarkdown = (catalog) => {
  const lines = ['# Archived Test Cases', '', `- generatedAt: ${catalog.generatedAt}`, '']
  lines.push('| Case | Suite | Lifecycle | Replacement | Reason |')
  lines.push('| --- | --- | --- | --- | --- |')
  for (const oneCase of catalog.archivedCases) {
    lines.push(
      `| ${oneCase.caseId} | ${oneCase.suite} | ${oneCase.lifecycle} | ${oneCase.replacementCaseId || 'none'} | ${oneCase.reason} |`
    )
  }
  return lines.join('\n')
}

const main = async () => {
  await mkdir(CATALOG_ROOT, { recursive: true })
  const currentCatalog = await buildCurrentCatalog()
  const archivedCatalog = await buildArchivedCatalog(currentCatalog)

  await writeFile(CURRENT_CATALOG_JSON, JSON.stringify(currentCatalog, null, 2), 'utf8')
  await writeFile(CURRENT_CATALOG_MD, toCurrentMarkdown(currentCatalog), 'utf8')
  await writeFile(ARCHIVED_CATALOG_JSON, JSON.stringify(archivedCatalog, null, 2), 'utf8')
  await writeFile(ARCHIVED_CATALOG_MD, toArchivedMarkdown(archivedCatalog), 'utf8')

  process.stdout.write(`Saved: ${CURRENT_CATALOG_JSON}\n`)
  process.stdout.write(`Saved: ${CURRENT_CATALOG_MD}\n`)
  process.stdout.write(`Saved: ${ARCHIVED_CATALOG_JSON}\n`)
  process.stdout.write(`Saved: ${ARCHIVED_CATALOG_MD}\n`)
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
