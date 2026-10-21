import { createDistributionConfig } from '../../../../scripts/build/package/distribution-config.mjs'
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
  it('binds names and fixed update sources to the distribution', async () => {
    const base = await readBuilderConfig()
    const domestic = createDistributionConfig(base, {
      distribution: 'domestic',
      output: '/domestic',
      resourcesDirectory: '/resources/domestic'
    })
    const international = createDistributionConfig(base, {
      distribution: 'international',
      output: '/international',
      resourcesDirectory: '/resources/international'
    })
    expect(domestic.productName).toBe('馆长')
    expect(international.productName).toBe('NCurator')
    expect(domestic.publish.url).toBe('https://download.guanzhangai.cn/updates/latest')
    expect(international.publish.url).toBe('https://download.ncurator.com/updates/latest')
    expect(international.win.executableName).toBe('NCurator')
    expect(international.nsis.uninstallDisplayName).toBe('NCurator')
    expect(international.appId).toBe(domestic.appId)
  })

  it('uses the direct update feed and updater-aware NSIS behavior', async () => {
    const [config, include] = await Promise.all([
      readBuilderConfig(),
      readFile(path.resolve('build/nsis-updated-silent.nsh'), 'utf8')
    ])

    expect(config.publish).toEqual({
      provider: 'generic',
      url: 'https://download.guanzhangai.cn/updates/latest'
    })
    expect(config.nsis?.include).toBe('build/nsis-updated-silent.nsh')
    expect(config.nsis?.oneClick).toBe(false)
    expect(include).toContain('${if} ${isUpdated}')
    expect(include).toContain('SetSilent silent')
    expect(include).toContain('!insertmacro preventDowngrade HKCU')
    expect(include).toContain('!insertmacro preventDowngrade HKLM')
    expect(include).toContain('ReadRegStr $R0 ${ROOT_KEY}')
    expect(include).toContain('${VersionCompare} "$R0" "${VERSION}" $R1')
    expect(include).toContain('${if} $R1 == "1"')
    expect(include).toContain('Quit')
  })

  it('uses the product brand for Windows user-visible files and stable macOS artifact names', async () => {
    const config = await readBuilderConfig()

    expect(config.productName).toBe('馆长')
    expect(config.win?.executableName).toBe('馆长')
    expect(config.nsis?.artifactName).toBe('馆长-${version}-Windows-${arch}.${ext}')
    expect(config.mac?.artifactName).toBe('Ncurator-mac-${arch}.${ext}')
    expect(config.linux).toBeUndefined()
  })

  it('runs the Windows pipeline on a local build backend only', async () => {
    const [packageJsonText, windowsRelease, prepareRelease, abortRelease] = await Promise.all([
      readFile(path.resolve('package.json'), 'utf8'),
      readFile(path.resolve('scripts/release/windows.mjs'), 'utf8'),
      readFile(path.resolve('scripts/release/prepare.mjs'), 'utf8'),
      readFile(path.resolve('scripts/release/abort.mjs'), 'utf8')
    ])
    const packageJson = JSON.parse(packageJsonText) as {
      scripts: Record<string, string>
    }

    expect(packageJson.scripts['release:win']).toContain('release/windows.mjs')
    expect(packageJson.scripts['release:abort']).toContain('release/abort.mjs')
    expect(packageJson.scripts['release:win:auto']).toBeUndefined()
    expect(packageJson.scripts['test:ai']).toBeUndefined()
    expect(packageJson.scripts['test:settings']).toBeUndefined()
    expect(packageJson.scripts['test:workbench']).toBeUndefined()
    expect(packageJson.scripts['build:mac']).toBeUndefined()
    expect(packageJson.scripts['test:ai:backend']).toContain('--domain ai')
    expect(packageJson.scripts['test:settings:e2e']).toContain('--domain settings')
    expect(packageJson.scripts['test:workbench:e2e']).toContain('--domain workbench')
    expect(packageJson.scripts['build:mac:arm64']).toContain('distributions.mjs mac')
    expect(packageJson.scripts['native:prepare']).toContain('node-pty.mjs prepare')
    expect(packageJson.scripts['native:status']).toContain('node-pty.mjs status')
    expect(packageJson.scripts['native:clean']).toContain('node-pty.mjs clean')
    expect(packageJson.scripts['test:e2e:source']).not.toContain('--execution-profile')
    expect(packageJson.scripts['test:e2e:package']).not.toContain('--execution-profile')
    expect(packageJson.scripts['test:workbench:e2e']).not.toContain('--execution-profile')
    expect(packageJson.scripts['test:showcase']).toContain('scripts/test/showcase.mjs')
    expect(windowsRelease).toContain('inspectLocalWindowsRelease')
    expect(windowsRelease).not.toContain('dispatchWindowsRelease')
    expect(windowsRelease).not.toContain('--actions')
    expect(windowsRelease).not.toContain('--local-only')
    expect(windowsRelease).not.toContain('--candidate-run-id')
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
    expect(prepareRelease).toContain('release:abort')
    expect(prepareRelease).toContain('prepared for independent macOS release')
    expect(prepareRelease).toContain("'--exclude-group'")
    expect(prepareRelease).toContain("'live'")
    expect(prepareRelease).toContain("'typecheck:node'")
    expect(prepareRelease).toContain("'typecheck:web'")
    expect(prepareRelease).toContain('sqlite-migration-lock.mjs')
    expect(prepareRelease).toContain("'--promote-current'")
    expect(prepareRelease).not.toContain('test:update:e2e')
    expect(prepareRelease).not.toContain('--package-e2e')
    expect(prepareRelease).not.toContain('--actions')
    expect(abortRelease).toContain('NCURATOR_ALLOW_ABORT_TAG')
    expect(abortRelease).toContain('abort-unpublished-tag')
    expect(abortRelease).toContain('findLiveChannelsForTag')
    expect(abortRelease).toContain(`:refs/tags/`)
  })

  it('finalizes Windows and macOS release channels independently with a live-publish lock', async () => {
    const [
      windowsRelease,
      macRelease,
      windowsFinalize,
      macFinalize,
      tagContract,
      storageConfig,
      uploadFragment
    ] = await Promise.all([
      readFile(path.resolve('scripts/release/windows.mjs'), 'utf8'),
      readFile(path.resolve('scripts/release/macos.mjs'), 'utf8'),
      readFile(path.resolve('scripts/release/r2/finalize-windows.mjs'), 'utf8'),
      readFile(path.resolve('scripts/release/r2/finalize-macos.mjs'), 'utf8'),
      readFile(path.resolve('scripts/release/tag.mjs'), 'utf8'),
      readFile(path.resolve('scripts/release/storage/config.mjs'), 'utf8'),
      readFile(path.resolve('scripts/release/r2/upload-fragment.mjs'), 'utf8')
    ])

    for (const release of [windowsRelease, macRelease]) {
      expect(release).toContain('prepareReleaseStoragePublication(candidate.verified.fragment)')
      expect(release).toContain('await publishReleaseStorage(candidate.verified, channels,')
      expect(release.indexOf('await publishReleaseStorage')).toBeLessThan(
        release.indexOf('await github.publish(githubRelease)')
      )
      expect(release.indexOf('await github.publish(githubRelease)')).toBeLessThan(
        release.indexOf('await markCandidatePublished(')
      )
    }
    expect(windowsRelease).not.toContain('e2e-default-excludes.mjs')
    expect(macRelease).not.toContain('e2e-default-excludes.mjs')
    expect(windowsRelease).not.toContain('--execution-profile')
    expect(macRelease).not.toContain('--execution-profile')
    expect(windowsFinalize).toContain('releases/latest/windows.json')
    expect(windowsFinalize).not.toContain('releases/latest/macos.json')
    expect(macFinalize).toContain('releases/latest/macos.json')
    expect(macFinalize).not.toContain('releases/latest/windows.json')
    expect(windowsFinalize).not.toContain('copy-object')
    expect(macFinalize).not.toContain('copy-object')
    expect(windowsFinalize).toContain('installerUrl')
    expect(macFinalize).toContain('installerUrl')
    expect(windowsFinalize).not.toContain('--keep-old')
    expect(macFinalize).not.toContain('--keep-old')
    expect(windowsFinalize).toContain('fragmentKey')
    expect(macFinalize).toContain('fragmentKey')
    expect(windowsFinalize).toContain('legacyStatusPrefix')
    expect(macFinalize).toContain('legacyStatusPrefix')
    expect(windowsFinalize).not.toContain('release-status/windows/')
    expect(macFinalize).not.toContain('release-status/macos/')
    expect(uploadFragment).toContain('fragmentKey')
    expect(uploadFragment).toContain("'no-store'")
    expect(tagContract).toContain('/^(mac|windows)-v')
    expect(windowsRelease).toContain('assertLivePublishAllowed')
    expect(macRelease).toContain('assertLivePublishAllowed')
    expect(storageConfig).toContain("RELEASE_STORAGE_TARGET || 'cos'")
    expect(storageConfig).toContain('download.guanzhangai.cn')
  })

  it('shares source caches directly and warms packaged E2E before parallel workers', async () => {
    const [testWorkflow, architectureValidator, warmupCase, macRelease] = await Promise.all([
      readFile(path.resolve('scripts/test/workflow.mjs'), 'utf8'),
      readFile(path.resolve('scripts/test/validate-test-architecture.mjs'), 'utf8'),
      readFile(
        path.resolve('tests/case/settings/workspace/files/workspace-prepare-refresh.e2e.test.ts'),
        'utf8'
      ),
      readFile(path.resolve('scripts/release/macos.mjs'), 'utf8')
    ])

    expect(testWorkflow).toContain("task.execution === 'warmup'")
    expect(testWorkflow).toContain("cacheMode: 'direct'")
    expect(testWorkflow).toContain("cacheMode: 'warmup'")
    expect(testWorkflow).toContain("task.execution !== 'exclusive' && task.execution !== 'warmup'")
    expect(testWorkflow).toContain('VECTOR_WARMUP_TEST_FILE')
    expect(testWorkflow).toContain('testFiles = [...testFiles, VECTOR_WARMUP_TEST_FILE]')
    expect(testWorkflow).toContain("task.execution === 'warmup' ? '' : testNamePattern")
    expect(testWorkflow).toContain('buildDirectKnowledgeCacheEnv')
    expect(testWorkflow).toContain('NCURATOR_WORKSPACE_KNOWLEDGE_CACHE_STATS_PATH')
    expect(testWorkflow).toContain('vector warm-up failed; parallel E2E will not start')
    expect(testWorkflow).toContain('seedCaseKnowledgeCache')
    expect(testWorkflow).toContain("path.basename(source) !== 'stats.json'")
    expect(testWorkflow).not.toContain('macos-x64')
    expect(testWorkflow).toContain('const LIVE_WORKERS = 3')
    expect(testWorkflow).not.toContain('LIVE_BACKEND_RETRIES')
    expect(testWorkflow).not.toContain("extraArgs.push('--retry'")
    expect(testWorkflow).toContain('parsed.caseIds.push(next)')
    expect(testWorkflow).toContain('no test files match --case')
    expect(testWorkflow).toContain('NCURATOR_TEST_RUNNER_DEADLINE_MS')
    expect(testWorkflow).toContain('targetTests.every')
    expect(macRelease).toContain("const MACOS_PLATFORM = 'macos-arm64'")
    expect(macRelease).not.toContain('macos-x64')
    expect(macRelease).not.toContain('--include-x64-e2e')
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
