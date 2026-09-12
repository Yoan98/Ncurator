export const platformFamily = (platform) => {
  if (platform === 'windows-x64') return 'windows'
  if (platform === 'macos-arm64') return 'macos'
  throw new Error(`unsupported release platform: ${platform}`)
}

/** Object keys use the user-visible asset name (`file.name`), not storageName. */
export const artifactKey = (fragment, fileName) =>
  `artifacts/${platformFamily(fragment.platform)}/${fragment.tag}/${fileName}`

export const statusKey = (tag, platform) => {
  const family = platformFamily(platform)
  return family === 'windows'
    ? `release-status/windows/${tag}.json`
    : `release-status/macos/${tag}/${platform}.json`
}

export const artifactPrefix = (family, tag = '') => `artifacts/${family}/${tag ? `${tag}/` : ''}`

export const statusPrefix = (family, tag = '') =>
  family === 'windows'
    ? `release-status/windows/${tag}`
    : `release-status/macos/${tag ? `${tag}/` : ''}`
