import {
  artifactKey,
  artifactPrefix,
  fragmentKey,
  legacyStatusPrefix,
  platformFamily
} from './storage-layout.mjs'

// Read-only; share exactly the same selection between preview and finalization.
export const listSupersededReleaseKeys = async (fragment, listKeys) => {
  const family = platformFamily(fragment.platform)
  const currentPrefix = artifactPrefix(family, fragment.tag)
  const removable = (await listKeys(artifactPrefix(family))).filter(
    (key) => !key.startsWith(currentPrefix)
  )
  if (family === 'macos') {
    const current = new Set([
      fragmentKey(fragment.tag, fragment.platform),
      ...fragment.files.map((file) => artifactKey(fragment, file.name))
    ])
    removable.push(...(await listKeys(currentPrefix)).filter((key) => !current.has(key)))
  }
  removable.push(...(await listKeys(legacyStatusPrefix(family))))
  return [...new Set(removable)].sort()
}
