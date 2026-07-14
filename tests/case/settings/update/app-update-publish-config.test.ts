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

  it('uses a local-first Windows release with explicit Actions fallback', async () => {
    const workflow = await readFile(path.resolve('.github/workflows/release.yml'), 'utf8')
    const packageJson = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'))
    const router = await readFile(path.resolve('scripts/route-windows-release.mjs'), 'utf8')
    const localRelease = await readFile(path.resolve('scripts/release-windows-local.mjs'), 'utf8')

    expect(workflow).toContain('runs-on: windows-latest')
    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).not.toMatch(/push:\s*\n\s*tags:/u)
    expect(workflow).toContain('release-windows-local.mjs')
    expect(workflow).not.toContain('actions/upload-artifact')
    expect(workflow).not.toContain('runs-on: macos-')
    expect(workflow).not.toContain('publish-release')
    expect(packageJson.scripts['release:win']).toContain('release-windows-local.mjs')
    expect(packageJson.scripts['release:win:auto']).toContain('route-windows-release.mjs')
    expect(packageJson.scripts['release:doctor']).toContain('release-doctor.mjs')
    expect(packageJson.scripts['build:win']).toContain('prepare-electron-builder-windows.mjs')
    expect(router).toContain("route === 'local'")
    expect(router).toContain('dispatchWindowsRelease')
    expect(localRelease).toContain("'--format=zip'")
    expect(localRelease).toContain('os.tmpdir()')
    expect(localRelease).toContain("['run', 'build:win']")
    expect(localRelease).toContain('upload-r2-release-fragment.mjs')

    const windowsToolCache = await readFile(
      path.resolve('scripts/prepare-electron-builder-windows.mjs'),
      'utf8'
    )
    const releaseEnvironment = await readFile(
      path.resolve('scripts/release-environment.mjs'),
      'utf8'
    )
    expect(windowsToolCache).toContain("'x', '-snl-'")
    expect(windowsToolCache).toContain('SHA512 verification failed')
    expect(releaseEnvironment).toContain("'Amazon', 'AWSCLIV2', 'aws.exe'")
  })

  it('keeps release preparation free of simulated update E2E', async () => {
    const packageJson = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'))
    const prepareRelease = await readFile(
      path.resolve('scripts/prepare-desktop-release.mjs'),
      'utf8'
    )

    expect(packageJson.scripts['test:update:e2e']).toBeUndefined()
    expect(packageJson.scripts['test:update:backend']).toBeTruthy()
    expect(prepareRelease).toContain("['test:update:backend']")
    expect(prepareRelease).not.toContain('test:update:e2e')
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
    expect(finalizeScript).not.toContain('createGithubRelease')
    expect(finalizeScript).not.toContain('api.github.com')
    expect(finalizeScript).not.toContain('NCURATOR_RELEASE_TOKEN')
    await expect(readFile(path.resolve('.github/workflows/sync-r2.yml'), 'utf8')).rejects.toThrow()
  })
})
