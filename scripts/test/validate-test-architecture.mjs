import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const ROOT = process.cwd()
const CASE_ROOT = path.join(ROOT, 'tests', 'case')
const PLAN_ROOT = path.join(ROOT, 'doc', 'test-plan')
const PRD_ROOT = path.join(ROOT, 'doc', 'prd')
const DOMAIN_RULES = {
  ai: { type: 'backend', plan: 'ai-test.md' },
  settings: { type: 'e2e', plan: 'settings-test.md', prd: 'settings.md', acPrefix: 'SET-' },
  workbench: { type: 'e2e', plan: 'workbench-test.md', prd: 'workbench.md', acPrefix: 'WB-' },
  unit: { type: 'backend', plan: '' }
}
const PLAN_FIELDS = ['测试类型', 'What', 'Why', 'How', 'Oracle', 'Not']

const walk = async (directory) => {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(entryPath)))
    else if (entry.isFile() && entry.name.endsWith('.test.ts')) files.push(entryPath)
  }
  return files
}

const stringConstants = (source) =>
  new Map(
    [...source.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*['"]([^'"]+)['"]/gu)].map((match) => [
      match[1],
      match[2]
    ])
  )

const resolveString = (raw, constants) => {
  const value = raw.trim()
  const quoted = value.match(/^['"]([^'"]+)['"]$/u)
  return quoted?.[1] || constants.get(value) || null
}

const fileCaseIds = (filePath, source, constants) => {
  const explicit = [...source.matchAll(/\bcaseId\s*:\s*([^,\n}]+)/gu)]
    .map((match) => resolveString(match[1], constants))
    .filter(Boolean)
  if (explicit.length > 0) return [...new Set(explicit)]
  return [path.basename(filePath).replace(/\.e2e\.test\.ts$|\.test\.ts$/u, '')]
}

const planCases = async (planName) => {
  const source = await readFile(path.join(PLAN_ROOT, planName), 'utf8')
  const headings = [...source.matchAll(/^#{4,5} `([^`]+)`\s*$/gmu)]
  return {
    source,
    cases: headings.map((heading, index) => ({
      id: heading[1],
      body: source.slice(heading.index, headings[index + 1]?.index ?? source.length)
    }))
  }
}

const failures = []
const summaries = []
const warmupFiles = []

for (const [domain, rule] of Object.entries(DOMAIN_RULES)) {
  const domainRoot = path.join(CASE_ROOT, domain)
  const files = await walk(domainRoot)
  const actualCaseIds = []

  for (const filePath of files) {
    const source = await readFile(filePath, 'utf8')
    const relativePath = path.relative(ROOT, filePath)
    const relativeParts = path.relative(domainRoot, filePath).split(path.sep)
    const expectedSuite = relativeParts.length > 1 ? relativeParts[0] : null
    const isE2E = filePath.endsWith('.e2e.test.ts')
    const constants = stringConstants(source)
    const caseIds = fileCaseIds(filePath, source, constants)
    actualCaseIds.push(...caseIds)

    if (rule.type === 'e2e' && !isE2E) failures.push(`${relativePath}: ${domain} 只允许 E2E 测试`)
    if (rule.type === 'backend' && isE2E)
      failures.push(`${relativePath}: ${domain} 只允许 backend 测试`)
    if (isE2E) {
      const executionValues = [...source.matchAll(/\bexecution\s*:\s*['"]([^'"]+)['"]/gu)].map(
        (match) => match[1]
      )
      for (const execution of executionValues) {
        if (!['normal', 'live', 'exclusive', 'warmup'].includes(execution)) {
          failures.push(`${relativePath}: unsupported E2E execution class ${execution}`)
        }
        if (execution === 'warmup') warmupFiles.push(relativePath)
      }
      if (new Set(executionValues).size > 1) {
        failures.push(`${relativePath}: one E2E file cannot mix execution classes`)
      }
    }
    if (
      domain === 'unit' &&
      (source.includes('src/renderer') || /@vitest-environment\s+jsdom/u.test(source))
    ) {
      failures.push(`${relativePath}: Unit 不允许 Renderer 或 jsdom`)
    }

    if (domain !== 'unit') {
      const declaredDomains = [...source.matchAll(/\bdomain\s*:\s*['"]([^'"]+)['"]/gu)].map(
        (match) => match[1]
      )
      for (const declaredDomain of declaredDomains) {
        if (!(declaredDomain in DOMAIN_RULES)) {
          failures.push(`${relativePath}: domain ${declaredDomain} 不在允许列表中`)
        } else if (declaredDomain !== domain) {
          failures.push(`${relativePath}: domain ${declaredDomain} 与目录 ${domain} 不一致`)
        }
      }
      const declaredSuites = [...source.matchAll(/\bsuite\s*:\s*['"]([^'"]+)['"]/gu)].map(
        (match) => match[1]
      )
      if (expectedSuite) {
        for (const suite of declaredSuites) {
          if (suite !== expectedSuite) {
            failures.push(`${relativePath}: suite ${suite} 与目录 ${expectedSuite} 不一致`)
          }
        }
      }

      const itMatches = [...source.matchAll(/\bit\s*\(\s*([^,\n]+)/gu)]
      const itCaseIds = itMatches.map((match) => resolveString(match[1], constants)).filter(Boolean)
      const hasDynamicIt = itMatches.length > itCaseIds.length
      for (const itCaseId of itCaseIds) {
        if (!caseIds.includes(itCaseId)) {
          failures.push(`${relativePath}: 外层 it 名称 ${itCaseId} 没有对应 caseId`)
        }
      }
      for (const caseId of caseIds) {
        if (!itCaseIds.includes(caseId) && !hasDynamicIt) {
          failures.push(`${relativePath}: caseId ${caseId} 与外层 it 名称不一致`)
        }
      }
      const runnerName = rule.type === 'e2e' ? 'runE2ECase' : 'runBackendCase'
      const runnerCount = [
        ...source.matchAll(new RegExp(`\\b${runnerName}(?:<[^;{}]+>)?\\s*\\(`, 'gu'))
      ].length
      if (runnerCount < itMatches.length) {
        failures.push(
          `${relativePath}: ${itMatches.length} 个 it 只找到 ${runnerCount} 个 ${runnerName}`
        )
      }
    }
  }

  if (rule.plan) {
    const duplicates = actualCaseIds.filter(
      (caseId, index, values) => values.indexOf(caseId) !== index
    )
    for (const caseId of new Set(duplicates)) failures.push(`${domain}: 重复 caseId ${caseId}`)

    const plan = await planCases(rule.plan)
    const plannedCaseIds = plan.cases.map((item) => item.id)
    const planned = new Set(plannedCaseIds)
    const actual = new Set(actualCaseIds)
    for (const item of plan.cases) {
      for (const field of PLAN_FIELDS) {
        if (!new RegExp(`^- ${field}：`, 'mu').test(item.body)) {
          failures.push(`${rule.plan}: case ${item.id} 缺少 ${field}`)
        }
      }
    }
    for (const caseId of planned) {
      if (!actual.has(caseId)) failures.push(`${rule.plan}: case ${caseId} 没有实际测试`)
    }
    for (const caseId of actual) {
      if (!planned.has(caseId)) failures.push(`${domain}: case ${caseId} 未登记到 ${rule.plan}`)
    }

    if (rule.prd) {
      const prd = await readFile(path.join(PRD_ROOT, rule.prd), 'utf8')
      const acPattern = new RegExp(`\\b${rule.acPrefix}[A-Z0-9-]+-AC\\d+\\b`, 'gu')
      const prdAcs = new Set(prd.match(acPattern) || [])
      const planAcs = new Set(plan.source.match(acPattern) || [])
      for (const ac of prdAcs) {
        const requirementId = ac.replace(/-AC\d+$/u, '')
        if (!planAcs.has(ac) && !plan.source.includes(`\`${requirementId}\``)) {
          failures.push(`${rule.plan}: 未覆盖 ${ac}`)
        }
      }
      for (const ac of planAcs) {
        if (!prdAcs.has(ac)) failures.push(`${rule.plan}: 引用了不存在的 ${ac}`)
      }
    }
    summaries.push(`${domain} ${String(files.length)} files / ${String(actual.size)} cases`)
  } else {
    summaries.push(`${domain} ${String(files.length)} files`)
  }
}

if (warmupFiles.length !== 1) {
  failures.push(
    `E2E must declare exactly one vector warm-up file; found ${String(warmupFiles.length)}: ${warmupFiles.join(', ') || '(none)'}`
  )
}

if (failures.length > 0) {
  throw new Error(`测试架构校验失败：\n${failures.map((item) => `- ${item}`).join('\n')}`)
}

process.stdout.write(`[test-architecture] ${summaries.join(', ')}\n`)
