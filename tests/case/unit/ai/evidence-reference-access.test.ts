import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveEvidenceReferenceAccess } from '../../../../src/main/services/ai/human/shared/evidenceReferenceAccess'

const temporaryPaths: string[] = []

const createTemporaryWorkspace = async (): Promise<string> => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'ncurator-evidence-access-'))
  temporaryPaths.push(workspace)
  return workspace
}

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((entry) => rm(entry, { recursive: true })))
  vi.restoreAllMocks()
})

describe('ai unit evidence reference access', () => {
  it('marks relative paths unavailable and resolves absolute file paths', async () => {
    const workspace = await createTemporaryWorkspace()
    await mkdir(path.join(workspace, 'notes'))
    const absolutePath = path.join(workspace, 'notes', 'report.md')
    await writeFile(absolutePath, '# report')

    const references = await resolveEvidenceReferenceAccess({
      references: [
        {
          label: 'report.md',
          path: absolutePath,
          resourceType: 'file',
          usedFor: '支撑报告结论'
        },
        {
          label: 'relative.md',
          path: 'notes/report.md',
          resourceType: 'file',
          usedFor: '支撑相对路径结论'
        }
      ]
    })

    expect(references).toEqual([
      {
        label: 'report.md',
        path: absolutePath,
        resourceType: 'file',
        usedFor: '支撑报告结论',
        accessStatus: 'accessible'
      },
      {
        label: 'relative.md',
        path: 'notes/report.md',
        resourceType: 'file',
        usedFor: '支撑相对路径结论',
        accessStatus: 'unavailable'
      }
    ])
  })

  it('keeps directory and missing-file evidence but marks it unavailable', async () => {
    const workspace = await createTemporaryWorkspace()

    const references = await resolveEvidenceReferenceAccess({
      references: [
        {
          label: '终端检查结果',
          path: workspace,
          resourceType: 'file',
          usedFor: '支撑端口已经停止监听'
        },
        {
          label: 'missing.txt',
          path: 'missing.txt',
          resourceType: 'file',
          usedFor: '支撑缺失资料结论'
        }
      ]
    })

    expect(references?.map((reference) => reference.accessStatus)).toEqual([
      'unavailable',
      'unavailable'
    ])
    expect(references).toHaveLength(2)
  })

  it('checks web references once per URL and preserves every evidence item', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }))

    const references = await resolveEvidenceReferenceAccess({
      fetchImpl: fetchImpl as typeof fetch,
      references: [
        {
          label: '规则网页 A',
          path: 'https://example.com/rules',
          resourceType: 'web',
          usedFor: '支撑规则 A'
        },
        {
          label: '规则网页 B',
          path: 'https://example.com/rules',
          resourceType: 'web',
          usedFor: '支撑规则 B'
        }
      ]
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(references?.map((reference) => reference.label)).toEqual(['规则网页 A', '规则网页 B'])
    expect(references?.map((reference) => reference.accessStatus)).toEqual([
      'accessible',
      'accessible'
    ])
  })

  it('marks malformed URLs and definite web failures unavailable', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 404 }))

    const references = await resolveEvidenceReferenceAccess({
      fetchImpl: fetchImpl as typeof fetch,
      references: [
        {
          label: '无效地址',
          path: 'not-a-url',
          resourceType: 'web',
          usedFor: '支撑网页结论'
        },
        {
          label: '不存在页面',
          path: 'https://example.com/missing',
          resourceType: 'web',
          usedFor: '支撑网页结论'
        }
      ]
    })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(references?.map((reference) => reference.accessStatus)).toEqual([
      'unavailable',
      'unavailable'
    ])
  })

  it('falls back to GET when a server rejects HEAD requests', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      init?.method === 'HEAD'
        ? new Response(null, { status: 403 })
        : new Response(null, { status: 200 })
    )

    const references = await resolveEvidenceReferenceAccess({
      fetchImpl: fetchImpl as typeof fetch,
      references: [
        {
          label: 'HEAD restricted page',
          path: 'https://example.com/head-restricted',
          resourceType: 'web',
          usedFor: 'supports a web conclusion'
        }
      ]
    })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls.map((call) => call[1]?.method)).toEqual(['HEAD', 'GET'])
    expect(references?.[0].accessStatus).toBe('accessible')
  })

  it('falls back to GET when the HEAD request has a transport failure', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'HEAD') throw new TypeError('fetch failed')
      return new Response(null, { status: 204 })
    })

    const references = await resolveEvidenceReferenceAccess({
      fetchImpl: fetchImpl as typeof fetch,
      references: [
        {
          label: 'HEAD transport failure page',
          path: 'https://example.com/head-failure',
          resourceType: 'web',
          usedFor: 'supports a web conclusion'
        }
      ]
    })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls.map((call) => call[1]?.method)).toEqual(['HEAD', 'GET'])
    expect(references?.[0].accessStatus).toBe('accessible')
  })

  it('does not hide a web reference when the checker itself times out', async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted')
            error.name = 'AbortError'
            reject(error)
          })
        })
    )

    const references = await resolveEvidenceReferenceAccess({
      fetchImpl: fetchImpl as typeof fetch,
      webTimeoutMs: 5,
      references: [
        {
          label: '慢速网页',
          path: 'https://example.com/slow',
          resourceType: 'web',
          usedFor: '支撑网页结论'
        }
      ]
    })

    expect(references?.[0].accessStatus).toBe('accessible')
  })
})
