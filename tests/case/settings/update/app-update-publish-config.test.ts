import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('app update publish config', () => {
  it('uses the direct release download feed instead of the GitHub Atom provider', async () => {
    const config = await readFile(path.resolve('electron-builder.yml'), 'utf8')

    expect(config).toMatch(
      /publish:\s*\n\s*provider:\s*generic\s*\n\s*url:\s*https:\/\/download\.ncurator\.com\/updates\/latest/u
    )
    expect(config).not.toMatch(/publish:\s*\n\s*provider:\s*github/u)
  })

  it('requires one stable macOS signing identity before publishing update files', async () => {
    const workflow = await readFile(path.resolve('.github/workflows/release.yml'), 'utf8')

    expect(workflow).toContain('MAC_CSC_CERT_BASE64')
    expect(workflow).toContain('build:mac:release:x64')
    expect(workflow).toContain('build:mac:release:arm64')
    expect(workflow).toContain('macOS release must not use an ad-hoc signature')
    expect(workflow).toContain('Verify both macOS architectures use the same update identity')
  })
})
