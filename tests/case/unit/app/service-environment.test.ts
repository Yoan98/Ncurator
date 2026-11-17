import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseEnv } from 'node:util'
import { build } from 'vite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readDesktopServiceEnvironment } from '../../../../src/main/services/app/ServiceEnvironment'
import { syncLocalServiceEnvironment } from '../../../../scripts/dev/sync-local-service-env.mjs'
import {
  configureServiceEnvironment,
  getAppRuntime,
  getOfficialAppKey,
  initializeAppRuntime,
  routeForServiceUrl,
  serviceApiUrl,
  serviceWebUrl,
  usesLocalService
} from '../../../../src/main/services/app/AppRuntime'

const filesystem = vi.hoisted(() => ({
  beforeWrite: undefined as ((file: string) => void) | undefined
}))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
      filesystem.beforeWrite?.(String(args[0]))
      return actual.writeFileSync(...args)
    }
  }
})

const localKey = 'synthetic-local-file-key-only'
const productionKey = 'synthetic-production-file-key-only'
const localKeyName = 'NCURATOR_LOCAL_APP_SECRET_DESKTOP'
const productionKeyName = 'NCURATOR_APP_SECRET_DESKTOP'
const directories: string[] = []
afterEach(() => {
  filesystem.beforeWrite = undefined
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true })
})
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'ncurator-service-env-'))
  directories.push(root)
  const settings: Record<string, string> = {
    NCURATOR_SERVICE_ENV: 'production',
    NCURATOR_LOCAL_API_ORIGIN: 'http://127.0.0.1:6010',
    NCURATOR_LOCAL_WEB_ORIGIN: 'http://127.0.0.1:5998',
    NCURATOR_PRODUCTION_API_ORIGIN: 'https://api.guanzhangai.cn',
    NCURATOR_PRODUCTION_WEB_ORIGIN: 'https://www.guanzhangai.cn',
    [productionKeyName]: productionKey,
    [localKeyName]: localKey
  }
  function save(comment = '') {
    writeFileSync(
      path.join(root, '.env'),
      Object.entries(settings)
        .map(([name, value]) => `${name}=${value}${comment}`)
        .join('\n'),
      { mode: 0o600 }
    )
  }
  save()
  return { root, settings, save }
}

describe('domestic service environment selection', () => {
  function commentedFixture(environment: 'local' | 'production') {
    const test = fixture()
    test.settings.NCURATOR_SERVICE_ENV = environment
    for (const name of [
      ...Object.keys(test.settings),
      'AI_TEST_DISABLE_DOTENV',
      'NCURATOR_DISTRIBUTION'
    ]) {
      vi.stubEnv(name, undefined)
    }
    vi.stubEnv(productionKeyName, 'inherited-wrong-environment-key')
    test.save(' # environment comment')
    writeFileSync(path.join(test.root, '.env.local'), 'NCURATOR_SERVICE_ENV=invalid\n')
    return test
  }
  it.each(['local', 'production'] as const)(
    'loads commented %s configuration in the actual Main startup order',
    async (environment) => {
      const { root } = commentedFixture(environment)
      vi.spyOn(process, 'cwd').mockReturnValue(root)
      vi.resetModules()
      const { loadRootEnvOnce } = await import('../../../../src/main/utils/rootEnv')
      loadRootEnvOnce()
      configureServiceEnvironment()
      expect(process.env.NCURATOR_SERVICE_ENV).toBe(environment)
      expect(process.env[productionKeyName]).toBe('inherited-wrong-environment-key')
      expect(process.env[localKeyName]).toBeUndefined()
      expect(getOfficialAppKey()).toBe(environment === 'local' ? localKey : productionKey)
      expect(serviceApiUrl('domestic', '')).toBe(
        environment === 'local' ? 'http://127.0.0.1:6010' : 'https://api.guanzhangai.cn'
      )
      expect(serviceWebUrl('domestic', '')).toBe(
        environment === 'local' ? 'http://127.0.0.1:5998' : 'https://www.guanzhangai.cn'
      )
    }
  )
  it.each(['local', 'production'] as const)(
    'preloads commented %s configuration through the real test runner',
    (environment) => {
      const { root } = commentedFixture(environment)
      const probe = path.join(root, 'probe.mjs')
      writeFileSync(
        probe,
        `process.on('exit',()=>console.log('ENV_PROBE='+JSON.stringify({
      selector:process.env.NCURATOR_SERVICE_ENV,
      api:process.env.NCURATOR_${environment.toUpperCase()}_API_ORIGIN,
      web:process.env.NCURATOR_${environment.toUpperCase()}_WEB_ORIGIN,
      inheritedKeyUnchanged:process.env.${productionKeyName}==='inherited-wrong-environment-key',
      localKeyNotExported:process.env.${localKeyName}===undefined}))); `
      )
      const output = execFileSync(
        process.execPath,
        ['--import', pathToFileURL(probe).href, path.resolve('scripts/test/workflow.mjs'), '--help'],
        {
          cwd: root,
          env: { ...process.env },
          encoding: 'utf8'
        }
      )
      const line = output.split('\n').find((value) => value.startsWith('ENV_PROBE='))
      expect(line).toBeDefined()
      expect(JSON.parse(line!.slice('ENV_PROBE='.length))).toEqual({
        selector: environment,
        api: environment === 'local' ? 'http://127.0.0.1:6010' : 'https://api.guanzhangai.cn',
        web: environment === 'local' ? 'http://127.0.0.1:5998' : 'https://www.guanzhangai.cn',
        inheritedKeyUnchanged: true,
        localKeyNotExported: true
      })
    }
  )
  it.each([
    ['local', 'production'],
    ['production', 'local']
  ] as const)('switches %s to %s with different keys in the same file', (first, second) => {
    const { root } = fixture()
    for (const environment of [first, second]) {
      const inherited = {
        NCURATOR_SERVICE_ENV: environment,
        [productionKeyName]: 'inherited-wrong-environment-key',
        [localKeyName]: 'inherited-wrong-environment-key'
      }
      const selected = readDesktopServiceEnvironment(root, inherited)
      expect(selected.appKey).toBe(environment === 'local' ? localKey : productionKey)
      configureServiceEnvironment(root, inherited)
      initializeAppRuntime(['zh-CN'])
      expect(getOfficialAppKey()).toBe(selected.appKey)
      expect(usesLocalService()).toBe(environment === 'local')
      expect(serviceApiUrl('domestic', '/api/auth/desktop/start')).toBe(
        selected.api + '/api/auth/desktop/start'
      )
      expect(serviceWebUrl('domestic', '/account')).toBe(selected.web + '/account')
      expect(getAppRuntime().accountWebOrigin).toBe(selected.web)
      expect(routeForServiceUrl(selected.api)).toBe('domestic')
      if (environment === 'local')
        expect(routeForServiceUrl('https://api.guanzhangai.cn')).toBeNull()
    }
  })
  it('loads the project selector and allows an explicit selector without inheriting its key', () => {
    const test = fixture()
    expect(readDesktopServiceEnvironment(test.root, {}).appKey).toBe(productionKey)
    test.settings.NCURATOR_SERVICE_ENV = 'local'
    test.save()
    expect(readDesktopServiceEnvironment(test.root, {}).appKey).toBe(localKey)
    expect(
      readDesktopServiceEnvironment(test.root, { NCURATOR_SERVICE_ENV: 'production' }).appKey
    ).toBe(productionKey)
  })
  it.each(['', 'staging', 'LOCAL'])(
    'rejects the selector %j without defaulting to production',
    (environment) => {
      const { root } = fixture()
      expect(() =>
        readDesktopServiceEnvironment(root, { NCURATOR_SERVICE_ENV: environment })
      ).toThrow('NCURATOR_SERVICE_ENV')
    }
  )
  it('requires a selector even with both complete groups', () => {
    const test = fixture()
    delete test.settings.NCURATOR_SERVICE_ENV
    test.save()
    expect(() => readDesktopServiceEnvironment(test.root, {})).toThrow('NCURATOR_SERVICE_ENV')
  })
  it.each(['local', 'production'] as const)(
    'never borrows the other environment or inherited key for missing %s credentials',
    (environment) => {
      const test = fixture()
      const keyName = environment === 'local' ? localKeyName : productionKeyName
      delete test.settings[keyName]
      test.save()
      expect(() =>
        readDesktopServiceEnvironment(test.root, {
          NCURATOR_SERVICE_ENV: environment,
          [keyName]: 'inherited-otherwise-valid-key'
        })
      ).toThrow(`${keyName} in .env`)
    }
  )
  it.each(['bad', 'a key containing spaces', '${NCURATOR_APP_SECRET_DESKTOP}'])(
    'rejects malformed keys without echoing %j',
    (key) => {
      const test = fixture()
      test.settings[localKeyName] = key
      test.save()
      expect(() =>
        readDesktopServiceEnvironment(test.root, { NCURATOR_SERVICE_ENV: 'local' })
      ).toThrow(`Missing or invalid ${localKeyName} in .env`)
    }
  )
  it.each([
    ['local', 'NCURATOR_LOCAL_API_ORIGIN', 'https://api.guanzhangai.cn'],
    ['local', 'NCURATOR_LOCAL_WEB_ORIGIN', 'http://127.0.0.1'],
    ['local', 'NCURATOR_LOCAL_WEB_ORIGIN', 'http://localhost:5998'],
    ['local', 'NCURATOR_LOCAL_WEB_ORIGIN', 'http://127.0.0.1:5998/'],
    ['local', 'NCURATOR_LOCAL_API_ORIGIN', 'http://user:password@127.0.0.1:6010'],
    ['production', 'NCURATOR_PRODUCTION_API_ORIGIN', 'http://api.guanzhangai.cn'],
    ['production', 'NCURATOR_PRODUCTION_API_ORIGIN', 'https://wrong.invalid'],
    ['production', 'NCURATOR_PRODUCTION_WEB_ORIGIN', 'https://www.guanzhangai.cn?token=secret'],
    ['local', 'NCURATOR_LOCAL_API_ORIGIN', '']
  ])('rejects invalid %s field %s', (environment, name, value) => {
    const { root } = fixture()
    expect(() =>
      readDesktopServiceEnvironment(root, { NCURATOR_SERVICE_ENV: environment, [name]: value })
    ).toThrow(`Missing or invalid ${name}`)
  })
  it('does not require the inactive group or consume legacy address overrides', () => {
    const test = fixture()
    delete test.settings.NCURATOR_PRODUCTION_API_ORIGIN
    delete test.settings.NCURATOR_PRODUCTION_WEB_ORIGIN
    test.save()
    expect(
      readDesktopServiceEnvironment(test.root, {
        NCURATOR_SERVICE_ENV: 'local',
        NCURATOR_API_ORIGIN: 'https://wrong.invalid',
        NCURATOR_WEB_ORIGIN: 'https://wrong.invalid'
      }).api
    ).toBe('http://127.0.0.1:6010')
  })
  it('keeps installed API, website and key on production despite development overrides', async () => {
    const { root } = fixture()
    const packageKey = 'synthetic-installed-domestic-key'
    writeFileSync(
      path.join(root, 'app-distribution.json'),
      JSON.stringify({ distribution: 'domestic', appKey: packageKey })
    )
    const built = await build({
      configFile: false,
      logLevel: 'silent',
      define: {
        'process.versions.electron': '"39"',
        'process.defaultApp': 'false',
        'process.resourcesPath': JSON.stringify(root)
      },
      build: {
        ssr: true,
        write: false,
        rollupOptions: {
          input: path.resolve('src/main/services/app/AppRuntime.ts'),
          output: { format: 'cjs', entryFileNames: 'runtime.cjs' }
        }
      }
    })
    if (!('output' in built)) throw new Error('Expected a single runtime bundle')
    const chunk = built.output.find((item) => item.type === 'chunk')
    if (!chunk || chunk.type !== 'chunk') throw new Error('Missing runtime chunk')
    expect(chunk.code).not.toContain(localKey)
    expect(chunk.code).not.toContain(productionKey)
    const output = path.join(root, 'runtime.cjs')
    writeFileSync(output, chunk.code)
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        [
          '-e',
          `const r=require(${JSON.stringify(output)});
      r.configureServiceEnvironment('/missing',{NCURATOR_SERVICE_ENV:'invalid',NCURATOR_DISTRIBUTION:'international'});
      console.log(JSON.stringify({api:r.serviceApiUrl('domestic',''),web:r.serviceWebUrl('domestic',''),key:r.getOfficialAppKey(),local:r.usesLocalService()}));`
        ],
        {
          env: {
            ...process.env,
            NCURATOR_SERVICE_ENV: 'local',
            [productionKeyName]: productionKey,
            [localKeyName]: localKey
          },
          encoding: 'utf8'
        }
      )
    )
    expect(result).toEqual({
      api: 'https://api.guanzhangai.cn',
      web: 'https://www.guanzhangai.cn',
      key: packageKey,
      local: false
    })
  })
})

describe('local client configuration synchronization', () => {
  it.each([1, 2])(
    'preserves unrelated edits made before replacement %i and reports a conflict',
    (replacement) => {
      const { root } = fixture()
      const destination = path.join(root, '.env')
      const client = path.join(root, 'client.env')
      writeFileSync(
        client,
        `NCURATOR_API_ORIGIN=http://127.0.0.1:6010\nNCURATOR_WEB_ORIGIN=http://127.0.0.1:5998\nNCURATOR_APP_SECRET_DESKTOP=new-synthetic-client-key\n`
      )
      let writes = 0
      let concurrent = ''
      filesystem.beforeWrite = (file) => {
        if (!file.startsWith(destination + '.') || ++writes !== replacement) return
        filesystem.beforeWrite = undefined
        concurrent = readFileSync(destination, 'utf8') + '\nUNRELATED_SETTING=concurrent-update\n'
        writeFileSync(destination, concurrent)
      }
      expect(() => syncLocalServiceEnvironment(client, root)).toThrow(
        'changed during synchronization'
      )
      expect(readFileSync(destination, 'utf8')).toBe(concurrent)
      expect(readdirSync(root).filter((name) => name.startsWith('.env.'))).toEqual([])
      expect(concurrent).not.toContain('new-synthetic-client-key')
      if (replacement === 2) {
        expect(concurrent).not.toContain(localKey)
        expect(() =>
          readDesktopServiceEnvironment(root, { NCURATOR_SERVICE_ENV: 'local' })
        ).toThrow()
      }
    }
  )
  it('does not overwrite another synchronization completed between the two replacements', () => {
    const { root } = fixture()
    const destination = path.join(root, '.env')
    const client = path.join(root, 'client.env')
    writeFileSync(
      client,
      `NCURATOR_API_ORIGIN=http://127.0.0.1:6010\nNCURATOR_WEB_ORIGIN=http://127.0.0.1:5998\nNCURATOR_APP_SECRET_DESKTOP=first-synthetic-client-key\n`
    )
    let writes = 0
    const concurrent =
      readFileSync(destination, 'utf8') +
      '\nNCURATOR_LOCAL_API_ORIGIN=http://127.0.0.1:6110\nNCURATOR_LOCAL_WEB_ORIGIN=http://127.0.0.1:6098\n' +
      `${localKeyName}=concurrent-synthetic-client-key\nUNRELATED_SETTING=new\n`
    filesystem.beforeWrite = (file) => {
      if (!file.startsWith(destination + '.') || ++writes !== 2) return
      filesystem.beforeWrite = undefined
      writeFileSync(destination, concurrent)
    }
    expect(() => syncLocalServiceEnvironment(client, root)).toThrow(
      'changed during synchronization'
    )
    expect(readFileSync(destination, 'utf8')).toBe(concurrent)
    expect(readdirSync(root).filter((name) => name.startsWith('.env.'))).toEqual([])
  })
  it('does not recreate a configuration deleted concurrently after invalidation', () => {
    const { root } = fixture()
    const destination = path.join(root, '.env')
    const client = path.join(root, 'client.env')
    writeFileSync(
      client,
      `NCURATOR_API_ORIGIN=http://127.0.0.1:6010\nNCURATOR_WEB_ORIGIN=http://127.0.0.1:5998\nNCURATOR_APP_SECRET_DESKTOP=new-synthetic-client-key\n`
    )
    let writes = 0
    filesystem.beforeWrite = (file) => {
      if (!file.startsWith(destination + '.') || ++writes !== 2) return
      filesystem.beforeWrite = undefined
      rmSync(destination)
    }
    expect(() => syncLocalServiceEnvironment(client, root)).toThrow(
      'changed during synchronization'
    )
    expect(() => readFileSync(destination)).toThrow()
    expect(readdirSync(root).filter((name) => name.startsWith('.env.'))).toEqual([])
    expect(() => readDesktopServiceEnvironment(root, { NCURATOR_SERVICE_ENV: 'local' })).toThrow()
  })
  it('updates only local settings in the shared file and retains private permissions', () => {
    const { root, settings } = fixture()
    const destination = path.join(root, '.env')
    const untouched = `\r\n# Existing unrelated settings\r\nUNRELATED="first line\r\n${localKeyName}=inside quoted value\r\nlast line"\r\n`
    const before = readFileSync(destination, 'utf8').replaceAll('\n', '\r\n') + untouched
    writeFileSync(destination, before)
    const client = path.join(root, 'client.env')
    const rebuiltKey = 'rebuilt-synthetic#client-key'
    writeFileSync(
      client,
      `NCURATOR_API_ORIGIN=http://127.0.0.1:6110\nNCURATOR_WEB_ORIGIN=http://127.0.0.1:6098\n${productionKeyName}="${rebuiltKey}"\nDATABASE_URL=must-not-copy\nBACKUP_SECRET=must-not-copy\n`
    )
    syncLocalServiceEnvironment(client, root)
    const updated = readFileSync(destination, 'utf8')
    expect(updated.endsWith(untouched)).toBe(true)
    expect(parseEnv(updated)).toEqual({
      ...settings,
      UNRELATED: parseEnv(before).UNRELATED,
      NCURATOR_LOCAL_API_ORIGIN: 'http://127.0.0.1:6110',
      NCURATOR_LOCAL_WEB_ORIGIN: 'http://127.0.0.1:6098',
      [localKeyName]: rebuiltKey
    })
    if (process.platform !== 'win32') expect(statSync(destination).mode & 0o777).toBe(0o600)
  })
  it.each(['missing', 'invalid'])(
    'invalidates the old key when rebuilt client configuration is %s',
    (state) => {
      const { root } = fixture()
      const client = path.join(root, 'rebuilt-client.env')
      if (state === 'invalid')
        writeFileSync(
          client,
          `NCURATOR_API_ORIGIN=https://wrong.invalid\nNCURATOR_APP_SECRET_DESKTOP=${localKey}`
        )
      expect(() => syncLocalServiceEnvironment(client, root)).toThrow(
        'previous desktop key was invalidated'
      )
      expect(readFileSync(path.join(root, '.env'), 'utf8')).not.toContain(localKey)
      expect(() => readDesktopServiceEnvironment(root, { NCURATOR_SERVICE_ENV: 'local' })).toThrow()
      expect(
        readDesktopServiceEnvironment(root, { NCURATOR_SERVICE_ENV: 'production' }).appKey
      ).toBe(productionKey)
    }
  )
})
