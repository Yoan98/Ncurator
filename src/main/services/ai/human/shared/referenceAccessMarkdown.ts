import {
  buildNcuratorRefHref,
  parseNcuratorRefHref
} from '../../../../../shared/ncuratorRef'
import {
  resolveReferencePathsAccess,
  type ReferenceAccessRequest
} from './evidenceReferenceAccess'

const REF_HREF_RE = /ncurator:\/\/ref\?[^)\s]+/g

export const injectReferenceAccessStatus = async (markdown: string): Promise<string> => {
  const referenceLinks: Array<{
    href: string
    request: ReferenceAccessRequest
  }> = []

  for (const match of markdown.matchAll(REF_HREF_RE)) {
    const href = match[0]
    const parsed = parseNcuratorRefHref(href)
    if (parsed.type === 'reference' && parsed.kind === 'reference') {
      referenceLinks.push({
        href,
        request: { resourceType: parsed.resourceType, path: parsed.path }
      })
    }
  }

  if (referenceLinks.length === 0) return markdown

  const resolutions = await resolveReferencePathsAccess({
    references: referenceLinks.map((link) => link.request)
  })
  const statusByKey = new Map(
    resolutions.map((resolution) => [
      `${resolution.resourceType}\u0000${resolution.path}`,
      resolution.accessStatus
    ])
  )

  let output = markdown
  for (const link of referenceLinks) {
    const parsed = parseNcuratorRefHref(link.href)
    if (parsed.type !== 'reference') continue
    const accessStatus =
      statusByKey.get(`${link.request.resourceType}\u0000${link.request.path}`) || 'unavailable'
    const nextHref = buildNcuratorRefHref({
      kind: 'reference',
      resourceType: parsed.resourceType,
      label: parsed.label,
      path: parsed.path,
      accessStatus
    })
    output = output.replace(link.href, nextHref)
  }

  return output
}
