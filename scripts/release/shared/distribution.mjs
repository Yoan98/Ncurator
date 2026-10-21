import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

export const DISTRIBUTIONS = ['domestic', 'international']
export const distributionName = (distribution) =>
  distribution === 'international' ? 'NCurator' : '馆长'
export const distributionStorage = (distribution) =>
  distribution === 'international' ? 'r2' : 'cos'
export const assertDistribution = (value) => {
  if (!DISTRIBUTIONS.includes(value)) throw new Error(`invalid release distribution: ${value}`)
  return value
}
export const hashSharedEntries = (entries) => {
  const hash = createHash('sha256')
  for (const [name, content] of [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    hash
      .update(name)
      .update('\0')
      .update(createHash('sha256').update(content).digest('hex'))
      .update('\n')
  }
  return hash.digest('hex')
}
export const hashSharedApp = (appDirectory) => {
  const entries = []
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (entry.isFile())
        entries.push([
          path.relative(appDirectory, file).replaceAll(path.sep, '/'),
          readFileSync(file)
        ])
    }
  }
  walk(path.join(appDirectory, 'out'))
  return hashSharedEntries(entries)
}
