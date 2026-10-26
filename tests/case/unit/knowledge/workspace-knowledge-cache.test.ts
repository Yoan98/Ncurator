import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWorkspaceKnowledgeCache } from '../../../../src/main/services/workspace/WorkspaceKnowledgeCache'
import { fingerprintKnowledgePipeline } from '../../../../scripts/build/runtime/knowledge-cache-identity.mjs'

let root: string
const originalModels = process.env.NCURATOR_MODELS_PATH
const pipeline = { split: 'parser-a', embedding: 'embedding-a' }
const split = { contentHash: 'content-a', fileExt: '.md', chunks: [{ text: 'hello', page: 1 }] }
const key = { contentHash: 'content-a', fileExt: '.md', sourceName: 'notes.md' }
const vector = {
  contentHash: 'content-a',
  fileExt: '.md',
  modelName: 'model-a',
  vectors: [[1, 2, 3]]
}
const vectorKey = { ...key, modelName: 'model-a', texts: ['hello'] }
const cache = (identity = pipeline) =>
  createWorkspaceKnowledgeCache({ root: path.join(root, 'cache'), pipeline: identity })!

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'ncurator-knowledge-cache-'))
  process.env.NCURATOR_MODELS_PATH = path.join(root, 'models')
  await mkdir(path.join(root, 'models', 'model-a'), { recursive: true })
  await writeFile(path.join(root, 'models', 'model-a', 'model.onnx'), 'asset-a')
})
afterEach(async () => {
  if (originalModels === undefined) delete process.env.NCURATOR_MODELS_PATH
  else process.env.NCURATOR_MODELS_PATH = originalModels
  await rm(root, { recursive: true, force: true })
})

describe('workspace knowledge cache', () => {
  it('isolates split identity by contents, extension, name and parser while preserving same input hits', async () => {
    const first = cache()
    await expect(first.loadSplitSnapshot(key)).resolves.toBeNull()
    await first.saveSplitSnapshot(split, key.sourceName)
    await expect(cache().loadSplitSnapshot(key)).resolves.toEqual(split)
    for (const change of [
      { contentHash: 'new' },
      { fileExt: '.txt' },
      { sourceName: 'renamed.md' }
    ]) {
      await expect(first.loadSplitSnapshot({ ...key, ...change })).resolves.toBeNull()
    }
    await expect(
      cache({ ...pipeline, split: 'parser-b' }).loadSplitSnapshot(key)
    ).resolves.toBeNull()
    await expect(
      cache({ ...pipeline, embedding: 'embedding-b' }).loadSplitSnapshot(key)
    ).resolves.toEqual(split)
  })

  it('keys vectors by actual ordered texts, model bytes and embedding code, then rebinds current source metadata', async () => {
    const localVector = { ...vector, modelName: 'local:model-a' }
    await cache().saveVectorSnapshot(localVector, vectorKey.texts)
    await expect(
      cache().loadVectorSnapshot({ ...vectorKey, modelName: localVector.modelName })
    ).resolves.toEqual(localVector)
    await cache().saveVectorSnapshot(vector, vectorKey.texts)
    await expect(cache().loadVectorSnapshot(vectorKey)).resolves.toEqual(vector)
    await expect(
      cache().loadVectorSnapshot({ ...vectorKey, contentHash: 'other-source', fileExt: '.txt' })
    ).resolves.toEqual({ ...vector, contentHash: 'other-source', fileExt: '.txt' })
    await expect(
      cache().loadVectorSnapshot({ ...vectorKey, texts: ['different'] })
    ).resolves.toBeNull()
    await expect(
      cache().loadVectorSnapshot({ ...vectorKey, texts: ['hello', 'second'] })
    ).resolves.toBeNull()
    await expect(
      cache({ ...pipeline, embedding: 'embedding-b' }).loadVectorSnapshot(vectorKey)
    ).resolves.toBeNull()
    await expect(
      cache({ ...pipeline, split: 'parser-b' }).loadVectorSnapshot(vectorKey)
    ).resolves.toEqual(vector)
    await writeFile(path.join(root, 'models', 'model-a', 'model.onnx'), 'asset-b')
    await expect(
      cache().loadVectorSnapshot({ ...vectorKey, modelName: localVector.modelName })
    ).resolves.toBeNull()
    await expect(cache().loadVectorSnapshot(vectorKey)).resolves.toBeNull()
  })

  it('keys remote vectors by their configuration identity without requiring local model assets', async () => {
    const remoteVector = { ...vector, modelName: 'remote:endpoint-model-budget-a' }
    const remoteKey = { ...vectorKey, modelName: remoteVector.modelName }
    await cache().saveVectorSnapshot(remoteVector, remoteKey.texts)
    await expect(cache().loadVectorSnapshot(remoteKey)).resolves.toEqual(remoteVector)
    await expect(
      cache().loadVectorSnapshot({ ...remoteKey, modelName: 'remote:endpoint-model-budget-b' })
    ).resolves.toBeNull()
  })

  it('serializes missing work across consumers, retains completed entries on failure, and atomically rejects corruption', async () => {
    const first = cache(),
      second = cache()
    let computations = 0
    const warm = async (target: ReturnType<typeof cache>) =>
      target.withLock('same-source', async () => {
        if (await target.loadSplitSnapshot(key)) return
        computations += 1
        await target.saveSplitSnapshot(split, key.sourceName)
      })
    await Promise.all([warm(first), warm(second), warm(cache())])
    expect(computations).toBe(1)
    await expect(
      first.withLock('same-source', async () => {
        throw new Error('interrupted')
      })
    ).rejects.toThrow('interrupted')
    await warm(second)
    expect(computations).toBe(1)
    const [file] = await readdir(path.join(root, 'cache', 'splits'))
    await writeFile(path.join(root, 'cache', 'splits', file), '{"incomplete":true}')
    await warm(first)
    expect(computations).toBe(2)
    expect(await readdir(path.join(root, 'cache', 'locks'))).toEqual([])
    const stats = JSON.parse(await readFile(path.join(root, 'cache', 'stats.json'), 'utf8'))
    expect(stats.splitCacheHits).toBe(3)
    expect(stats.splitCacheMisses).toBe(2)
  })

  it('cancels a waiting consumer without removing the active computation lock', async () => {
    const target = cache()
    const signal = new AbortController()
    await target.withLock('busy-source', async () => {
      const waiting = target.withLock(
        'busy-source',
        async () => {
          throw new Error('must not start')
        },
        signal.signal
      )
      signal.abort()
      await expect(waiting).rejects.toThrow('INDEX_PREPARE_CANCELLED')
      expect(await readdir(path.join(root, 'cache', 'locks'))).toHaveLength(1)
    })
    expect(await readdir(path.join(root, 'cache', 'locks'))).toEqual([])
  })

  it('reclaims a terminated process lock without deleting a new owner', async () => {
    const target = cache()
    let directory = ''
    await target.withLock('interrupted-source', async () => {
      const [name] = await readdir(path.join(root, 'cache', 'locks'))
      directory = path.join(root, 'cache', 'locks', name)
    })
    const child = spawnSync(process.execPath, ['-e', 'process.exit(0)'])
    expect(child.status).toBe(0)
    await mkdir(directory)
    await writeFile(path.join(directory, `${child.pid}-interrupted`), '')
    let recovered = false
    await target.withLock('interrupted-source', async () => {
      recovered = true
    })
    expect(recovered).toBe(true)
    expect(await readdir(path.join(root, 'cache', 'locks'))).toEqual([])
  })

  it('automatically follows newly imported runtime dependencies while ignoring unrelated files and type-only imports', async () => {
    await writeFile(
      path.join(root, 'entry.ts'),
      "import { parse } from './parser'; import type { Shape } from './types'; export const run = parse;"
    )
    await writeFile(path.join(root, 'parser.ts'), 'export const parse = () => 1')
    await writeFile(path.join(root, 'types.ts'), 'export type Shape = string')
    const fingerprint = () => fingerprintKnowledgePipeline(root, ['entry.ts'])
    const initial = await fingerprint()
    await writeFile(path.join(root, 'unrelated-ui.ts'), 'export const ui = 2')
    await writeFile(path.join(root, 'types.ts'), 'export type Shape = number')
    expect(await fingerprint()).toBe(initial)
    await writeFile(
      path.join(root, 'parser.ts'),
      "import { value } from './new-dependency'; export const parse = () => value"
    )
    await writeFile(path.join(root, 'new-dependency.ts'), 'export const value = 1')
    const imported = await fingerprint()
    expect(imported).not.toBe(initial)
    await writeFile(path.join(root, 'new-dependency.ts'), 'export const value = 2')
    expect(await fingerprint()).not.toBe(imported)
  })
})
