import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TelemetryService } from '../../../../src/main/services/telemetry/TelemetryService'

const originalE2EObserver = process.env.NCURATOR_E2E_OBSERVER
const directories: string[] = []

const createDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ncurator-telemetry-test-'))
  directories.push(directory)
  return directory
}

const acceptedResponse = (): Response =>
  new Response(JSON.stringify({ accepted: true }), {
    status: 202,
    headers: { 'content-type': 'application/json' }
  })

beforeEach(() => vi.stubEnv('NCURATOR_APP_SECRET_DESKTOP', 'unit-telemetry-synthetic-key'))

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  if (originalE2EObserver === undefined) delete process.env.NCURATOR_E2E_OBSERVER
  else process.env.NCURATOR_E2E_OBSERVER = originalE2EObserver
  await Promise.all(
    directories
      .splice(0)
      .map(async (directory) => await rm(directory, { recursive: true, force: true }))
  )
})

describe('TelemetryService', () => {
  it('disables telemetry for packaged E2E applications', async () => {
    process.env.NCURATOR_E2E_OBSERVER = '1'
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const service = new TelemetryService({
      userDataPath: await createDirectory(),
      appVersion: '1.0.0',
      isPackaged: true
    })

    service.track('app_started')
    await service.flush()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('disables telemetry for unpackaged applications', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const service = new TelemetryService({
      userDataPath: await createDirectory(),
      appVersion: '1.0.0',
      isPackaged: false
    })

    service.track('app_started')
    await service.flush()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('persists one installation id and emits the production-only payload', async () => {
    const directory = await createDirectory()
    const fetchMock = vi.fn(async () => acceptedResponse())
    vi.stubGlobal('fetch', fetchMock)
    const firstService = new TelemetryService({
      userDataPath: directory,
      appVersion: '1.2.3',
      isPackaged: true,
      endpoint: 'https://example.test/telemetry'
    })

    firstService.track('app_started')
    await firstService.flush()
    const firstPayload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<
      string,
      unknown
    >

    const secondService = new TelemetryService({
      userDataPath: directory,
      appVersion: '1.2.3',
      isPackaged: true,
      endpoint: 'https://example.test/telemetry'
    })
    secondService.track('message_submitted')
    await secondService.flush()
    const secondPayload = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as Record<
      string,
      unknown
    >
    const state = JSON.parse(await readFile(path.join(directory, 'telemetry.json'), 'utf8')) as {
      schemaVersion: number
      installationId: string
      pending: unknown[]
    }

    expect(firstPayload).toMatchObject({
      eventName: 'app_started',
      source: 'desktop',
      appVersion: '1.2.3'
    })
    expect(secondPayload).toMatchObject({
      eventName: 'message_submitted'
    })
    expect(secondPayload).not.toHaveProperty('mode')
    expect(firstPayload).not.toHaveProperty('environment')
    expect(secondPayload).not.toHaveProperty('environment')
    expect(secondPayload.installationId).toBe(firstPayload.installationId)
    expect(state).toMatchObject({
      schemaVersion: 3,
      installationId: firstPayload.installationId,
      pending: []
    })
  })

  it('migrates a legacy client id without creating a new installation', async () => {
    const directory = await createDirectory()
    const legacyClientId = '11111111-1111-4111-8111-111111111111'
    await writeFile(
      path.join(directory, 'telemetry.json'),
      JSON.stringify({ clientId: legacyClientId }),
      'utf8'
    )
    const fetchMock = vi.fn(async () => acceptedResponse())
    vi.stubGlobal('fetch', fetchMock)
    const service = new TelemetryService({
      userDataPath: directory,
      appVersion: '1.2.3',
      isPackaged: true
    })

    service.track('app_started')
    await service.flush()

    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      installationId: string
    }
    const state = JSON.parse(await readFile(path.join(directory, 'telemetry.json'), 'utf8')) as {
      schemaVersion: number
      installationId: string
    }
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.guanzhangai.cn/api/telemetry/events')
    expect(payload.installationId).toBe(legacyClientId)
    expect(state).toMatchObject({ schemaVersion: 3, installationId: legacyClientId })
  })

  it('drops the old queue while preserving the installation id', async () => {
    const directory = await createDirectory()
    const installationId = '22222222-2222-4222-8222-222222222222'
    await writeFile(
      path.join(directory, 'telemetry.json'),
      JSON.stringify({
        schemaVersion: 2,
        installationId,
        pending: [
          {
            eventId: '33333333-3333-4333-8333-333333333333',
            eventName: 'app_started',
            source: 'desktop',
            environment: 'production',
            installationId,
            platform: 'win32',
            arch: 'x64',
            appVersion: '1.2.3'
          }
        ]
      }),
      'utf8'
    )
    const fetchMock = vi.fn(async () => acceptedResponse())
    vi.stubGlobal('fetch', fetchMock)
    const service = new TelemetryService({
      userDataPath: directory,
      appVersion: '1.2.3',
      isPackaged: true
    })

    service.track('app_started')
    await service.flush()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      installationId: string
    }
    expect(payload.installationId).toBe(installationId)
  })

  it('keeps a completed run and its permitted attribution in the outbox and retries on launch', async () => {
    const directory = await createDirectory()
    const failingFetch = vi.fn(async () => new Response(null, { status: 503 }))
    vi.stubGlobal('fetch', failingFetch)
    const firstService = new TelemetryService({
      userDataPath: directory,
      appVersion: '2.0.0',
      isPackaged: true
    })

    const model = firstService.captureRunModel({ configId: 'private-config-sentinel', modelName: 'private-model-sentinel', manual: true })
    expect(model).toEqual({ modelSource: 'custom' })
    firstService.track('run_finished', { outcome: 'completed', model }, randomUUID())
    await firstService.flush()
    const failedState = JSON.parse(
      await readFile(path.join(directory, 'telemetry.json'), 'utf8')
    ) as {
      pending: unknown[]
    }
    expect(failedState.pending).toHaveLength(1)

    const acceptedFetch = vi.fn(async () => acceptedResponse())
    vi.stubGlobal('fetch', acceptedFetch)
    const secondService = new TelemetryService({
      userDataPath: directory,
      appVersion: '2.0.0',
      isPackaged: true
    })
    secondService.track('app_started')
    await secondService.flush()
    const recoveredState = JSON.parse(
      await readFile(path.join(directory, 'telemetry.json'), 'utf8')
    ) as {
      pending: unknown[]
    }

    expect(acceptedFetch).toHaveBeenCalledTimes(2)
    const original = JSON.parse(String(failingFetch.mock.calls[0]?.[1]?.body))
    const replay = JSON.parse(String(acceptedFetch.mock.calls[0]?.[1]?.body))
    expect(replay.eventId).toBe(original.eventId)
    expect(replay.eventName).toBe('run_finished')
    expect(replay).toMatchObject({ outcome: 'completed', modelSource: 'custom' })
    expect(replay).not.toHaveProperty('modelRef')
    expect(JSON.stringify(replay)).not.toContain('private-')
    expect(recoveredState.pending).toEqual([])
  })
})
