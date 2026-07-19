export const platformFamily = (platform) => {
  if (platform === 'windows-x64') return 'windows'
  if (platform === 'macos-arm64' || platform === 'macos-x64') return 'macos'
  throw new Error(`unsupported release platform: ${platform}`)
}

export const artifactKey = (fragment, fileName) =>
  `artifacts/${platformFamily(fragment.platform)}/${fragment.tag}/${fileName}`

export const statusKey = (tag, platform) => {
  const family = platformFamily(platform)
  return family === 'windows'
    ? `release-status/windows/${tag}.json`
    : `release-status/macos/${tag}/${platform}.json`
}

export const fixedDownloadKey = (platform, role = 'installer') => {
  if (role !== 'installer') throw new Error(`unsupported fixed download role: ${role}`)
  if (platform === 'windows-x64') return 'downloads/latest/windows-x64.exe'
  if (platform === 'macos-arm64') return 'downloads/latest/macos-arm64.dmg'
  if (platform === 'macos-x64') return 'downloads/latest/macos-x64.dmg'
  throw new Error(`unsupported release platform: ${platform}`)
}

export const artifactPrefix = (family, tag = '') => `artifacts/${family}/${tag ? `${tag}/` : ''}`

export const statusPrefix = (family, tag = '') =>
  family === 'windows'
    ? `release-status/windows/${tag}`
    : `release-status/macos/${tag ? `${tag}/` : ''}`
