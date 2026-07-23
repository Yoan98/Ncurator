import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

type BuilderConfig = {
  productName?: string
  publish?: { provider?: string; url?: string }
  win?: { executableName?: string }
  nsis?: { include?: string; oneClick?: boolean; artifactName?: string }
  mac?: { artifactName?: string }
  linux?: unknown
}

const readBuilderConfig = async (): Promise<BuilderConfig> =>
  parse(await readFile(path.resolve('electron-builder.yml'), 'utf8')) as BuilderConfig

describe('app update publish config', () => {
  it('uses the direct update feed and updater-aware NSIS behavior', async () => {
    const [config, include] = await Promise.all([
      readBuilderConfig(),
      readFile(path.resolve('build/nsis-updated-silent.nsh'), 'utf8')
    ])

    expect(config.publish).toEqual({
      provider: 'generic',
      url: 'https://download.ncurator.com/updates/latest'
    })
    expect(config.nsis?.include).toBe('build/nsis-updated-silent.nsh')
    expect(config.nsis?.oneClick).toBe(false)
    expect(include).toContain('${if} ${isUpdated}')
    expect(include).toContain('SetSilent silent')
  })

  it('uses the product brand with stable technical artifact names', async () => {
    const config = await readBuilderConfig()

    expect(config.productName).toBe('馆长')
    expect(config.win?.executableName).toBe('Ncurator')
    expect(config.nsis?.artifactName).toBe('Ncurator-windows-${arch}.${ext}')
    expect(config.mac?.artifactName).toBe('Ncurator-mac-${arch}.${ext}')
    expect(config.linux).toBeUndefined()
  })

  it('uses one Windows pipeline with a local or Actions build backend', async () => {
    const [workflow, packageJsonText, windowsRelease, prepareRelease] = await Promise.all([
      readFile(path.resolve('.github/workflows/release.yml'), 'utf8'),
      readFile(path.resolve('package.json'), 'utf8'),
      readFile(path.resolve('scripts/release/windows.mjs'), 'utf8'),
      readFile(path.resolve('scripts/release/prepare.mjs'), 'utf8')
    ])
    const packageJson = JSON.parse(packageJsonText) as {
      scripts: Record<string, string>
    }

    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).not.toMatch(/push:\s*\n\s*tags:/u)
    expect(workflow).toContain('package_e2e:')
    expect(workflow).toContain('candidate_run_id:')
    expect(workflow).toContain('actions/upload-artifact@v4')
    expect(workflow).toContain('actions/download-artifact@v4')
    expect(packageJson.scripts['release:win']).toContain('release/windows.mjs')
    expect(packageJson.scripts['release:win:auto']).toBeUndefined()
    expect(windowsRelease).toContain('dispatchWindowsRelease')
    expect(windowsRelease).toContain("route === 'actions'")
    expect(windowsRelease).toContain('--package-e2e')
    expect(windowsRelease).toContain('--prepare-only')
    expect(windowsRelease).toContain('--test-only')
    expect(windowsRelease).toContain('--publish-only')
    expect(prepareRelease).toContain("'--prepare-only'")
    expect(prepareRelease).toContain("args.includes('--mac-only')")
    expect(prepareRelease).toContain('prepared for independent macOS release')
    expect(prepareRelease).toContain("['test:update:backend']")
    expect(prepareRelease).not.toContain('test:update:e2e')
  })

  it('finalizes Windows and macOS release channels independently', async () => {
    const [windowsRelease, macRelease, windowsFinalize, macFinalize] = await Promise.all([
      readFile(path.resolve('scripts/release/windows.mjs'), 'utf8'),
      readFile(path.resolve('scripts/release/macos.mjs'), 'utf8'),
      readFile(path.resolve('scripts/release/r2/finalize-windows.mjs'), 'utf8'),
      readFile(path.resolve('scripts/release/r2/finalize-macos.mjs'), 'utf8')
    ])

    expect(windowsRelease).toContain("'r2', 'finalize-windows.mjs'")
    expect(macRelease).toContain("'r2', 'finalize-macos.mjs'")
    expect(windowsFinalize).toContain('releases/latest/windows.json')
    expect(windowsFinalize).not.toContain('releases/latest/macos.json')
    expect(macFinalize).toContain('releases/latest/macos.json')
    expect(macFinalize).not.toContain('releases/latest/windows.json')
  })
})
