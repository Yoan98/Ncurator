import { constants as fsConstants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import path from 'node:path'
import type { BrainEvidenceReference, HumanReference } from '../types'

const DEFAULT_WEB_TIMEOUT_MS = 2500

type FetchLike = typeof fetch

const resolveDefaultFetch = async (): Promise<FetchLike> => {
  if (!process.versions.electron) return fetch

  const { net } = await import('electron')
  return net.fetch as FetchLike
}

const resolveFileReference = async (
  reference: BrainEvidenceReference,
  workspaceRootPath: string | undefined
): Promise<HumanReference> => {
  const resolvedPath = path.isAbsolute(reference.path)
    ? path.normalize(reference.path)
    : path.resolve(workspaceRootPath || process.cwd(), reference.path)

  try {
    const fileStat = await stat(resolvedPath)
    if (!fileStat.isFile()) {
      return { ...reference, path: resolvedPath, accessStatus: 'unavailable' }
    }
    await access(resolvedPath, fsConstants.R_OK)
    return { ...reference, path: resolvedPath, accessStatus: 'accessible' }
  } catch {
    return { ...reference, path: resolvedPath, accessStatus: 'unavailable' }
  }
}

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')

const requestWebReference = async (
  url: string,
  fetchImpl: FetchLike,
  signal: AbortSignal,
  method: 'HEAD' | 'GET'
): Promise<Response> =>
  fetchImpl(url, {
    method,
    redirect: 'follow',
    signal
  })

const resolveWebReference = async (
  reference: BrainEvidenceReference,
  fetchImpl: FetchLike,
  timeoutMs: number
): Promise<HumanReference> => {
  let url: URL
  try {
    url = new URL(reference.path)
  } catch {
    return { ...reference, accessStatus: 'unavailable' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ...reference, accessStatus: 'unavailable' }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    try {
      const headResponse = await requestWebReference(
        url.toString(),
        fetchImpl,
        controller.signal,
        'HEAD'
      )
      const headAccessible = headResponse.ok
      await headResponse.body?.cancel()
      if (headAccessible) {
        return { ...reference, path: url.toString(), accessStatus: 'accessible' }
      }
    } catch (error) {
      if (isAbortError(error)) {
        return { ...reference, path: url.toString(), accessStatus: 'accessible' }
      }
    }

    const response = await requestWebReference(url.toString(), fetchImpl, controller.signal, 'GET')
    const accessStatus = response.ok ? 'accessible' : 'unavailable'
    await response.body?.cancel()
    return { ...reference, path: url.toString(), accessStatus }
  } catch (error) {
    return {
      ...reference,
      path: url.toString(),
      accessStatus: isAbortError(error) ? 'accessible' : 'unavailable'
    }
  } finally {
    clearTimeout(timeout)
  }
}

export const resolveEvidenceReferenceAccess = async (input: {
  references: BrainEvidenceReference[] | undefined
  workspaceRootPath?: string
  fetchImpl?: FetchLike
  webTimeoutMs?: number
}): Promise<HumanReference[] | undefined> => {
  if (!input.references || input.references.length === 0) return undefined

  const fetchImpl = input.fetchImpl || (await resolveDefaultFetch())
  const webTimeoutMs = input.webTimeoutMs ?? DEFAULT_WEB_TIMEOUT_MS
  const resolutions = new Map<string, Promise<HumanReference>>()

  return Promise.all(
    input.references.map((reference) => {
      const key = `${reference.resourceType}\u0000${reference.path}`
      let resolution = resolutions.get(key)
      if (!resolution) {
        resolution =
          reference.resourceType === 'file'
            ? resolveFileReference(reference, input.workspaceRootPath)
            : resolveWebReference(reference, fetchImpl, webTimeoutMs)
        resolutions.set(key, resolution)
      }
      return resolution.then((resolved) => ({
        ...reference,
        path: resolved.path,
        accessStatus: resolved.accessStatus
      }))
    })
  )
}
