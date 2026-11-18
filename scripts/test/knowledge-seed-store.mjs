import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const digest = (value) => createHash('sha256').update(value).digest('hex')
const HEX = /^[a-f0-9]{64}$/u
const KINDS = new Set(['splits', 'vectors'])
const inside = (root, target) => {
  const relative = path.relative(root, target)
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  )
}

/** Stable between release workspaces; an explicit override denotes the full cache root. */
export const resolveKnowledgeSeedRoot = (env = process.env) =>
  path.resolve(
    String(env.NCURATOR_TEST_KNOWLEDGE_SEED_ROOT || '').trim() ||
      path.join(
        os.homedir(),
        '.ncurator',
        'test-knowledge-seeds',
        'v3',
        `${process.platform}-${process.arch}`
      )
  )

/** Fixture identity includes names and bytes, never the temporary checkout address. */
export const snapshotFixtureInputs = async (paths, root = process.cwd()) => {
  const repository = await realpath(root)
  const fixtures = path.join(repository, 'tests', 'fixtures')
  const files = new Map()
  const assertNoLinks = async (target) => {
    let current = repository
    for (const part of path.relative(repository, target).split(path.sep).filter(Boolean)) {
      current = path.join(current, part)
      if ((await lstat(current)).isSymbolicLink())
        throw new Error(`Fixture symlinks are not allowed: ${current}`)
    }
  }
  const visit = async (source) => {
    const info = await lstat(source)
    if (info.isSymbolicLink()) throw new Error(`Fixture symlinks are not allowed: ${source}`)
    if (info.isDirectory()) {
      for (const name of (await readdir(source)).sort()) {
        if (name !== '.DS_Store') await visit(path.join(source, name))
      }
    } else if (info.isFile()) {
      if (path.basename(source) === '.DS_Store') return
      const relativePath = path.relative(repository, source).split(path.sep).join('/')
      files.set(relativePath, { source, relativePath, sha256: digest(await readFile(source)) })
    } else throw new Error(`Fixture input is not a regular file or directory: ${source}`)
  }
  for (const input of paths) {
    // Resolve relative arguments against the caller's checkout, then canonical root.
    const absolute = path.resolve(root, input)
    const target = inside(repository, absolute)
      ? absolute
      : path.resolve(repository, path.relative(path.resolve(root), absolute))
    if (!inside(fixtures, target))
      throw new Error(`Fixture input must be inside tests/fixtures: ${input}`)
    await assertNoLinks(target)
    await visit(target)
  }
  const sorted = [...files.values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  return {
    files: sorted,
    fingerprint: digest(
      JSON.stringify(sorted.map(({ relativePath, sha256 }) => ({ relativePath, sha256 })))
    )
  }
}

export const writeSeedJsonAtomically = async (file, value) => {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(value), { encoding: 'utf8', flag: 'wx' })
    await rename(temporary, file)
  } finally {
    await rm(temporary, { force: true })
  }
}

const validPayload = (kind, payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false
  if (kind === 'splits') {
    return (
      typeof payload.contentHash === 'string' &&
      typeof payload.fileExt === 'string' &&
      Array.isArray(payload.chunks) &&
      payload.chunks.every(
        (chunk) => chunk && typeof chunk.text === 'string' && Number.isFinite(chunk.page)
      )
    )
  }
  if (kind !== 'vectors' || !Array.isArray(payload.vectors)) return false
  return payload.vectors.every(
    (vector) =>
      Array.isArray(vector) &&
      vector.length > 0 &&
      vector.length === payload.vectors[0].length &&
      vector.every(Number.isFinite)
  )
}

const readEntry = async (root, kind, key) => {
  if (!KINDS.has(kind) || !HEX.test(key)) return null
  try {
    const directory = path.join(root, kind)
    if (!(await lstat(directory)).isDirectory() || (await lstat(directory)).isSymbolicLink())
      return null
    const file = path.join(directory, `${key}.json`)
    const info = await lstat(file)
    if (!info.isFile() || info.isSymbolicLink()) return null
    const entry = JSON.parse(await readFile(file, 'utf8'))
    if (
      !entry ||
      entry.key !== key ||
      !HEX.test(entry.checksum) ||
      !validPayload(kind, entry.payload) ||
      digest(JSON.stringify(entry.payload)) !== entry.checksum
    )
      return null
    return entry
  } catch {
    return null
  }
}

/** Copies only complete, validated pure computations; never hardlinks, DBs, locks or statistics. */
export const cloneKnowledgeEntries = async (source, destination, selectedRefs) => {
  if (
    inside(path.resolve(source), path.resolve(destination)) ||
    inside(path.resolve(destination), path.resolve(source))
  )
    throw new Error('Seed source and destination must be separate trees')
  await mkdir(destination, { recursive: true })
  const realSource = await realpath(source).catch((error) => {
    if (error.code === 'ENOENT') return path.resolve(source)
    throw error
  })
  const realDestination = await realpath(destination)
  if (inside(realSource, realDestination) || inside(realDestination, realSource))
    throw new Error('Seed source and destination must be separate trees')
  for (const kind of KINDS) {
    const info = await lstat(path.join(destination, kind)).catch((error) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (info && (!info.isDirectory() || info.isSymbolicLink()))
      throw new Error(`Unsafe seed destination: ${kind}`)
  }
  if (selectedRefs !== undefined && !(await validateKnowledgeRefs(source, selectedRefs)))
    throw new Error('Invalid knowledge seed manifest references')
  const selected =
    selectedRefs === undefined ? null : new Set(selectedRefs.map((ref) => `${ref.kind}/${ref.key}`))
  const refs = []
  for (const kind of KINDS) {
    const names = await readdir(path.join(source, kind)).catch((error) => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    for (const name of names.sort()) {
      if (!/^[a-f0-9]{64}\.json$/u.test(name)) continue
      const key = name.slice(0, -5)
      if (selected && !selected.has(`${kind}/${key}`)) continue
      const entry = await readEntry(source, kind, key)
      if (!entry) continue
      const previous = await readEntry(destination, kind, key)
      if (previous && previous.checksum !== entry.checksum)
        throw new Error(`Conflicting knowledge seed entry: ${kind}/${key}`)
      if (!previous) await writeSeedJsonAtomically(path.join(destination, kind, name), entry)
      refs.push({ kind, key, checksum: entry.checksum })
    }
  }
  return refs
}

/** Every manifest reference must exist exactly once and pass the production checksum/shape rules. */
export const validateKnowledgeRefs = async (root, refs) => {
  if (!Array.isArray(refs)) return false
  const seen = new Set()
  for (const ref of refs) {
    if (!ref || !KINDS.has(ref.kind) || !HEX.test(ref.key) || !HEX.test(ref.checksum)) return false
    const id = `${ref.kind}/${ref.key}`
    if (seen.has(id)) return false
    seen.add(id)
    const entry = await readEntry(root, ref.kind, ref.key)
    if (!entry || entry.checksum !== ref.checksum) return false
  }
  return true
}

/** One seed publisher at a time. Live owners never expire; dead owners can be reclaimed. */
export const withSeedLock = async (root, action, options = {}) => {
  const { timeoutMs = 900_000, pollMs = 100, signal } = options
  await mkdir(root, { recursive: true })
  const directory = path.join(root, '.seed.lock')
  const owner = `${process.pid}-${randomUUID()}`
  const started = Date.now()
  for (;;) {
    signal?.throwIfAborted()
    try {
      await mkdir(directory)
      try {
        await writeFile(path.join(directory, owner), '', { flag: 'wx' })
      } catch (error) {
        await rmdir(directory).catch(() => {})
        throw error
      }
      break
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const lockInfo = await lstat(directory).catch(() => null)
      if (lockInfo && (!lockInfo.isDirectory() || lockInfo.isSymbolicLink()))
        throw new Error(`Unsafe seed lock directory: ${directory}`)
      const owners = await readdir(directory).catch(() => [])
      for (const old of owners) {
        const pid = Number(old.split('-')[0])
        if (!Number.isSafeInteger(pid) || pid <= 0 || !/^\d+-[a-f0-9-]+$/u.test(old)) continue
        try {
          process.kill(pid, 0)
        } catch (probe) {
          if (probe.code !== 'ESRCH') continue
          try {
            await unlink(path.join(directory, old))
            await rmdir(directory)
          } catch {
            /* another contender won */
          }
        }
      }
      // Recover a creator that died between mkdir and writing its PID token.
      if (!owners.length) {
        const info = await lstat(directory).catch(() => null)
        if (info?.isDirectory() && Date.now() - info.mtimeMs > 5_000)
          await rmdir(directory).catch(() => {})
      }
      if (Date.now() - started >= timeoutMs)
        throw new Error(`Timed out waiting for knowledge seed lock: ${directory}`)
      await delay(pollMs, undefined, { signal })
    }
  }
  try {
    return await action()
  } finally {
    // Remove our token only; never delete a successor's lock recursively.
    await unlink(path.join(directory, owner))
    await rmdir(directory)
  }
}

export const digestObject = (value) => digest(JSON.stringify(value))
export const writeSeedJsonAtomic = writeSeedJsonAtomically

/** Stream model bytes; root/inode metadata memoizes hashing, not the resulting model identity. */
export const snapshotModelAssets = async (root, memoRoot) => {
  const entries = []
  const walk = async (directory) => {
    for (const name of (await readdir(directory)).sort()) {
      const source = path.join(directory, name)
      const info = await lstat(source, { bigint: true })
      if (info.isSymbolicLink()) throw new Error(`Model asset symlinks are not allowed: ${source}`)
      if (info.isDirectory()) await walk(source)
      else if (info.isFile() && name.startsWith('.')) continue
      else if (info.isFile())
        entries.push({
          source,
          name: path.relative(root, source).split(path.sep).join('/'),
          signature: `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`
        })
      else throw new Error(`Unsupported model asset: ${source}`)
    }
  }
  await walk(root)
  if (!entries.length) throw new Error(`No model assets found: ${root}`)
  const values = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const identity = digestObject({
      source: path.resolve(entry.source),
      signature: entry.signature
    })
    const file = memoRoot ? path.join(memoRoot, 'model-digests', `${identity}.json`) : null
    const previous = file
      ? await readFile(file, 'utf8')
          .then(JSON.parse)
          .catch(() => null)
      : null
    let sha256 =
      previous?.identity === identity && HEX.test(previous.digest) ? previous.digest : null
    if (!sha256) {
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(entry.source)) hash.update(chunk)
      sha256 = hash.digest('hex')
      const after = await lstat(entry.source, { bigint: true })
      if (
        `${after.dev}:${after.ino}:${after.size}:${after.mtimeNs}:${after.ctimeNs}` !==
        entry.signature
      )
        throw new Error(`Model asset changed during hashing: ${entry.source}`)
      if (file) await writeSeedJsonAtomically(file, { identity, digest: sha256 })
    }
    values.push({ name: entry.name, sha256 })
  }
  return { files: values, fingerprint: digestObject(values) }
}

/** Verify exact production schema-3 computations, not merely unrelated valid pool entries.
 * Callers supply only supported local fixtures and the identity of the actual target app.
 */
export const verifyLocalFixtureCacheCoverage = async (
  cacheRoot,
  files,
  pipeline,
  modelSnapshot,
  modelName = 'local:jinaai/jina-embeddings-v2-base-zh'
) => {
  if (
    !pipeline ||
    typeof pipeline.split !== 'string' ||
    !pipeline.split ||
    typeof pipeline.embedding !== 'string' ||
    !pipeline.embedding ||
    ['schema', 'cacheSchema', 'keySchema'].some(
      (key) => pipeline[key] !== undefined && pipeline[key] !== 3
    ) ||
    typeof modelName !== 'string' ||
    !modelName.startsWith('local:') ||
    modelName.length <= 6
  )
    throw new Error('Unsupported local knowledge cache identity (requires schema 3)')
  if (!Array.isArray(files) || !Array.isArray(modelSnapshot?.files) || !modelSnapshot.files.length)
    throw new Error('Invalid fixture or model snapshot')
  const names = new Set()
  const assets = modelSnapshot.files
    .map((file) => {
      if (typeof file?.name !== 'string' || !file.name || !HEX.test(file.sha256))
        throw new Error('Invalid model asset snapshot')
      const name = path.normalize(file.name)
      if (
        path.isAbsolute(name) ||
        name === '..' ||
        name.startsWith(`..${path.sep}`) ||
        names.has(name)
      )
        throw new Error('Invalid or duplicate model asset name')
      names.add(name)
      return { name, sha256: file.sha256 }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
  const hash = createHash('sha256')
  for (const asset of assets) hash.update(asset.name).update('\0').update(asset.sha256).update('\0')
  const modelAssets = hash.digest('hex')
  const entries = new Map()
  const missing = []
  for (const file of files) {
    if (
      typeof file?.source !== 'string' ||
      typeof file.relativePath !== 'string' ||
      !HEX.test(file.sha256)
    )
      throw new Error('Invalid fixture snapshot')
    const bytes = await readFile(file.source)
    // A changed input must never be certified under its earlier fixture stamp.
    if (digest(bytes) !== file.sha256) {
      missing.push(file.relativePath)
      continue
    }
    const contentHash = createHash('sha1').update(bytes).digest('hex')
    const fileExt = path.extname(file.source).toLowerCase()
    const splitKey = digestObject({
      schema: 3,
      pipeline: pipeline.split,
      contentHash,
      fileExt,
      sourceName: path.basename(file.source)
    })
    const split = await readEntry(cacheRoot, 'splits', splitKey)
    if (!split || split.payload.contentHash !== contentHash || split.payload.fileExt !== fileExt) {
      missing.push(file.relativePath)
      continue
    }
    const vectorKey = digestObject({
      schema: 3,
      pipeline: pipeline.embedding,
      modelName,
      modelAssets,
      texts: split.payload.chunks.map((chunk) => chunk.text)
    })
    const vectors = await readEntry(cacheRoot, 'vectors', vectorKey)
    if (!vectors || vectors.payload.vectors.length !== split.payload.chunks.length) {
      missing.push(file.relativePath)
      continue
    }
    entries.set(`splits/${splitKey}`, { kind: 'splits', key: splitKey, checksum: split.checksum })
    entries.set(`vectors/${vectorKey}`, {
      kind: 'vectors',
      key: vectorKey,
      checksum: vectors.checksum
    })
  }
  return { entries: [...entries.values()], missing }
}
