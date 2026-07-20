import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createWorkspaceKnowledgeCache } from '../../../src/main/services/workspace/WorkspaceKnowledgeCache'

const createdDirectories: string[] = []
const originalEnabled = process.env.NCURATOR_WORKSPACE_KNOWLEDGE_CACHE
const originalPath = process.env.NCURATOR_WORKSPACE_KNOWLEDGE_CACHE_PATH

afterEach(async () => {
  if (originalEnabled === undefined) delete process.env.NCURATOR_WORKSPACE_KNOWLEDGE_CACHE
  else process.env.NCURATOR_WORKSPACE_KNOWLEDGE_CACHE = originalEnabled
  if (originalPath === undefined) delete process.env.NCURATOR_WORKSPACE_KNOWLEDGE_CACHE_PATH
  else process.env.NCURATOR_WORKSPACE_KNOWLEDGE_CACHE_PATH = originalPath
  await Promise.all(
    createdDirectories.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true })
    })
  )
})

describe('workspace knowledge cache', () => {
  it('按内容、扩展名和模型隔离缓存，并记录 hit/miss', async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), 'ncurator-knowledge-cache-'))
    createdDirectories.push(cacheRoot)
    process.env.NCURATOR_WORKSPACE_KNOWLEDGE_CACHE = '1'
    process.env.NCURATOR_WORKSPACE_KNOWLEDGE_CACHE_PATH = cacheRoot

    const cache = createWorkspaceKnowledgeCache()
    if (!cache) throw new Error('知识库缓存没有启用')

    await expect(
      cache.loadSplitSnapshot({ contentHash: 'content-a', fileExt: '.md' })
    ).resolves.toBeNull()
    await cache.saveSplitSnapshot({
      contentHash: 'content-a',
      fileExt: '.md',
      chunks: [{ text: 'hello', page: 1 }]
    })
    await expect(
      cache.loadSplitSnapshot({ contentHash: 'content-a', fileExt: '.md' })
    ).resolves.toMatchObject({ contentHash: 'content-a' })
    await expect(
      cache.loadSplitSnapshot({ contentHash: 'content-b', fileExt: '.md' })
    ).resolves.toBeNull()
    await expect(
      cache.loadSplitSnapshot({ contentHash: 'content-a', fileExt: '.txt' })
    ).resolves.toBeNull()

    await expect(
      cache.loadVectorSnapshot({
        contentHash: 'content-a',
        fileExt: '.md',
        modelName: 'model-a'
      })
    ).resolves.toBeNull()
    await cache.saveVectorSnapshot({
      contentHash: 'content-a',
      fileExt: '.md',
      modelName: 'model-a',
      vectors: [[1, 2, 3]]
    })
    await expect(
      cache.loadVectorSnapshot({
        contentHash: 'content-a',
        fileExt: '.md',
        modelName: 'model-a'
      })
    ).resolves.toMatchObject({ modelName: 'model-a' })
    await expect(
      cache.loadVectorSnapshot({
        contentHash: 'content-a',
        fileExt: '.md',
        modelName: 'model-b'
      })
    ).resolves.toBeNull()

    const stats = JSON.parse(await readFile(path.join(cacheRoot, 'stats.json'), 'utf8')) as Record<
      string,
      number
    >
    expect(stats).toEqual({
      splitCacheHits: 1,
      splitCacheMisses: 3,
      vectorCacheHits: 1,
      vectorCacheMisses: 2
    })
  })
})
