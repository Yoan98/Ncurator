import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const ROOT = process.cwd()
const CASE_ROOT = path.join(ROOT, 'tests', 'case')
const DOMAIN_RULES = {
  ai: { type: 'backend', plan: 'ai-test.md' },
  settings: { type: 'e2e', plan: 'settings-test.md' },
  workbench: { type: 'e2e', plan: 'workbench-test.md' },
  unit: { type: 'backend', plan: '' }
}

const walk = async (directory) => {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(entryPath)))
    else if (entry.isFile() && entry.name.endsWith('.test.ts')) files.push(entryPath)
  }
  return files
}

const fileCaseIds = (filePath, source) => {
  const explicit = [...source.matchAll(/\bcaseId\s*:\s*['"]([^'"]+)['"]/gu)].map(
    (match) => match[1]
  )
  if (explicit.length > 0) return explicit
  return [path.basename(filePath).replace(/\.e2e\.test\.ts$|\.test\.ts$/u, '')]
}

const planCaseIds = async (planName) => {
  const source = await readFile(path.join(ROOT, 'doc', 'test-plan', planName), 'utf8')
  return [...source.matchAll(/^#{4,5} `([^`]+)`\s*$/gmu)].map((match) => match[1])
}

const failures = []
const summaries = []

for (const [domain, rule] of Object.entries(DOMAIN_RULES)) {
  const domainRoot = path.join(CASE_ROOT, domain)
  const files = await walk(domainRoot)
  const actualCaseIds = []

  for (const filePath of files) {
    const source = await readFile(filePath, 'utf8')
    const relativePath = path.relative(ROOT, filePath)
    const isE2E = filePath.endsWith('.e2e.test.ts')

    if (rule.type === 'e2e' && !isE2E) {
      failures.push(`${relativePath}: ${domain} 只允许 E2E 测试`)
    }
    if (rule.type === 'backend' && isE2E) {
      failures.push(`${relativePath}: ${domain} 只允许 backend 测试`)
    }
    if (
      domain === 'unit' &&
      (source.includes('src/renderer') || /@vitest-environment\s+jsdom/u.test(source))
    ) {
      failures.push(`${relativePath}: Unit 不允许 Renderer 或 jsdom`)
    }

    actualCaseIds.push(...fileCaseIds(filePath, source))
  }

  if (rule.plan) {
    const duplicates = actualCaseIds.filter(
      (caseId, index, values) => values.indexOf(caseId) !== index
    )
    for (const caseId of new Set(duplicates)) {
      failures.push(`${domain}: 重复 caseId ${caseId}`)
    }
    const plannedCaseIds = await planCaseIds(rule.plan)
    const planned = new Set(plannedCaseIds)
    const actual = new Set(actualCaseIds)
    for (const caseId of planned) {
      if (!actual.has(caseId)) failures.push(`${rule.plan}: case ${caseId} 没有实际测试`)
    }
    for (const caseId of actual) {
      if (!planned.has(caseId)) failures.push(`${domain}: case ${caseId} 未登记到 ${rule.plan}`)
    }
    summaries.push(`${domain} ${String(files.length)} files / ${String(actual.size)} cases`)
  } else {
    summaries.push(`${domain} ${String(files.length)} files`)
  }
}

if (failures.length > 0) {
  throw new Error(`测试架构校验失败：\n${failures.map((item) => `- ${item}`).join('\n')}`)
}

process.stdout.write(`[test-architecture] ${summaries.join(', ')}\n`)
