import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const ROOT = process.cwd()
const CASE_ROOT = path.join(ROOT, 'tests', 'case')
const PLAN_ROOT = path.join(ROOT, 'doc', 'test-plan')
const PRD_ROOT = path.join(ROOT, 'doc', 'prd')
const DOMAIN_RULES = {
  ai: { type: 'backend', plan: 'ai-test.md' },
  knowledge: { type: 'backend', plan: 'knowledge-test.md' },
  settings: { type: 'e2e', plan: 'settings-test.md', prd: 'settings.md', acPrefixes: ['SET'] },
  workbench: {
    type: 'e2e',
    plan: 'workbench-test.md',
    prd: 'workbench.md',
    acPrefixes: ['WB', 'ST']
  },
  unit: { type: 'backend', plan: '' }
}
const PLAN_FIELDS = ['测试类型', 'What', 'Why', 'How', 'Oracle']

// References register acceptance ownership; they do not prove assertion coverage.
const acceptanceReferences = (source, prefixes) => {
  const text = source.replaceAll('`', '')
  const pattern = new RegExp(`\\b((?:${prefixes.join('|')})-[A-Z0-9-]+)-AC(\\d+)\\b`, 'gu')
  const references = new Set()
  for (const match of text.matchAll(pattern)) {
    const requirement = match[1]
    let last = Number(match[2])
    references.add(`${requirement}-AC${last}`)
    let tail = text.slice(match.index + match[0].length)
    const continuation = new RegExp(`^\\s*(/|、|至|到|–|—)\\s*(?:${requirement}-)?AC(\\d+)\\b`, 'u')
    for (let next = tail.match(continuation); next; next = tail.match(continuation)) {
      const end = Number(next[2])
      if (['至', '到', '–', '—'].includes(next[1])) {
        if (end < last || end - last > 1000) throw new Error(`无效验收范围：${match[0]}${next[0]}`)
        for (let number = last; number <= end; number++)
          references.add(`${requirement}-AC${number}`)
      } else {
        references.add(`${requirement}-AC${end}`)
      }
      last = end
      tail = tail.slice(next[0].length)
    }
  }
  return references
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

const stringConstants = (source) =>
  new Map(
    [...source.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*['"]([^'"]+)['"]/gu)].map((match) => [
      match[1],
      match[2]
    ])
  )

const fixturePathConstants = (source) =>
  new Set(
    [...source.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=[^;]*tests\/fixtures[^;]*;/gu)].map(
      (match) => match[1]
    )
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
      body: source
        .slice(heading.index, headings[index + 1]?.index ?? source.length)
        .split(/\n#{1,3} /u)[0]
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
    if (domain === 'unit' && /\bcreate[A-Za-z0-9]+ToolRuntime\b/u.test(source)) {
      failures.push(
        `${relativePath}: 完整生产工具 runtime 流程必须放到 ai/tool，不允许由 Unit 直接拥有`
      )
    }
    const fixtureConstants = fixturePathConstants(source)
    const writeTargetArgIndex = {
      writeFile: 0,
      appendFile: 0,
      writeFileSync: 0,
      appendFileSync: 0,
      mkdir: 0,
      mkdirSync: 0,
      rm: 0,
      rmSync: 0,
      unlink: 0,
      unlinkSync: 0,
      copyFile: 1,
      copyFileSync: 1,
      cp: 1,
      rename: 1,
      renameSync: 1
    }
    const writeOpPattern = new RegExp(
      `\\b(${Object.keys(writeTargetArgIndex).join('|')})\\s*\\(`,
      'gu'
    )
    const extractArgs = (sourceText, argsStart) => {
      const args = []
      let depth = 1
      let current = ''
      let inString = null
      for (let index = argsStart; index < sourceText.length && depth > 0; index += 1) {
        const char = sourceText[index]
        if (inString) {
          current += char
          if (char === inString && sourceText[index - 1] !== '\\') inString = null
        } else if (char === '"' || char === "'" || char === '`') {
          inString = char
          current += char
        } else if (char === '(') {
          depth += 1
          current += char
        } else if (char === ')') {
          depth -= 1
          if (depth === 0) {
            args.push(current)
            break
          }
          current += char
        } else if (char === ',' && depth === 1) {
          args.push(current)
          current = ''
        } else {
          current += char
        }
      }
      return args
    }
    for (const match of source.matchAll(writeOpPattern)) {
      const targetIndex = writeTargetArgIndex[match[1]]
      const targetArg = extractArgs(source, match.index + match[0].length)[targetIndex] ?? ''
      const targetsFixture =
        targetArg.includes('tests/fixtures') ||
        /path\.(?:resolve|join)\(\s*['"`](?:[^'"`,)]*,\s*)?fixtures['"`]/u.test(targetArg) ||
        [...fixtureConstants].some((name) => new RegExp(`\\b${name}\\b`, 'u').test(targetArg))
      if (targetsFixture && !/\bgetFixtureWorkspacePath\b/u.test(targetArg)) {
        failures.push(
          `${relativePath}: 禁止向 tests/fixtures/** 写入或修改（fixture 只读，需要写入时复制到隔离 workspace）：${targetArg.slice(0, 100)}`
        )
      }
    }
    const isAiLive = relativePath.split(path.sep).join('/').includes('tests/case/ai/human/live/')
    if ((domain === 'ai' || domain === 'knowledge') && /\bvi\.(?:fn|mock|spyOn)\b/u.test(source)) {
      failures.push(
        `${relativePath}: 正式 backend 禁止 vi.fn / vi.mock / vi.spyOn，假对象只属于 unit`
      )
    }
    if (isAiLive) {
      const prohibited = [
        ['skipped live result', /\bskipped\s*:/u],
        ['live config probe', /\bhasLiveLlmConfigInEnv\b/u],
        [
          'LLM scripted override',
          /\bstructuredOutputScript\b|\bllmScript\b|\bchatStructuredOverride\b/u
        ],
        ['case score gate', /\bscoreParts\b|\bruntime\.assertThat\(\s*score\b/u]
      ]
      for (const [label, pattern] of prohibited) {
        if (pattern.test(source)) failures.push(`${relativePath}: live 不允许 ${label}`)
      }
      if (!/\bloadLiveLlmConfigFromEnv\b|\brunBackendCase\b/u.test(source)) {
        failures.push(`${relativePath}: live 必须走严格 env runner`)
      }
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
      const prdAcs = acceptanceReferences(prd, rule.acPrefixes)
      const planAcs = acceptanceReferences(plan.source, rule.acPrefixes)
      const registrationSource = [
        ...plan.cases.flatMap((item) => item.body.match(/^- Oracle：.*$/gmu) || []),
        ...[
          ...plan.source.matchAll(
            /^## [^\n]*(?:自动化覆盖边界|发布前真实检查)[^\n]*\n([\s\S]*?)(?=^## |$(?![\s\S]))/gmu
          )
        ].map((match) => match[1])
      ].join('\n')
      const registeredAcs = acceptanceReferences(registrationSource, rule.acPrefixes)
      for (const ac of prdAcs) {
        if (!registeredAcs.has(ac)) {
          failures.push(`${rule.plan}: 未登记验收 ${ac}（需具体 Oracle 或显式覆盖边界）`)
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
