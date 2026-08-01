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
  const reusedFromTag = valueAfter(args, '--reused-from-tag')
  const caseIds = []
  const groups = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--case') {
      const value = args[index + 1]
      if (!value || value.startsWith('--')) throw new Error('--case requires a value')
      caseIds.push(value)
      index += 1
      continue
    }
    if (args[index] !== '--group') continue
    const value = args[index + 1]
    if (!value || value.startsWith('--')) throw new Error('--group requires a value')
    groups.push(value)
    index += 1
  }
  const freshKnowledgeCache = args.includes('--fresh-knowledge-cache')

  if (suite && !domain) throw new Error('--suite requires --domain')
  if (groups.length > 0 && (!domain || !suite)) {
    throw new Error('--group requires --domain and --suite')
  }

  const workflowArgs = []
  if (domain) workflowArgs.push('--domain', domain)
  if (suite) workflowArgs.push('--suite', suite)
  for (const group of groups) workflowArgs.push('--group', group)
  for (const caseId of caseIds) workflowArgs.push('--case', caseId)
  if (freshKnowledgeCache) workflowArgs.push('--fresh-knowledge-cache')

  const selected = Boolean(domain || suite || groups.length > 0 || caseIds.length > 0)
  if (reusedFromTag && !selected) {
    throw new Error('--reused-from-tag requires an explicit affected regression selection')
  }
  return {
    workflowArgs,
    state: {
      mode: reusedFromTag ? 'incremental' : selected ? 'selected' : 'full',
      ...(domain ? { domain } : {}),
      ...(suite ? { suite } : {}),
      ...(groups.length > 0 ? { groups } : {}),
      ...(caseIds.length === 1 ? { caseId: caseIds[0] } : {}),
      ...(caseIds.length > 1 ? { caseIds } : {}),
      ...(reusedFromTag ? { reusedFromTag } : {}),
      ...(freshKnowledgeCache ? { freshKnowledgeCache: true } : {})
    }
  }
}

export const hasRegressionSelectionArgs = (args) =>
  args.some((arg) =>
    [
      '--domain',
      '--suite',
      '--group',
      '--case',
      '--reused-from-tag',
      '--fresh-knowledge-cache'
    ].includes(arg)
  )
