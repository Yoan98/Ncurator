import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { isWorkspaceInstructionsMessage } from '../../../../src/main/services/ai/human/node/utils/messageTail'
import { projectMessagesForMainModel } from '../../../../src/main/services/ai/human/memory/multimodal'
import { ensureWorkspaceInstructionsMessage } from '../../../../src/main/services/ai/human/workspaceInstructionContext'

const temporaryDirectories: string[] = []

const createTemporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'ncurator-agents-context-'))
  temporaryDirectories.push(directory)
  return directory
}

const createCurrentUser = (content: string): HumanMessage =>
  new HumanMessage({
    content,
    additional_kwargs: { ncurator_current_user: true }
  })

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('ai unit workspace instruction context', () => {
  it('inserts one user message after the system prompt and never duplicates it', async () => {
    const root = await createTemporaryDirectory()
    await writeFile(join(root, 'AGENTS.md'), '# Project rules\n\nRead docs first.')
    const cache = createHumanRuntimeCache()
    cache.messages = [new SystemMessage('system'), createCurrentUser('do work')]

    await ensureWorkspaceInstructionsMessage({ ctx: { workspaceRoots: [root] }, cache })

    const inserted = cache.messages?.[1]
    expect(cache.messages).toHaveLength(3)
    expect(inserted && isWorkspaceInstructionsMessage(inserted)).toBe(true)
    expect(String(inserted?.content)).toContain(join(root, 'AGENTS.md'))
    expect(String(inserted?.content)).toContain('Read docs first.')
    const projected = await projectMessagesForMainModel(cache.messages || [])
    expect(projected[1]).toBe(inserted)

    await ensureWorkspaceInstructionsMessage({ ctx: { workspaceRoots: [root] }, cache })
    expect(cache.messages).toHaveLength(3)
  })

  it('caches a checked state without a message when no AGENTS.md exists', async () => {
    const root = await createTemporaryDirectory()
    const cache = createHumanRuntimeCache()
    cache.messages = [new SystemMessage('system'), createCurrentUser('do work')]

    await ensureWorkspaceInstructionsMessage({ ctx: { workspaceRoots: [root] }, cache })

    expect(cache.workspaceInstructions).toEqual({ checked: true })
    expect(cache.messages?.some(isWorkspaceInstructionsMessage)).toBe(false)
  })

  it('reads the file once per run and picks up changes only for a new run', async () => {
    const root = await createTemporaryDirectory()
    await writeFile(join(root, 'AGENTS.md'), '# Version one')
    const firstCache = createHumanRuntimeCache()
    firstCache.messages = [new SystemMessage('system'), createCurrentUser('do work')]

    await ensureWorkspaceInstructionsMessage({ ctx: { workspaceRoots: [root] }, cache: firstCache })
    expect(String(firstCache.messages?.[1]?.content)).toContain('Version one')

    await writeFile(join(root, 'AGENTS.md'), '# Version two')
    await ensureWorkspaceInstructionsMessage({ ctx: { workspaceRoots: [root] }, cache: firstCache })
    expect(String(firstCache.messages?.[1]?.content)).toContain('Version one')
    expect(String(firstCache.messages?.[1]?.content)).not.toContain('Version two')

    const secondCache = createHumanRuntimeCache()
    secondCache.messages = [new SystemMessage('system'), createCurrentUser('do work')]
    await ensureWorkspaceInstructionsMessage({
      ctx: { workspaceRoots: [root] },
      cache: secondCache
    })
    expect(String(secondCache.messages?.[1]?.content)).toContain('Version two')
  })

  it('does not rescan when AGENTS.md appears after the run started', async () => {
    const root = await createTemporaryDirectory()
    const cache = createHumanRuntimeCache()
    cache.messages = [new SystemMessage('system'), createCurrentUser('do work')]

    await ensureWorkspaceInstructionsMessage({ ctx: { workspaceRoots: [root] }, cache })
    await writeFile(join(root, 'AGENTS.md'), '# Late file')
    await ensureWorkspaceInstructionsMessage({ ctx: { workspaceRoots: [root] }, cache })

    expect(cache.messages?.some(isWorkspaceInstructionsMessage)).toBe(false)
  })

  it('keeps the cached message when AGENTS.md disappears mid-run', async () => {
    const root = await createTemporaryDirectory()
    await writeFile(join(root, 'AGENTS.md'), '# Initial rules')
    const cache = createHumanRuntimeCache()
    cache.messages = [new SystemMessage('system'), createCurrentUser('do work')]

    await ensureWorkspaceInstructionsMessage({ ctx: { workspaceRoots: [root] }, cache })
    await rm(join(root, 'AGENTS.md'))
    await ensureWorkspaceInstructionsMessage({ ctx: { workspaceRoots: [root] }, cache })

    expect(cache.messages?.[1] && isWorkspaceInstructionsMessage(cache.messages[1])).toBe(true)
    expect(String(cache.messages?.[1]?.content)).toContain('# Initial rules')
  })

  it('reinserts the cached message after the array is rebuilt without it', async () => {
    const root = await createTemporaryDirectory()
    await writeFile(join(root, 'AGENTS.md'), '# Project rules')
    const cache = createHumanRuntimeCache()
    cache.messages = [new SystemMessage('system'), createCurrentUser('first turn')]

    await ensureWorkspaceInstructionsMessage({ ctx: { workspaceRoots: [root] }, cache })
    const cachedMessage = cache.messages?.[1]

    await writeFile(join(root, 'AGENTS.md'), '# Changed after run start')
    cache.messages = [new SystemMessage('system'), createCurrentUser('after compaction')]
    await ensureWorkspaceInstructionsMessage({ ctx: { workspaceRoots: [root] }, cache })

    expect(cache.messages).toHaveLength(3)
    expect(cache.messages?.[1]).toBe(cachedMessage)
    expect(String(cache.messages?.[1]?.content)).toContain('# Project rules')
    expect(String(cache.messages?.[1]?.content)).not.toContain('# Changed after run start')
    expect(isWorkspaceInstructionsMessage(cache.messages?.[1] || new HumanMessage(''))).toBe(true)
  })
})
