import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import type { WorkspaceIndexJobRecord } from '../../../../src/shared/types'
import { withSeedLock } from '../../../../scripts/test/knowledge-seed-store.mjs'
import { createWorkspaceKnowledgeCache } from '../../../../src/main/services/workspace/WorkspaceKnowledgeCache'

const fake = vi.hoisted(() => ({
  launches: 0,
  failedFiles: 0,
  skipCache: false,
  splitOnly: false,
  evaluateReal: false
}))
vi.mock('../../../harness/e2e/electronApp', () => ({
  launchElectronApp: async ({ extraEnv }: { extraEnv: Record<string, string> }) => {
    fake.launches += 1
    return {
      page: {
        evaluate: async (
          _fn: (input: { rootPath: string; modelId: string }) => Promise<unknown>,
          { rootPath, modelId }: { rootPath: string; modelId: string }
        ) => {
          if ((!fake.failedFiles || fake.splitOnly) && !fake.skipCache) {
            const text = await readFile(
              path.join(rootPath, 'tests', 'fixtures', 'workspace', 'note.txt'),
              'utf8'
            )
            const contentHash = createHash('sha1').update(text).digest('hex')
            const cache = createWorkspaceKnowledgeCache({
              root: extraEnv.NCURATOR_WORKSPACE_KNOWLEDGE_CACHE_PATH,
              pipeline: JSON.parse(process.env.NCURATOR_E2E_KNOWLEDGE_SEED_IDENTITY!)
            })!
            await cache.saveSplitSnapshot(
              { contentHash, fileExt: '.txt', chunks: [{ text, page: 1 }] },
              'note.txt'
            )
            if (!fake.splitOnly)
              await cache.saveVectorSnapshot(
                {
                  contentHash,
                  fileExt: '.txt',
                  modelName: 'local:jinaai/jina-embeddings-v2-base-zh',
                  vectors: [[1, 2]]
                },
                [text]
              )
          }
          if (fake.evaluateReal) return await _fn({ rootPath, modelId })
          return {
            id: 'job',
            action: 'prepare',
            source_kind: 'file',
            status: fake.failedFiles ? 'failed' : 'succeeded',
            phase: 'complete',
            processed_count: 1,
            total_count: 1,
            failed_count: fake.failedFiles
          }
        }
      },
      close: async () => {}
    }
  }
}))
import {
  prepareIsolatedKnowledgeSeed,
  isCompleteSeedJob,
  withSeedPreparationDeadline
} from '../../../harness/e2e/knowledgeSeed'

let root: string
let env: Record<string, string>
const cacheFile = async (cache: string) =>
  path.join(cache, 'vectors', (await readdir(path.join(cache, 'vectors')))[0])
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'seed-adapter-unit-'))
  await mkdir(path.join(root, 'tests', 'fixtures', 'workspace'), { recursive: true })
  await writeFile(path.join(root, 'tests', 'fixtures', 'workspace', 'note.txt'), 'fixed input')
  const model = path.join(root, 'models/jinaai/jina-embeddings-v2-base-zh')
  await mkdir(model, { recursive: true })
  await writeFile(path.join(model, 'model.onnx'), 'test bytes')
  env = { NCURATOR_MODELS_PATH: path.join(root, 'models') }
  vi.stubEnv('NCURATOR_E2E_KNOWLEDGE_SEED_ROOT', path.join(root, 'persistent'))
  vi.stubEnv(
    'NCURATOR_E2E_KNOWLEDGE_SEED_IDENTITY',
    JSON.stringify({ split: 'split', embedding: 'vector' })
  )
  vi.stubEnv('NCURATOR_E2E_TEMP_ROOT', root)
  vi.stubEnv('NCURATOR_MODELS_PATH', env.NCURATOR_MODELS_PATH)
  fake.launches = 0
  fake.failedFiles = 0
  fake.skipCache = false
  fake.splitOnly = false
  fake.evaluateReal = false
})
afterEach(async () => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  await rm(root, { recursive: true, force: true })
})
const prepare = () =>
  prepareIsolatedKnowledgeSeed({ fixtures: ['tests/fixtures/workspace'], fixtureRoot: root, env })

it('prepares once then copies independently across disposed test runs without returning mutations', async () => {
  const first = await prepare()
  const original = await readFile(await cacheFile(first.cachePath), 'utf8')
  await writeFile(await cacheFile(first.cachePath), 'case mutation')
  await first.dispose()
  const second = await prepare()
  expect(fake.launches).toBe(1)
  expect(second.cachePath).not.toBe(first.cachePath)
  expect(await readFile(await cacheFile(second.cachePath), 'utf8')).toBe(original)
  await second.dispose()
})
it('serializes simultaneous cold requests and builds shared fixture only once', async () => {
  const copies = await Promise.all([prepare(), prepare(), prepare()])
  expect(fake.launches).toBe(1)
  expect(new Set(copies.map((copy) => copy.cachePath)).size).toBe(3)
  await Promise.all(copies.map((copy) => copy.dispose()))
})
it('updates changed fixture or model identity, but not an unchanged target', async () => {
  await (await prepare()).dispose()
  await writeFile(path.join(root, 'tests', 'fixtures', 'workspace', 'note.txt'), 'changed input')
  await (await prepare()).dispose()
  expect(fake.launches).toBe(2)
  await writeFile(
    path.join(env.NCURATOR_MODELS_PATH, 'jinaai/jina-embeddings-v2-base-zh/model.onnx'),
    'changed bytes'
  )
  await (await prepare()).dispose()
  expect(fake.launches).toBe(3)
})
it('does not mark an incomplete preparation as a completed seed or fake case success', async () => {
  fake.failedFiles = 1
  await (await prepare()).dispose()
  await (await prepare()).dispose()
  expect(fake.launches).toBe(2)
})

it('never treats an infrastructure failure with zero failed files as a completed seed', () => {
  const good = {
    action: 'prepare',
    source_kind: 'file',
    status: 'succeeded',
    phase: 'complete',
    processed_count: 1,
    total_count: 1,
    failed_count: 0
  } as WorkspaceIndexJobRecord
  expect(isCompleteSeedJob(good)).toBe(true)
  expect(
    isCompleteSeedJob({ ...good, status: 'failed', last_error: 'model initialization failed' })
  ).toBe(false)
  expect(isCompleteSeedJob({ ...good, processed_count: 0 })).toBe(false)
  expect(isCompleteSeedJob({ ...good, action: 'scan' })).toBe(false)
})

it('bounds the preparation IPC itself, not only polling after it returns', async () => {
  await expect(withSeedPreparationDeadline(new Promise(() => {}), 5)).rejects.toThrow('time limit')
})

it('rejects a successful job that produced no compatible cache entries', async () => {
  fake.skipCache = true
  await expect(prepare()).rejects.toThrow('no valid target cache')
})

it('reuses exact pure entries without a manifest after a temporary checkout is rebuilt', async () => {
  await (await prepare()).dispose()
  await rm(path.join(root, 'persistent', 'manifests'), { recursive: true, force: true })
  await rm(path.join(root, 'tests'), { recursive: true, force: true })
  await mkdir(path.join(root, 'tests', 'fixtures', 'workspace'), { recursive: true })
  await writeFile(path.join(root, 'tests', 'fixtures', 'workspace', 'note.txt'), 'fixed input')
  await (await prepare()).dispose()
  expect(fake.launches).toBe(1)
})

it('rechecks actual entries rather than trusting a completion manifest', async () => {
  await (await prepare()).dispose()
  const entries = path.join(root, 'persistent', 'entries')
  await writeFile(await cacheFile(entries), '{corrupt')
  await (await prepare()).dispose()
  expect(fake.launches).toBe(2)
})

it('retains a valid split after a file embedding failure without certifying full coverage', async () => {
  fake.failedFiles = 1
  fake.splitOnly = true
  await (await prepare()).dispose()
  const entries = path.join(root, 'persistent', 'entries')
  expect(await readdir(path.join(entries, 'splits'))).toHaveLength(1)
  await expect(readdir(path.join(root, 'persistent', 'manifests'))).rejects.toMatchObject({
    code: 'ENOENT'
  })
  fake.failedFiles = 0
  fake.splitOnly = false
  await (await prepare()).dispose()
  expect(fake.launches).toBe(2)
  expect(await readdir(path.join(entries, 'vectors'))).toHaveLength(1)
})

it('copies partial preflight results without restarting preparation inside a case', async () => {
  fake.failedFiles = 1
  await (await prepare()).dispose()
  const copy = await prepareIsolatedKnowledgeSeed({
    fixtures: ['tests/fixtures/workspace'],
    fixtureRoot: root,
    env,
    prepareMissing: false
  })
  expect(fake.launches).toBe(1)
  await copy.dispose()
})

it('does not wait on another cold publisher when copying a preflighted case', async () => {
  await (await prepare()).dispose()
  await withSeedLock(path.join(root, 'persistent'), async () => {
    const copy = await withSeedPreparationDeadline(
      prepareIsolatedKnowledgeSeed({
        fixtures: ['tests/fixtures/workspace'],
        fixtureRoot: root,
        env,
        prepareMissing: false
      }),
      1000
    )
    await copy.dispose()
  })
  expect(fake.launches).toBe(1)
})

it('uses the terminal prepare response when the active-job endpoint becomes empty', async () => {
  fake.evaluateReal = true
  const job = {
    id: 'terminal-job',
    action: 'prepare',
    source_kind: 'file',
    status: 'succeeded',
    phase: 'complete',
    processed_count: 1,
    total_count: 1,
    failed_count: 0
  }
  const get = vi.fn(async () => ({ success: true, job: undefined }))
  vi.stubGlobal('window', {
    api: {
      embeddingModelsGet: async () => ({
        activeModelId: 'local:jinaai/jina-embeddings-v2-base-zh'
      }),
      workspaceCreate: async () => ({ success: true, workspace: { id: 'workspace' } }),
      workspaceIndexJobGet: get,
      workspacePrepare: async () => ({ success: true, job })
    }
  })
  await (await prepare()).dispose()
  expect(get).toHaveBeenCalledTimes(2)
  expect(fake.launches).toBe(1)
})

it.each(['query-failed', 'returned-running'])(
  'rejects an invalid IPC completion: %s',
  async (mode) => {
    fake.evaluateReal = true
    const job = {
      id: 'job',
      action: 'prepare',
      source_kind: 'file',
      status: 'running',
      phase: 'index',
      processed_count: 0,
      total_count: 1,
      failed_count: 0
    }
    vi.stubGlobal('window', {
      api: {
        embeddingModelsGet: async () => ({
          activeModelId: 'local:jinaai/jina-embeddings-v2-base-zh'
        }),
        workspaceCreate: async () => ({ success: true, workspace: { id: 'workspace' } }),
        workspaceIndexJobGet: async () =>
          mode === 'query-failed'
            ? { success: false, error: 'query failed' }
            : { success: true, job: undefined },
        workspacePrepare: async () => ({ success: true, job })
      }
    })
    await expect(prepare()).rejects.toThrow(
      mode === 'query-failed' ? 'query failed' : 'did not complete'
    )
  }
)
