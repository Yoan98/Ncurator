import type { MarkdownLinkAccessEntry } from '../../../../../shared/types'
import { classifyMarkdownHref, extractMarkdownLinkHrefs } from '../../../../../shared/markdownLink'
import {
  resolveReferencePathsAccess,
  type ReferenceAccessRequest
} from './evidenceReferenceAccess'

/**
 * Scan delivery markdown for standard links, dedupe, resolve access once.
 * Does not modify markdown text — returns a sidecar for renderer matching.
 */
export const resolveDeliveryLinkAccess = async (
  markdown: string
): Promise<MarkdownLinkAccessEntry[]> => {
  const requests: ReferenceAccessRequest[] = []
  const requestKeys: string[] = []
  const hrefByRequestKey = new Map<string, string>()

  for (const href of extractMarkdownLinkHrefs(markdown)) {
    const classified = classifyMarkdownHref(href)
    if (classified.type === 'unknown') continue

    const request: ReferenceAccessRequest =
      classified.type === 'file'
        ? { resourceType: 'file', path: classified.path }
        : { resourceType: 'web', path: classified.url }
    const key = `${request.resourceType}\u0000${request.path}`
    if (hrefByRequestKey.has(key)) continue
    hrefByRequestKey.set(key, href)
    requestKeys.push(key)
    requests.push(request)
  }

  if (requests.length === 0) return []

  const resolutions = await resolveReferencePathsAccess({ references: requests })
  return resolutions.map((resolution, index) => {
    const requestKey = requestKeys[index]
    const href = (requestKey && hrefByRequestKey.get(requestKey)) || resolution.path
    return {
      href,
      resourceType: resolution.resourceType,
      accessStatus: resolution.accessStatus
    }
  })
}
