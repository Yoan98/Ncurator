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

  it('builds Windows directly into R2 without GitHub artifacts', async () => {
    const workflow = await readFile(path.resolve('.github/workflows/release.yml'), 'utf8')

    expect(workflow).toContain('runs-on: windows-latest')
    expect(workflow).toContain('upload-r2-release-fragment.mjs')
    expect(workflow).not.toContain('actions/upload-artifact')
    expect(workflow).not.toContain('runs-on: macos-')
    expect(workflow).not.toContain('publish-release')
  })

  it('requires local Rosetta builds and stable macOS signatures', async () => {
    const localRelease = await readFile(path.resolve('scripts/release-macos-local.mjs'), 'utf8')
    const signatureVerifier = await readFile(
      path.resolve('scripts/verify-mac-update-signature.mjs'),
      'utf8'
    )

    expect(localRelease).toContain('NCURATOR_X64_NODE')
    expect(localRelease).toContain('NCURATOR_X64_PYTHON')
    expect(localRelease).toContain("'-x86_64'")
    expect(signatureVerifier).toContain('macOS release must not use an ad-hoc signature')
    expect(signatureVerifier).toContain('macOS designated requirement must remain stable')
  })

  it('keeps only R2 as the release binary source', async () => {
    const finalizeScript = await readFile(path.resolve('scripts/finalize-r2-release.mjs'), 'utf8')

    expect(finalizeScript).toContain('releases/latest.json')
    expect(finalizeScript).toContain('cleanupOldObjects')
    expect(finalizeScript).not.toContain('gh release upload')
    await expect(readFile(path.resolve('.github/workflows/sync-r2.yml'), 'utf8')).rejects.toThrow()
  })
})
