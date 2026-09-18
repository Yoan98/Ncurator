import { E2E_RELEASE_EXCLUDE_GROUPS } from '../test/e2e-default-excludes.mjs'

const valueAfter = (args, name) => {
  const index = args.indexOf(name)
  if (index < 0) return ''
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

export const readRegressionSelection = (args) => {
  const domain = valueAfter(args, '--domain')
  const suite = valueAfter(args, '--suite')
  const groups = []
  const caseIds = []
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index]
    if (name === '--group' || name === '--case') {
      const value = args[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
      if (name === '--group') groups.push(value)
      else caseIds.push(value)
      index += 1
    }
  }
  const freshKnowledgeCache = args.includes('--fresh-knowledge-cache')

  if (suite && !domain) throw new Error('--suite requires --domain')
  if (groups.length > 0 && (!domain || !suite)) {
    throw new Error('--group requires --domain and --suite')
  }
  const excludedGroup = [suite, ...groups]
    .filter(Boolean)
    .find((group) => E2E_RELEASE_EXCLUDE_GROUPS.includes(group))
  if (excludedGroup) {
    throw new Error(
      `release package E2E 不允许选择 ${excludedGroup} 分组；该分组只能通过独立测试命令执行`
    )
  }

  const workflowArgs = []
  if (domain) workflowArgs.push('--domain', domain)
  if (suite) workflowArgs.push('--suite', suite)
  for (const group of groups) workflowArgs.push('--group', group)
  for (const caseId of caseIds) workflowArgs.push('--case', caseId)
  if (freshKnowledgeCache) workflowArgs.push('--fresh-knowledge-cache')

  const selected = Boolean(domain || suite || groups.length > 0 || caseIds.length > 0)
  return {
    workflowArgs,
    state: {
      mode: selected ? 'selected' : 'full',
      ...(domain ? { domain } : {}),
      ...(suite ? { suite } : {}),
      ...(groups.length > 0 ? { groups } : {}),
      ...(caseIds.length > 0 ? { cases: caseIds } : {}),
      ...(freshKnowledgeCache ? { freshKnowledgeCache: true } : {})
    }
  }
}

export const hasRegressionSelectionArgs = (args) =>
  args.some((arg) =>
    ['--domain', '--suite', '--group', '--case', '--fresh-knowledge-cache'].includes(arg)
  )
