export const platformFamily = (platform) => {
  if (platform === 'windows-x64') return 'windows'
  if (platform === 'macos-arm64') return 'macos'
  throw new Error(`unsupported release platform: ${platform}`)
}

/** Object keys use the user-visible asset name (`file.name`), not storageName. */
export const artifactKey = (fragment, fileName) =>
  `artifacts/${platformFamily(fragment.platform)}/${fragment.tag}/${fileName}`

export const fragmentKey = (tag, platform) =>
  `${artifactPrefix(platformFamily(platform), tag)}fragment.json`

export const artifactPrefix = (family, tag = '') => `artifacts/${family}/${tag ? `${tag}/` : ''}`

/** Legacy prefix from the old top-level release-status tree; next finalize deletes it. */
export const legacyStatusPrefix = (family) => `release-status/${family}/`
