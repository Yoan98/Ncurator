export type ZodIssueLike = {
  code?: string
  expected?: string
  path?: Array<string | number>
  message?: string
  errors?: ZodIssueLike[][]
  issues?: ZodIssueLike[]
}

export type ZodErrorLike = { issues: ZodIssueLike[] }

const toDotPath = (path: Array<string | number>): string =>
  path
    .map((segment) => {
      if (typeof segment === 'number') return `[${String(segment)}]`
      return /^[a-zA-Z_$][\w$]*$/.test(segment) ? segment : `["${segment}"]`
    })
    .join('.')

const renderLeafMessage = (issue: ZodIssueLike): string => {
  const message = typeof issue.message === 'string' ? issue.message.trim() : ''
  if (message && /^[\x20-\x7E]+$/u.test(message)) return message
  return issue.code ? `invalid value (${issue.code})` : 'invalid value'
}

export const formatZodError = (error: ZodErrorLike, maxIssues = 3): string => {
  const leaves: Array<{ path: string; message: string }> = []

  const walk = (issues: ZodIssueLike[], basePath: Array<string | number>): void => {
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
      leaves.push({ path: toDotPath(path), message: renderLeafMessage(issue) })
    }
  }

  walk(error.issues, [])
  return leaves
    .slice(0, maxIssues)
    .map((leaf) => `${leaf.path || '<root>'}: ${leaf.message}`)
    .join('; ')
}

export const formatZodErrorForTool = (toolName: string, error: ZodErrorLike): string =>
  `Tool ${toolName} arguments do not match the schema: ${formatZodError(error)}`
