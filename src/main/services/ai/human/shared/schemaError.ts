export type ZodIssueLike = {
  code?: string
  expected?: string
  path?: PropertyKey[]
  message?: string
  errors?: ZodIssueLike[][]
  issues?: ZodIssueLike[]
}

export type ZodErrorLike = { issues: ZodIssueLike[] }

const toDotPath = (path: PropertyKey[]): string =>
  path.reduce<string>((result, segment) => {
    if (typeof segment === 'number') return `${result}[${segment}]`
    const key = String(segment)
    return /^[a-zA-Z_$][\w$]*$/u.test(key)
      ? `${result}${result ? '.' : ''}${key}`
      : `${result}[${JSON.stringify(key)}]`
  }, '')

const renderLeafMessage = (issue: ZodIssueLike): string => {
  const message = typeof issue.message === 'string' ? issue.message.trim() : ''
  if (message) return message
  return issue.code ? `invalid value (${issue.code})` : 'invalid value'
}

export const formatZodError = (error: ZodErrorLike, maxIssues = 3): string => {
  const leaves: Array<{ path: string; message: string }> = []

  const walk = (issues: ZodIssueLike[], basePath: PropertyKey[]): void => {
    for (const issue of issues) {
      const path = [...basePath, ...(issue.path ?? [])]
      if (
        issue.code === 'invalid_union' &&
        Array.isArray(issue.errors) &&
        issue.errors.length > 0
      ) {
        issue.errors.forEach((branch) => walk(branch, path))
        continue
      }
      if (issue.code === 'invalid_key' && Array.isArray(issue.issues)) {
        walk(issue.issues, path)
        continue
      }
      if (issue.code === 'invalid_element' && Array.isArray(issue.issues)) {
        walk(issue.issues, path)
        continue
      }
      leaves.push({
        path: toDotPath(path),
        message: renderLeafMessage(issue)
      })
    }
  }

  walk(error.issues, [])
  const details = [...new Set(leaves.map((leaf) => `${leaf.path || '<root>'}: ${leaf.message}`))]
  if (details.length === 0) return '- <root>: invalid arguments'
  return [
    ...details.slice(0, maxIssues).map((detail) => `- ${detail}`),
    ...(details.length > maxIssues
      ? [`- ${details.length - maxIssues} more validation errors.`]
      : [])
  ].join('\n')
}

export const formatZodErrorForTool = (toolName: string, error: ZodErrorLike): string =>
  `Invalid arguments for ${toolName}.\n${formatZodError(error)}`
