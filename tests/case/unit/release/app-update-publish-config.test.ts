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

  it('uses the product brand for Windows user-visible files and stable macOS artifact names', async () => {
    const config = await readBuilderConfig()

    expect(config.productName).toBe('馆长')
    expect(config.win?.executableName).toBe('馆长')
    expect(config.nsis?.artifactName).toBe('馆长-${version}-Windows-${arch}.${ext}')
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
    expect(workflow).not.toContain('package_e2e:')
    expect(workflow).toContain('- test')
    expect(workflow).toContain('candidate_run_id:')
    expect(workflow).toContain('test_domain:')
    expect(workflow).not.toContain('keep_old:')
    expect(workflow).toContain('test-windows:')
    expect(workflow).toContain('actions/upload-artifact@v4')
    expect(workflow).toContain('actions/download-artifact@v4')
    expect(packageJson.scripts['release:win']).toContain('release/windows.mjs')
    expect(packageJson.scripts['release:win:auto']).toBeUndefined()
    expect(windowsRelease).toContain('dispatchWindowsRelease')
    expect(windowsRelease).toContain("route === 'actions'")
    expect(windowsRelease).not.toContain('--package-e2e')
    expect(windowsRelease).toContain('readRegressionSelection')
    expect(windowsRelease).not.toContain('--keep-old')
    expect(windowsRelease).toContain('--prepare-only')
    expect(windowsRelease).toContain('--test-only')
    expect(windowsRelease).toContain('--publish-only')
    expect(prepareRelease).toContain("'--prepare-only'")
    expect(prepareRelease).toContain("valueAfter('--platform')")
    expect(prepareRelease).toContain("['mac', 'windows']")
    expect(prepareRelease).toContain('latestPlatformVersion')
    expect(prepareRelease).toContain('prepared for independent macOS release')
    expect(prepareRelease).toContain("'--exclude-group'")
    expect(prepareRelease).toContain("'live'")
    expect(prepareRelease).toContain("'typecheck:node'")
    expect(prepareRelease).toContain("'typecheck:web'")
    expect(prepareRelease).not.toContain('test:update:e2e')
    expect(prepareRelease).not.toContain('--package-e2e')
  })

  it('finalizes Windows and macOS release channels independently', async () => {
    const [windowsRelease, macRelease, windowsFinalize, macFinalize, tagContract] =
      await Promise.all([
        readFile(path.resolve('scripts/release/windows.mjs'), 'utf8'),
        readFile(path.resolve('scripts/release/macos.mjs'), 'utf8'),
        readFile(path.resolve('scripts/release/r2/finalize-windows.mjs'), 'utf8'),
        readFile(path.resolve('scripts/release/r2/finalize-macos.mjs'), 'utf8'),
        readFile(path.resolve('scripts/release/tag.mjs'), 'utf8')
      ])

    expect(windowsRelease).toContain("'r2', 'finalize-windows.mjs'")
    expect(macRelease).toContain("'r2', 'finalize-macos.mjs'")
    expect(windowsFinalize).toContain('releases/latest/windows.json')
    expect(windowsFinalize).not.toContain('releases/latest/macos.json')
    expect(macFinalize).toContain('releases/latest/macos.json')
    expect(macFinalize).not.toContain('releases/latest/windows.json')
    expect(windowsFinalize).not.toContain('--keep-old')
    expect(macFinalize).not.toContain('--keep-old')
    expect(tagContract).toContain('/^(mac|windows)-v')
  })

  it('warms the vector runtime before opening parallel E2E workers', async () => {
    const [testWorkflow, architectureValidator, warmupCase] = await Promise.all([
      readFile(path.resolve('scripts/test/workflow.mjs'), 'utf8'),
      readFile(path.resolve('scripts/test/validate-test-architecture.mjs'), 'utf8'),
      readFile(
        path.resolve('tests/case/settings/workspace/files/workspace-prepare-refresh.e2e.test.ts'),
        'utf8'
      )
    ])

    expect(testWorkflow).toContain("task.execution === 'warmup'")
    expect(testWorkflow).toContain('vector warm-up failed; parallel E2E will not start')
    expect(testWorkflow).toContain('seedCaseKnowledgeCache')
    expect(testWorkflow).toContain("path.basename(source) !== 'stats.json'")
    expect(testWorkflow).toContain("new Map([['macos-x64', 'macos-arm64']])")
    expect(testWorkflow).toContain('NCURATOR_E2E_CROSS_ARCH_WARMUP_SEED_PATH')
    expect(testWorkflow).toContain('uses verified cross-architecture cache seed')
    expect(testWorkflow).toContain("spawnSync('taskkill.exe'")
    expect(testWorkflow).toContain("input.type === 'e2e' && input.target === 'package'")
    expect(testWorkflow).toContain("prepareBetterSqliteNative('node')")
    expect(architectureValidator).toContain('warmupFiles.length !== 1')
    expect(warmupCase).toContain("execution: 'warmup'")
  })

  it('keeps LangSmith tracing opt-in by default', async () => {
    const exampleEnv = await readFile(path.resolve('.env-example'), 'utf8')

    expect(exampleEnv).toMatch(/^LANGSMITH_TRACING=false$/mu)
  })
})
