export const prepareWorkspacesSequentially = async <T>(
  workspaceIds: readonly string[],
  prepare: (workspaceId: string) => Promise<T>
): Promise<T[]> => {
  const results: T[] = []
  for (const workspaceId of workspaceIds) {
    results.push(await prepare(workspaceId))
  }
  return results
}
