import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  FREE_AI_KEYS_URL,
  OFFICIAL_DOWNLOAD_PAGE_URL,
  OFFICIAL_WEBSITE_URL,
  USER_MANUAL_URL
} from '../../../../src/shared/constants'

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
  it('uses one domestic website base for every desktop website entry', async () => {
    const [packageJsonText, telemetryService] = await Promise.all([
      readFile(path.resolve('package.json'), 'utf8'),
      readFile(path.resolve('src/main/services/telemetry/TelemetryService.ts'), 'utf8')
    ])
    const packageJson = JSON.parse(packageJsonText) as { homepage?: string }

    expect(OFFICIAL_WEBSITE_URL).toBe('https://www.guanzhangai.cn')
    expect(USER_MANUAL_URL).toBe(`${OFFICIAL_WEBSITE_URL}/zh/manual`)
    expect(FREE_AI_KEYS_URL).toBe(`${OFFICIAL_WEBSITE_URL}/zh/free-keys`)
    expect(OFFICIAL_DOWNLOAD_PAGE_URL).toBe(`${OFFICIAL_WEBSITE_URL}/zh`)
    expect(packageJson.homepage).toBe(OFFICIAL_WEBSITE_URL)
    expect(telemetryService).toContain('`${OFFICIAL_WEBSITE_URL}/api/telemetry/events`')
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
    const [packageJsonText, windowsRelease, prepareRelease] = await Promise.all([
      readFile(path.resolve('package.json'), 'utf8'),
      readFile(path.resolve('scripts/release/windows.mjs'), 'utf8'),
      readFile(path.resolve('scripts/release/prepare.mjs'), 'utf8')
    ])
    const packageJson = JSON.parse(packageJsonText) as {
      scripts: Record<string, string>
    }

    expect(packageJson.scripts['release:win']).toContain('release/windows.mjs')
    expect(packageJson.scripts['release:win:auto']).toBeUndefined()
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
  })

  it('finalizes Windows and macOS release channels independently with a live-publish lock', async () => {
    const [windowsRelease, macRelease, windowsFinalize, macFinalize, tagContract, storageConfig] =
      await Promise.all([
        readFile(path.resolve('scripts/release/windows.mjs'), 'utf8'),
        readFile(path.resolve('scripts/release/macos.mjs'), 'utf8'),
        readFile(path.resolve('scripts/release/r2/finalize-windows.mjs'), 'utf8'),
        readFile(path.resolve('scripts/release/r2/finalize-macos.mjs'), 'utf8'),
        readFile(path.resolve('scripts/release/tag.mjs'), 'utf8'),
        readFile(path.resolve('scripts/release/storage/config.mjs'), 'utf8')
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
    expect(testWorkflow).toContain("new Map([['macos-x64', 'macos-arm64']])")
    expect(testWorkflow).toContain("E2E_WORKERS_BY_TARGET = new Map([['macos-x64', 1]])")
    expect(testWorkflow).toContain('const LIVE_WORKERS = 3')
    expect(testWorkflow).not.toContain('LIVE_BACKEND_RETRIES')
    expect(testWorkflow).not.toContain("extraArgs.push('--retry'")
    expect(testWorkflow).toContain('parsed.caseIds.push(next)')
    expect(testWorkflow).toContain('no test files match --case')
    expect(testWorkflow).toContain('NCURATOR_TEST_RUNNER_DEADLINE_MS')
    expect(testWorkflow).toContain('NCURATOR_E2E_CROSS_ARCH_WARMUP_SEED_PATH')
    expect(testWorkflow).toContain('uses verified cross-architecture cache seed')
    expect(testWorkflow).toContain('targetTests.every')
    expect(macRelease).toContain("if (result.status === 'passed') status = 'passed'")
    expect(macRelease).toContain("const DEFAULT_E2E_PLATFORMS = ['macos-arm64']")
    expect(macRelease).toContain("args.includes('--include-x64-e2e')")
    expect(macRelease).toContain("status: 'skipped'")
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
