import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { getUserDataPath } from '../../../utils/userDataPath'
import { writeJsonAtomically } from '../../../utils/writeJsonAtomically'

const digests = new Map<string, Promise<string>>()

/** File metadata only avoids rehashing unchanged assets; cache identity uses bytes. */
export const getModelAssetIdentity = async (modelName: string): Promise<string> => {
  const modelsRoot = process.env.NCURATOR_MODELS_PATH || path.join(getUserDataPath(), 'models')
  const root = path.join(modelsRoot, modelName)
  const entries: Array<{ name: string; absolute: string; signature: string }> = []
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) await walk(absolute)
      else if (entry.isFile() && !entry.name.startsWith('.')) {
        const info = await stat(absolute, { bigint: true })
        entries.push({
          name: path.relative(root, absolute),
          absolute,
          signature: `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`
        })
      }
    }
  }
  await walk(root)
  if (entries.length === 0) throw new Error(`No model assets found: ${modelName}`)
  const result = createHash('sha256')
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const key = `${entry.absolute}:${entry.signature}`
    let digest = digests.get(key)
    if (!digest) {
      digest = (async () => {
        const cacheRoot = process.env.NCURATOR_WORKSPACE_KNOWLEDGE_CACHE_PATH
        const identity = createHash('sha256').update(key).digest('hex')
        const file = cacheRoot ? path.join(cacheRoot, 'model-digests', `${identity}.json`) : null
        if (file) {
          const stored = await readFile(file, 'utf8')
            .then((raw) => JSON.parse(raw) as { identity: string; digest: string })
            .catch(() => null)
          if (stored?.identity === identity && /^[a-f0-9]{64}$/.test(stored.digest))
            return stored.digest
        }
        const hash = createHash('sha256')
        for await (const bytes of createReadStream(entry.absolute)) hash.update(bytes)
        const value = hash.digest('hex')
        if (file) await writeJsonAtomically(file, { identity, digest: value })
        return value
      })()
      digests.set(key, digest)
      void digest.catch(() => digests.delete(key))
    }
    result
      .update(entry.name)
      .update('\0')
      .update(await digest)
      .update('\0')
  }
  return result.digest('hex')
}
