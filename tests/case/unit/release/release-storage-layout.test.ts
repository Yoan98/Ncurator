import { describe, expect, it } from 'vitest'
import {
  artifactKey,
  artifactPrefix,
  fragmentKey,
  legacyStatusPrefix
} from '../../../../scripts/release/r2/storage-layout.mjs'

describe('release storage layout', () => {
  it('keeps immutable assets and the tag fragment under the same artifacts prefix', () => {
    expect(
      artifactKey({ platform: 'windows-x64', tag: 'windows-v0.2.0' }, 'Ncurator-windows-x64.exe')
    ).toBe('artifacts/windows/windows-v0.2.0/Ncurator-windows-x64.exe')
    expect(
      artifactKey({ platform: 'macos-arm64', tag: 'mac-v0.1.6' }, 'Ncurator-mac-arm64.dmg')
    ).toBe('artifacts/macos/mac-v0.1.6/Ncurator-mac-arm64.dmg')
    expect(fragmentKey('windows-v0.2.0', 'windows-x64')).toBe(
      'artifacts/windows/windows-v0.2.0/fragment.json'
    )
    expect(fragmentKey('mac-v0.1.6', 'macos-arm64')).toBe(
      'artifacts/macos/mac-v0.1.6/fragment.json'
    )
    expect(artifactPrefix('windows', 'windows-v0.2.0')).toBe('artifacts/windows/windows-v0.2.0/')
    expect(legacyStatusPrefix('windows')).toBe('release-status/windows/')
    expect(legacyStatusPrefix('macos')).toBe('release-status/macos/')
  })
})
