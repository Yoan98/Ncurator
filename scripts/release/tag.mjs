export const RELEASE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/u
export const RELEASE_TAG_PATTERN = /^(mac|windows)-v(\d+\.\d+\.\d+)$/u

const normalizeFamily = (platform) => {
  if (platform === 'mac' || platform === 'macos-arm64') return 'mac'
  if (platform === 'windows' || platform === 'windows-x64') return 'windows'
  throw new Error(`unsupported release platform: ${String(platform)}`)
}

export const createReleaseTag = (platform, version) => {
  if (!RELEASE_VERSION_PATTERN.test(version)) {
    throw new Error(`invalid release version: ${String(version)}`)
  }
  return `${normalizeFamily(platform)}-v${version}`
}

export const parseReleaseTag = (tag, expectedPlatform) => {
  const match = RELEASE_TAG_PATTERN.exec(tag)
  if (!match) throw new Error(`release tag must use mac-vX.Y.Z or windows-vX.Y.Z: ${String(tag)}`)
  const family = match[1]
  if (expectedPlatform && family !== normalizeFamily(expectedPlatform)) {
    throw new Error(`release tag ${tag} does not match ${expectedPlatform}`)
  }
  return { family, version: match[2] }
}

export const compareReleaseVersions = (left, right) => {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index]
  }
  return 0
}
