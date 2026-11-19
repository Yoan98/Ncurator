import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import {
  readFile,
  readdir,
  cp,
  mkdir,
  mkdtemp,
  rm,
  stat,
  symlink,
  writeFile
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  cloneKnowledgeEntries,
  digestObject,
  resolveKnowledgeSeedRoot,
  snapshotFixtureInputs,
  snapshotModelAssets,
  validateKnowledgeRefs,
  verifyLocalFixtureCacheCoverage,
  withSeedLock,
  writeSeedJsonAtomic
} from '../../../../scripts/test/knowledge-seed-store.mjs'

import { createWorkspaceKnowledgeCache } from '../../../../src/main/services/workspace/WorkspaceKnowledgeCache'

const originalModels = process.env.NCURATOR_MODELS_PATH
let root: string
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'knowledge-seed-unit-'))
})
afterEach(async () => {
  if (originalModels === undefined) delete process.env.NCURATOR_MODELS_PATH
  else process.env.NCURATOR_MODELS_PATH = originalModels
  await rm(root, { recursive: true, force: true })
})
const fixture = async (checkout: string, content = 'fixture content') => {
  const directory = path.join(checkout, 'tests', 'fixtures', 'workspace')
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'note.txt'), content)
  await writeFile(path.join(directory, '.DS_Store'), 'ignored')
  return directory
}
const makeEntry = async (
  cache: string,
  kind: 'splits' | 'vectors',
  label: string,
  payload: object
) => {
  const key = createHash('sha256').update(label).digest('hex')
  const checksum = digestObject(payload)
  await writeSeedJsonAtomic(path.join(cache, kind, `${key}.json`), { key, checksum, payload })
  return { kind, key, checksum }
}
const split = { contentHash: 'hash', fileExt: '.txt', chunks: [{ text: 'fixture', page: 1 }] }

describe('isolated fixture knowledge seeds', () => {
  it('identifies fixture names and bytes independently of checkout paths', async () => {
    const a = path.join(root, 'a'),
      b = path.join(root, 'b')
    await fixture(a)
    await fixture(b)
    const first = await snapshotFixtureInputs(['tests/fixtures/workspace'], a)
    const second = await snapshotFixtureInputs(['tests/fixtures/workspace/note.txt'], b)
    expect(first.fingerprint).toBe(second.fingerprint)
    expect(first.files).toHaveLength(1)
    expect(first.files[0].relativePath).toBe('tests/fixtures/workspace/note.txt')
    await writeFile(path.join(b, 'tests', 'fixtures', 'workspace', 'note.txt'), 'changed')
    expect((await snapshotFixtureInputs(['tests/fixtures/workspace'], b)).fingerprint).not.toBe(
      first.fingerprint
    )
  })

  it('rejects fixture traversal', async () => {
    const checkout = path.join(root, 'repo')
    await fixture(checkout)
    await expect(snapshotFixtureInputs(['../../outside'], checkout)).rejects.toThrow(
      'tests/fixtures'
    )
  })

  it('rejects real fixture file symlinks', async (context) => {
    const checkout = path.join(root, 'repo')
    const directory = await fixture(checkout)
    try {
      await symlink(path.join(directory, 'note.txt'), path.join(directory, 'alias.txt'), 'file')
    } catch (error) {
      if (process.platform !== 'win32' || (error as NodeJS.ErrnoException).code !== 'EPERM')
        throw error
      context.skip('Windows denied file symlink creation; file symlink safety is unverified')
      return
    }
    await expect(snapshotFixtureInputs(['tests/fixtures/workspace'], checkout)).rejects.toThrow(
      'symlinks'
    )
  })

  it('rejects real directory links directly and through descendants', async () => {
    const checkout = path.join(root, 'repo')
    const directory = await fixture(checkout)
    await symlink(
      directory,
      path.join(checkout, 'tests/fixtures/alias'),
      process.platform === 'win32' ? 'junction' : 'dir'
    )
    await expect(snapshotFixtureInputs(['tests/fixtures/alias'], checkout)).rejects.toThrow(
      'symlinks'
    )
    await expect(
      snapshotFixtureInputs(['tests/fixtures/alias/note.txt'], checkout)
    ).rejects.toThrow('symlinks')
  })

  it('copies only complete valid computations and does not share writable file inodes', async () => {
    const source = path.join(root, 'seed'),
      target = path.join(root, 'case')
    const expected = await makeEntry(source, 'splits', 'split', split)
    await makeEntry(source, 'vectors', 'vector', {
      vectors: [
        [1, 2],
        [3, 4]
      ]
    })
    await makeEntry(source, 'vectors', 'bad-dimensions', { vectors: [[1], [2, 3]] })
    await mkdir(path.join(source, 'locks'), { recursive: true })
    await writeFile(path.join(source, 'stats.json'), '{}')
    await writeFile(path.join(source, 'app.sqlite'), 'do not copy')
    await writeFile(path.join(source, 'splits', `${'a'.repeat(64)}.json`), '{unfinished')
    await writeFile(path.join(source, 'splits', 'pending.tmp'), '{}')
    const refs = await cloneKnowledgeEntries(source, target)
    expect(refs).toHaveLength(2)
    expect(refs).toContainEqual(expected)
    expect(await validateKnowledgeRefs(target, refs)).toBe(true)
    await expect(stat(path.join(target, 'app.sqlite'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(path.join(target, 'stats.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    const name = path.join('splits', `${expected.key}.json`)
    expect((await stat(path.join(source, name))).ino).not.toBe(
      (await stat(path.join(target, name))).ino
    )
    await writeFile(path.join(target, name), 'changed locally')
    expect(await validateKnowledgeRefs(target, refs)).toBe(false)
    expect(await validateKnowledgeRefs(source, refs)).toBe(true)
  })

  it('honors exact manifest references, detects corruption, duplicates and conflicting results', async () => {
    const source = path.join(root, 'seed'),
      target = path.join(root, 'case')
    const ref = await makeEntry(source, 'splits', 'one', split)
    await makeEntry(source, 'splits', 'two', { ...split, contentHash: 'two' })
    expect(await cloneKnowledgeEntries(source, target, [])).toEqual([])
    expect(await cloneKnowledgeEntries(source, target, [ref])).toEqual([ref])
    expect(await validateKnowledgeRefs(target, [ref, ref])).toBe(false)
    await makeEntry(target, 'splits', 'one', { ...split, contentHash: 'conflict' })
    await expect(cloneKnowledgeEntries(source, target)).rejects.toThrow('Conflicting')
    await expect(
      cloneKnowledgeEntries(source, target, [{ ...ref, checksum: '0'.repeat(64) }])
    ).rejects.toThrow('Invalid')
    await expect(cloneKnowledgeEntries(source, path.join(source, 'nested'))).rejects.toThrow(
      'separate trees'
    )
  })

  it('hashes model bytes independently of root, memoizes safely and notices changed assets', async () => {
    const a = path.join(root, 'model-a'),
      b = path.join(root, 'model-b'),
      memo = path.join(root, 'memo')
    await mkdir(path.join(a, 'onnx'), { recursive: true })
    await writeFile(path.join(a, 'onnx/model.onnx'), 'model bytes')
    await writeFile(path.join(a, 'tokenizer.json'), '{}')
    await writeFile(path.join(a, '.ignored'), 'ignored')
    await cp(a, b, { recursive: true })
    const first = await snapshotModelAssets(a, memo)
    expect(first.files).toHaveLength(2)
    expect((await snapshotModelAssets(a, memo)).fingerprint).toBe(first.fingerprint)
    expect((await snapshotModelAssets(b, memo)).fingerprint).toBe(first.fingerprint)
    await writeFile(path.join(b, 'onnx/model.onnx'), 'different model bytes')
    expect((await snapshotModelAssets(b, memo)).fingerprint).not.toBe(first.fingerprint)
  })

  const coldModel = async () => {
    const model = path.join(root, 'concurrent-model')
    const memo = path.join(root, 'concurrent-memo')
    await mkdir(model)
    await writeFile(path.join(model, 'weights.bin'), Buffer.alloc(2 * 1024 * 1024, 37))
    await writeFile(path.join(model, 'config.json'), '{}')
    return { model, memo, expected: await snapshotModelAssets(model) }
  }

  const assertPublishedMemo = async (memo: string) => {
    const names = (await readdir(path.join(memo, 'model-digests'))).filter((name) =>
      name.endsWith('.json')
    )
    expect(names).toHaveLength(2)
    for (const name of names) {
      const entry = JSON.parse(await readFile(path.join(memo, 'model-digests', name), 'utf8'))
      expect(name).toBe(`${entry.identity}.json`)
      expect(entry.digest).toMatch(/^[a-f0-9]{64}$/u)
    }
  }

  it('publishes a shared cold model memo under simultaneous same-process requests', async () => {
    const { model, memo, expected } = await coldModel()
    const results = await Promise.all(
      Array.from({ length: 6 }, () => snapshotModelAssets(model, memo))
    )
    for (const result of results) expect(result).toEqual(expected)
    await assertPublishedMemo(memo)
    expect(await snapshotModelAssets(model, memo)).toEqual(expected)
  })

  it('publishes a shared cold model memo from simultaneous real child processes', async () => {
    const { model, memo, expected } = await coldModel()
    const moduleUrl = pathToFileURL(path.resolve('scripts/test/knowledge-seed-store.mjs')).href
    const source = `
      import { snapshotModelAssets } from ${JSON.stringify(moduleUrl)};
      process.once('message', async () => {
        try {
          const result = await snapshotModelAssets(${JSON.stringify(model)}, ${JSON.stringify(memo)});
          process.stdout.write(JSON.stringify(result));
          process.disconnect();
        } catch (error) { console.error(error); process.exit(1); }
      });
      process.send('ready');
    `
    const workers = Array.from({ length: 3 }, () => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc']
      })
      let output = '',
        errors = ''
      child.stdout!.on('data', (chunk) => {
        output += chunk
      })
      child.stderr!.on('data', (chunk) => {
        errors += chunk
      })
      const ready = new Promise<void>((resolve, reject) => {
        child.once('message', () => resolve())
        child.once('error', reject)
        child.once('exit', () => reject(new Error('model memo child exited before readiness')))
      })
      const result = new Promise<unknown>((resolve, reject) => {
        child.once('error', reject)
        child.once('close', (code) => {
          if (code !== 0) return reject(new Error(`model memo child failed (${code}): ${errors}`))
          try {
            resolve(JSON.parse(output))
          } catch (error) {
            reject(error)
          }
        })
      })
      // Attach rejection handlers before awaiting the readiness barrier.
      void ready.catch(() => {})
      void result.catch(() => {})
      return { child, ready, result }
    })
    const timer = setTimeout(() => {
      for (const { child } of workers) child.kill()
    }, 15_000)
    try {
      await Promise.all(workers.map(({ ready }) => ready))
      for (const { child } of workers) child.send('start')
      for (const result of await Promise.all(workers.map(({ result }) => result)))
        expect(result).toEqual(expected)
      await assertPublishedMemo(memo)
      expect(await snapshotModelAssets(model, memo)).toEqual(expected)
    } finally {
      clearTimeout(timer)
      for (const { child } of workers) if (child.exitCode === null) child.kill()
      await Promise.allSettled(workers.map(({ result }) => result))
    }
  }, 20_000)

  const coverageSetup = async () => {
    const checkout = path.join(root, 'checkout')
    await fixture(checkout)
    const { files } = await snapshotFixtureInputs(['tests/fixtures/workspace'], checkout)
    const models = path.join(root, 'models')
    const modelRoot = path.join(models, 'model-a')
    await mkdir(path.join(modelRoot, '.nested'), { recursive: true })
    await writeFile(path.join(modelRoot, '.nested', 'weights.bin'), 'model bytes')
    await writeFile(path.join(modelRoot, 'config.json'), '{}')
    await writeFile(path.join(modelRoot, '.ignored'), 'ignored')
    process.env.NCURATOR_MODELS_PATH = models
    const model = await snapshotModelAssets(modelRoot)
    const pipeline = { split: 'split-implementation', embedding: 'embedding-implementation' }
    const cacheRoot = path.join(root, 'cache')
    const cache = createWorkspaceKnowledgeCache({ root: cacheRoot, pipeline })!
    const contentHash = createHash('sha1')
      .update(await readFile(files[0].source))
      .digest('hex')
    const payload = { contentHash, fileExt: '.txt', chunks: [{ text: 'fixture content', page: 1 }] }
    const check = (
      inputs = files,
      identity: typeof pipeline & { schema?: number } = pipeline,
      assets = model
    ) => verifyLocalFixtureCacheCoverage(cacheRoot, inputs, identity, assets, 'local:model-a')
    const save = async (vectors = [[1, 2]]) => {
      await cache.saveSplitSnapshot(payload, 'note.txt')
      await cache.saveVectorSnapshot(
        { contentHash, fileExt: '.txt', modelName: 'local:model-a', vectors },
        ['fixture content']
      )
    }
    return { files, model, pipeline, cacheRoot, cache, payload, check, save }
  }

  it('certifies only exact fixture coverage using entries written by production cache keys', async () => {
    const { files, model, cacheRoot, check, save } = await coverageSetup()
    expect(model.files.map((file) => file.name)).toContain('.nested/weights.bin')
    await makeEntry(cacheRoot, 'splits', 'unrelated', split)
    await makeEntry(cacheRoot, 'vectors', 'unrelated', { vectors: [[1, 2]] })
    expect(await check()).toEqual({ entries: [], missing: [files[0].relativePath] })
    await save()
    const complete = await check()
    expect(complete.missing).toEqual([])
    expect(complete.entries).toHaveLength(2)
    expect(await validateKnowledgeRefs(cacheRoot, complete.entries)).toBe(true)
    expect((await check([...files, ...files])).entries).toHaveLength(2)
    expect(await check([])).toEqual({ entries: [], missing: [] })
  })

  it('fails coverage for changed fixtures, parser, embedder, model bytes or basename', async () => {
    const { files, model, pipeline, check, save } = await coverageSetup()
    await save()
    expect((await check(files, { ...pipeline, split: 'new' })).missing).toHaveLength(1)
    expect((await check(files, { ...pipeline, embedding: 'new' })).missing).toHaveLength(1)
    const changed = {
      ...model,
      files: model.files.map((file) => ({ ...file, sha256: '0'.repeat(64) }))
    }
    expect((await check(files, pipeline, changed)).missing).toHaveLength(1)
    const alias = path.join(path.dirname(files[0].source), 'renamed.txt')
    await cp(files[0].source, alias)
    expect((await check([{ ...files[0], source: alias }])).missing).toHaveLength(1)
    await writeFile(files[0].source, 'changed after snapshot')
    expect((await check()).missing).toHaveLength(1)
    await expect(check(files, { ...pipeline, schema: 4 })).rejects.toThrow('schema 3')
  })

  it('refuses missing, corrupt, count-mismatched and wrong-content entries', async () => {
    const { files, cacheRoot, cache, payload, check, save } = await coverageSetup()
    await cache.saveSplitSnapshot(payload, 'note.txt')
    expect((await check()).missing).toHaveLength(1)
    await save([
      [1, 2],
      [3, 4]
    ])
    expect((await check()).missing).toHaveLength(1)
    await save()
    const refs = (await check()).entries
    const vectorRef = refs.find((ref) => ref.kind === 'vectors')!
    await writeFile(path.join(cacheRoot, 'vectors', `${vectorRef.key}.json`), '{broken')
    expect((await check()).missing).toHaveLength(1)
    await save()
    const splitRef = refs.find((ref) => ref.kind === 'splits')!
    const wrong = { ...payload, contentHash: 'wrong-content' }
    await writeSeedJsonAtomic(path.join(cacheRoot, 'splits', `${splitRef.key}.json`), {
      key: splitRef.key,
      checksum: digestObject(wrong),
      payload: wrong
    })
    expect(await check()).toEqual({ entries: [], missing: [files[0].relativePath] })
  })

  it('serializes concurrent seed publication and releases locks on failure', async () => {
    const directory = path.join(root, 'store')
    const events: string[] = []
    let entered!: () => void
    const ready = new Promise<void>((resolve) => {
      entered = resolve
    })
    let finish!: () => void
    const gate = new Promise<void>((resolve) => {
      finish = resolve
    })
    const first = withSeedLock(directory, async () => {
      events.push('a-start')
      entered()
      await gate
      events.push('a-end')
    })
    await ready
    const second = withSeedLock(
      directory,
      async () => {
        events.push('b')
      },
      { pollMs: 2 }
    )
    finish()
    await Promise.all([first, second])
    expect(events).toEqual(['a-start', 'a-end', 'b'])
    await expect(
      withSeedLock(directory, () => {
        throw new Error('prepare failed')
      })
    ).rejects.toThrow('prepare failed')
    await expect(withSeedLock(directory, () => 'recovered')).resolves.toBe('recovered')
  })

  it('bounds lock waiting without stealing an active owner', async () => {
    const directory = path.join(root, 'store')
    await withSeedLock(directory, async () => {
      await expect(withSeedLock(directory, () => {}, { timeoutMs: 5, pollMs: 2 })).rejects.toThrow(
        'Timed out'
      )
    })
    expect(
      resolveKnowledgeSeedRoot({ NCURATOR_TEST_KNOWLEDGE_SEED_ROOT: path.join(root, 'persistent') })
    ).toBe(path.join(root, 'persistent'))
  })
})
