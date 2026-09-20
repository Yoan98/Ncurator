export const prepareWorkspacesSequentially = async <T>(
  workspaceIds: readonly string[],
  prepare: (workspaceId: string) => Promise<T>,
  shouldContinue?: (result: T) => boolean
): Promise<T[]> => {
  const results: T[] = []
  for (const workspaceId of workspaceIds) {
    const result = await prepare(workspaceId)
    results.push(result)
    if (shouldContinue && !shouldContinue(result)) break
  }
  return results
}
