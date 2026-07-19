import { describe, expect, it } from 'vitest'
import {
  artifactKey,
  fixedDownloadKey,
  statusKey
} from '../../../../scripts/release-storage-layout.mjs'

describe('release storage layout', () => {
  it('separates immutable assets and status by platform family', () => {
    expect(
      artifactKey({ platform: 'windows-x64', tag: 'v0.2.0' }, 'Ncurator-windows-x64.exe')
    ).toBe('artifacts/windows/v0.2.0/Ncurator-windows-x64.exe')
    expect(artifactKey({ platform: 'macos-arm64', tag: 'v0.1.6' }, 'Ncurator-mac-arm64.dmg')).toBe(
      'artifacts/macos/v0.1.6/Ncurator-mac-arm64.dmg'
    )
    expect(statusKey('v0.2.0', 'windows-x64')).toBe('release-status/windows/v0.2.0.json')
    expect(statusKey('v0.1.6', 'macos-x64')).toBe('release-status/macos/v0.1.6/macos-x64.json')
  })

  it('uses stable direct-download object keys', () => {
    expect(fixedDownloadKey('windows-x64')).toBe('downloads/latest/windows-x64.exe')
    expect(fixedDownloadKey('macos-arm64')).toBe('downloads/latest/macos-arm64.dmg')
    expect(fixedDownloadKey('macos-x64')).toBe('downloads/latest/macos-x64.dmg')
  })
})
