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
  const caseId = valueAfter(args, '--case')
  const groups = []
  for (let index = 0; index < args.length; index += 1) {
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
  if (caseId) workflowArgs.push('--case', caseId)
  if (freshKnowledgeCache) workflowArgs.push('--fresh-knowledge-cache')

  const selected = Boolean(domain || suite || groups.length > 0 || caseId)
  return {
    workflowArgs,
    state: {
      mode: selected ? 'selected' : 'full',
      ...(domain ? { domain } : {}),
      ...(suite ? { suite } : {}),
      ...(groups.length > 0 ? { groups } : {}),
      ...(caseId ? { caseId } : {}),
      ...(freshKnowledgeCache ? { freshKnowledgeCache: true } : {})
    }
  }
}

export const hasRegressionSelectionArgs = (args) =>
  args.some((arg) =>
    ['--domain', '--suite', '--group', '--case', '--fresh-knowledge-cache'].includes(arg)
  )
