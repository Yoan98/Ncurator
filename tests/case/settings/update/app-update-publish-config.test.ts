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

  it('makes updater-triggered NSIS installs silent while keeping normal installs assisted', async () => {
    const config = await readFile(path.resolve('electron-builder.yml'), 'utf8')
    const include = await readFile(path.resolve('build/nsis-updated-silent.nsh'), 'utf8')

    expect(config).toContain('include: build/nsis-updated-silent.nsh')
    expect(config).toContain('oneClick: false')
    expect(include).toContain('${if} ${isUpdated}')
    expect(include).toContain('SetSilent silent')
  })

  it('uses a local-first Windows release with explicit Actions fallback', async () => {
    const workflow = await readFile(path.resolve('.github/workflows/release.yml'), 'utf8')
    const packageJson = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'))
    const router = await readFile(path.resolve('scripts/route-windows-release.mjs'), 'utf8')
    const localRelease = await readFile(path.resolve('scripts/release-windows-local.mjs'), 'utf8')

    expect(workflow).toContain('runs-on: windows-latest')
    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).not.toMatch(/push:\s*\n\s*tags:/u)
    expect(workflow).toContain('print-package-audit-summary.mjs')
    expect(workflow).toContain('create-release-fragment.mjs')
    expect(workflow).toContain('upload-r2-release-fragment.mjs')
    expect(workflow).not.toContain('actions/upload-artifact')
    expect(workflow).not.toContain('runs-on: macos-')
    expect(workflow).not.toContain('publish-release')
    expect(packageJson.scripts['release:win']).toContain('release-windows-local.mjs')
    expect(packageJson.scripts['release:win:auto']).toContain('route-windows-release.mjs')
    expect(packageJson.scripts['release:doctor']).toContain('release-doctor.mjs')
    expect(packageJson.scripts['release:mac:only']).toContain('--mac-only')
    expect(packageJson.scripts['build:win']).toContain('prepare-electron-builder-windows.mjs')
    expect(packageJson.scripts['build:win']).toContain('package:audit')
    expect(router).toContain("route === 'local'")
    expect(router).toContain('dispatchWindowsRelease')
    expect(localRelease).toContain("'--format=zip'")
    expect(localRelease).toContain("path.join(os.tmpdir(), 'ncurator-release')")
    expect(localRelease).toContain('NCURATOR_RELEASE_WORK_ROOT')
    expect(localRelease).toContain("args.includes('--reuse-work')")
    expect(localRelease).toContain('tag-commit.txt')
    expect(localRelease).toContain('reusable-cache')
    expect(localRelease).toContain("['run', 'build:win']")
    expect(localRelease).toContain('inspection.python.executable')
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

  it('can publish only the Mac update channel without changing Windows latest metadata', async () => {
    const macRelease = await readFile(path.resolve('scripts/release-macos-local.mjs'), 'utf8')
    const macFinalize = await readFile(
      path.resolve('scripts/finalize-r2-macos-release.mjs'),
      'utf8'
    )

    expect(macRelease).toContain("args.includes('--mac-only')")
    expect(macRelease).toContain('finalize-r2-macos-release.mjs')
    expect(macFinalize).toContain('updates/latest/latest-mac.yml')
    expect(macFinalize).not.toContain('updates/latest/latest.yml')
    expect(macFinalize).not.toContain('releases/latest.json')
    expect(macFinalize).not.toContain('cleanupOldObjects')
  })

  it('keeps simulated update E2E available without making it a release blocker', async () => {
    const packageJson = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'))
    const prepareRelease = await readFile(
      path.resolve('scripts/prepare-desktop-release.mjs'),
      'utf8'
    )

    expect(packageJson.scripts['test:update:e2e']).toBeTruthy()
    expect(packageJson.scripts['test:update:backend']).toBeTruthy()
    expect(prepareRelease).toContain("['test:update:backend']")
    expect(prepareRelease).not.toContain('test:update:e2e')
  })

  it('keeps the complete installed production dependency closure', async () => {
    const packageJson = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'))
    const packageStage = await readFile(path.resolve('scripts/prepare-package-stage.mjs'), 'utf8')

    expect(packageStage).toContain('collectInstalledTopLevelDependencies')
    expect(packageStage).toContain('dependencies: packagedDependencies')
    expect(packageStage).toContain('isIncompatiblePackage')
    expect(packageStage).not.toContain("name.startsWith('history.')")

    const workspaceConfig = await readFile(path.resolve('pnpm-workspace.yaml'), 'utf8')
    expect(workspaceConfig).toContain('supportedArchitectures:')
    expect(workspaceConfig).toContain('- win32')
    expect(workspaceConfig).toContain('- x64')
    expect(packageJson.dependencies['@lancedb/lancedb']).toBe('0.22.3')

    const lockfile = await readFile(path.resolve('pnpm-lock.yaml'), 'utf8')
    expect(lockfile).toContain("'@lancedb/lancedb-darwin-x64@0.22.3':")
    expect(lockfile).toContain("'@lancedb/lancedb-win32-x64-msvc@0.22.3':")
  })

  it('requires local Rosetta builds and stable macOS signatures', async () => {
    const builderConfig = await readFile(path.resolve('electron-builder.yml'), 'utf8')
    const localRelease = await readFile(path.resolve('scripts/release-macos-local.mjs'), 'utf8')
    const signatureVerifier = await readFile(
      path.resolve('scripts/verify-mac-update-signature.mjs'),
      'utf8'
    )
    const runtimeSignatureVerifier = await readFile(
      path.resolve('src/main/services/update/utils/macUpdateSignature.ts'),
      'utf8'
    )

    expect(localRelease).toContain('NCURATOR_X64_NODE')
    expect(localRelease).toContain('NCURATOR_X64_PYTHON')
    expect(localRelease).toContain("'-x86_64'")
    expect(localRelease).toContain("path.join(os.tmpdir(), 'ncurator-macos-release')")
    expect(localRelease).toContain('NCURATOR_SIDECAR_PIP_CACHE')
    expect(builderConfig).toContain('entitlements: build/entitlements.mac.inherit.plist')
    expect(builderConfig).toContain('from: build/app-update.yml')
    expect(signatureVerifier).toContain('macOS release must not use an ad-hoc signature')
    expect(signatureVerifier).toContain('macOS designated requirement must remain stable')
    expect(signatureVerifier).toContain('packaged macOS app launch verification passed')
    expect(signatureVerifier).toContain("'--deep'")
    expect(runtimeSignatureVerifier).toContain("['-d', '-r-', '--verbose=4'")
    expect(runtimeSignatureVerifier).not.toContain("'--deep'")
  })

  it('enforces approved macOS package size budgets before publishing', async () => {
    const config = JSON.parse(
      await readFile(path.resolve('build/package-size-budgets.json'), 'utf8')
    )
    const packageAudit = await readFile(path.resolve('scripts/audit-packaged-app.mjs'), 'utf8')
    const releaseFragment = await readFile(
      path.resolve('scripts/create-release-fragment.mjs'),
      'utf8'
    )

    expect(config.warningGrowthPercent).toBe(3)
    expect(config.failureGrowthPercent).toBe(8)
    expect(config.platforms['darwin-arm64']).toBeTruthy()
    expect(config.platforms['darwin-x64']).toBeTruthy()
    expect(packageAudit).toContain('package size budget failed')
    expect(releaseFragment).toContain('macOS package size budget is missing or failed')
  })

  it('keeps only R2 as the release binary source', async () => {
    const finalizeScript = await readFile(path.resolve('scripts/finalize-r2-release.mjs'), 'utf8')

    expect(finalizeScript).toContain('releases/latest.json')
    expect(finalizeScript).toContain('cleanupOldObjects')
    expect(finalizeScript).not.toContain('gh release upload')
    expect(finalizeScript).not.toContain('createGithubRelease')
    expect(finalizeScript).not.toContain('NCURATOR_RELEASE_TOKEN')
    expect(finalizeScript).not.toContain('api.github.com/repos')
    await expect(readFile(path.resolve('.github/workflows/sync-r2.yml'), 'utf8')).rejects.toThrow()
  })
})
