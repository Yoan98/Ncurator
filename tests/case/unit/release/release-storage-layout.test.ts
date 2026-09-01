import { describe, expect, it } from 'vitest'
import {
  artifactKey,
  fixedDownloadKey,
  statusKey
} from '../../../../scripts/release/r2/storage-layout.mjs'

describe('release storage layout', () => {
  it('separates immutable assets and status by platform family', () => {
    expect(
      artifactKey({ platform: 'windows-x64', tag: 'windows-v0.2.0' }, 'Ncurator-windows-x64.exe')
    ).toBe('artifacts/windows/windows-v0.2.0/Ncurator-windows-x64.exe')
    expect(
      artifactKey({ platform: 'macos-arm64', tag: 'mac-v0.1.6' }, 'Ncurator-mac-arm64.dmg')
    ).toBe('artifacts/macos/mac-v0.1.6/Ncurator-mac-arm64.dmg')
    expect(statusKey('windows-v0.2.0', 'windows-x64')).toBe(
      'release-status/windows/windows-v0.2.0.json'
    )
    expect(statusKey('mac-v0.1.6', 'macos-arm64')).toBe(
      'release-status/macos/mac-v0.1.6/macos-arm64.json'
    )
  })

  it('uses stable direct-download object keys', () => {
    expect(fixedDownloadKey('windows-x64')).toBe('downloads/latest/windows-x64.exe')
    expect(fixedDownloadKey('macos-arm64')).toBe('downloads/latest/macos-arm64.dmg')
    expect(() => fixedDownloadKey('macos-x64')).toThrow(/unsupported release platform/u)
  })
})
