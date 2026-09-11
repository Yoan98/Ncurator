import { constants as fsConstants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import path from 'node:path'
import type { BrainEvidenceReference, HumanReference } from '../types'

const DEFAULT_WEB_TIMEOUT_MS = 2500

type FetchLike = typeof fetch

export type ReferenceAccessRequest = {
  resourceType: 'file' | 'web'
  path: string
}

export type ReferenceAccessResolution = ReferenceAccessRequest & {
  accessStatus: 'accessible' | 'unavailable'
}

const resolveDefaultFetch = async (): Promise<FetchLike> => {
  if (!process.versions.electron) return fetch

  const { net } = await import('electron')
  return net.fetch as FetchLike
}

const resolveFileReference = async (
  reference: ReferenceAccessRequest
): Promise<ReferenceAccessResolution> => {
  const resolvedPath = path.isAbsolute(reference.path) ? path.normalize(reference.path) : null
  if (!resolvedPath) {
    return { resourceType: 'file', path: reference.path, accessStatus: 'unavailable' }
  }

  try {
    const fileStat = await stat(resolvedPath)
    if (!fileStat.isFile()) {
      return { resourceType: 'file', path: resolvedPath, accessStatus: 'unavailable' }
    }
    await access(resolvedPath, fsConstants.R_OK)
    return { resourceType: 'file', path: resolvedPath, accessStatus: 'accessible' }
  } catch {
    return { resourceType: 'file', path: resolvedPath, accessStatus: 'unavailable' }
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
  reference: ReferenceAccessRequest,
  fetchImpl: FetchLike,
  timeoutMs: number
): Promise<ReferenceAccessResolution> => {
  let url: URL
  try {
    url = new URL(reference.path)
  } catch {
    return { resourceType: 'web', path: reference.path, accessStatus: 'unavailable' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { resourceType: 'web', path: reference.path, accessStatus: 'unavailable' }
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
        return { resourceType: 'web', path: url.toString(), accessStatus: 'accessible' }
      }
    } catch (error) {
      if (isAbortError(error)) {
        return { resourceType: 'web', path: url.toString(), accessStatus: 'accessible' }
      }
    }

    const response = await requestWebReference(url.toString(), fetchImpl, controller.signal, 'GET')
    const accessStatus = response.ok ? 'accessible' : 'unavailable'
    await response.body?.cancel()
    return { resourceType: 'web', path: url.toString(), accessStatus }
  } catch (error) {
    return {
      resourceType: 'web',
      path: url.toString(),
      accessStatus: isAbortError(error) ? 'accessible' : 'unavailable'
    }
  } finally {
    clearTimeout(timeout)
  }
}

export const resolveReferencePathsAccess = async (input: {
  references: ReferenceAccessRequest[]
  fetchImpl?: FetchLike
  webTimeoutMs?: number
}): Promise<ReferenceAccessResolution[]> => {
  if (input.references.length === 0) return []

  const fetchImpl = input.fetchImpl || (await resolveDefaultFetch())
  const webTimeoutMs = input.webTimeoutMs ?? DEFAULT_WEB_TIMEOUT_MS
  const resolutions = new Map<string, Promise<ReferenceAccessResolution>>()

  return Promise.all(
    input.references.map((reference) => {
      const key = `${reference.resourceType}\u0000${reference.path}`
      let resolution = resolutions.get(key)
      if (!resolution) {
        resolution =
          reference.resourceType === 'file'
            ? resolveFileReference(reference)
            : resolveWebReference(reference, fetchImpl, webTimeoutMs)
        resolutions.set(key, resolution)
      }
      return resolution
    })
  )
}

export const resolveEvidenceReferenceAccess = async (input: {
  references: BrainEvidenceReference[] | undefined
  fetchImpl?: FetchLike
  webTimeoutMs?: number
}): Promise<HumanReference[] | undefined> => {
  if (!input.references || input.references.length === 0) return undefined

  const fetchImpl = input.fetchImpl || (await resolveDefaultFetch())
  const webTimeoutMs = input.webTimeoutMs ?? DEFAULT_WEB_TIMEOUT_MS
  const resolutions = new Map<string, Promise<ReferenceAccessResolution>>()

  return Promise.all(
    input.references.map((reference) => {
      const key = `${reference.resourceType}\u0000${reference.path}`
      let resolution = resolutions.get(key)
      if (!resolution) {
        resolution =
          reference.resourceType === 'file'
            ? resolveFileReference(reference)
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
