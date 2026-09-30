import path from 'node:path'
import { existsSync, realpathSync } from 'node:fs'
import { SubagentBlockedError } from './toolPolicy'

// Hold across reads, staged Office edits and final commit, not just the disk write.
const owners = new Map<string, string>()
export const acquireRunFile = (runId: string, sourcePath: string): void => {
  const resolved = path.resolve(sourcePath)
  let ancestor = resolved
  while (!existsSync(ancestor) && path.dirname(ancestor) !== ancestor)
    ancestor = path.dirname(ancestor)
  const canonical = path.join(realpathSync(ancestor), path.relative(ancestor, resolved))
  const key = process.platform === 'win32' ? canonical.toLowerCase() : canonical
  const owner = owners.get(key)
  if (owner && owner !== runId)
    throw new SubagentBlockedError(`文件正在由另一个任务处理，请交回主伙伴串行处理：${sourcePath}`)
  owners.set(key, runId)
}
export const releaseRunFiles = (runId: string): void => {
  for (const [key, owner] of owners) if (owner === runId) owners.delete(key)
}
