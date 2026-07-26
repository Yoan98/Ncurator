const RELEASE_STAGE_TIMEOUT_MS = 60 * 60 * 1000

export const createReleaseStageDeadline = (label) => {
  const children = new Set()
  const timer = setTimeout(() => {
    process.stderr.write(`[release] ${label} exceeded the 60 minute stage limit\n`)
    for (const child of children) {
      try {
        child.kill()
      } catch {
        // The child may already have exited.
      }
    }
    process.exit(124)
  }, RELEASE_STAGE_TIMEOUT_MS)
  timer.unref()

  return {
    track(child) {
      children.add(child)
      const remove = () => children.delete(child)
      child.once('exit', remove)
      child.once('error', remove)
      return child
    }
  }
}
