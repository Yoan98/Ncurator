import { DOMParser } from '@xmldom/xmldom'
import { indexAnnotations } from '../adapters/ooxml/annotations'
import { sectionsFor } from '../adapters/ooxml/sections'
import { resolveInternalNodeId } from './identity'
import type { DocSnapshot } from './types'
const localAttribute = (node: Element, name: string): string => {
  for (let index = 0; index < node.attributes.length; index += 1) {
    const attribute = node.attributes.item(index)
    if (attribute?.localName === name) return attribute.value
  }
  return ''
}

export async function readAnnotationRecords(
  snapshot: Extract<DocSnapshot, { format: 'docx' }>,
  nodeIds?: string[]
) {
  const commentsXml = await snapshot.bundle.zip.file('word/comments.xml')?.async('text')
  const extendedXml = await snapshot.bundle.zip.file('word/commentsExtended.xml')?.async('text')
  const settingsXml = await snapshot.bundle.zip.file('word/settings.xml')?.async('text')
  const commentsDom = commentsXml
    ? new DOMParser().parseFromString(commentsXml, 'application/xml')
    : undefined
  const extendedDom = extendedXml
    ? new DOMParser().parseFromString(extendedXml, 'application/xml')
    : undefined
  const comments = commentsDom
    ? Array.from(commentsDom.getElementsByTagNameNS('*', 'comment')).map((comment) => {
        const paragraph = Array.from(comment.getElementsByTagNameNS('*', 'p')).at(-1)
        return {
          commentId: localAttribute(comment, 'id'),
          text: Array.from(comment.getElementsByTagNameNS('*', 't'))
            .map((text) => text.textContent || '')
            .join(''),
          author: localAttribute(comment, 'author'),
          paragraphId: paragraph ? localAttribute(paragraph, 'paraId') : ''
        }
      })
    : []
  const commentIdByParagraphId = new Map(
    comments
      .filter((comment) => comment.paragraphId)
      .map((comment) => [comment.paragraphId, comment.commentId] as const)
  )
  const parentByParagraphId = new Map<string, string>()
  if (extendedDom) {
    Array.from(extendedDom.getElementsByTagNameNS('*', 'commentEx')).forEach((comment) => {
      const paragraphId = localAttribute(comment, 'paraId')
      const parentParagraphId = localAttribute(comment, 'paraIdParent')
      const parentCommentId = commentIdByParagraphId.get(parentParagraphId)
      if (paragraphId && parentCommentId) parentByParagraphId.set(paragraphId, parentCommentId)
    })
  }
  const annotationIndex = indexAnnotations(snapshot.bundle, snapshot.index)
  const scopes = nodeIds?.map((id) => {
    const section = snapshot.structure?.sections.find((s) => s.nodeId === id)
    const slot = snapshot.structure?.slots.get(id)
    if (section || slot) return { section, slot }
    const internal = resolveInternalNodeId(
      snapshot.identity,
      snapshot.aliases?.get(id) ?? id.split('@').at(-1)!
    )
    const content = snapshot.index.nodesById.get(internal)
    if (!content) throw new Error('unknown annotation scope')
    return { content }
  })
  const inScope = (ids: string[]) =>
    !scopes ||
    ids.some((id) => {
      const entry = snapshot.index.nodesById.get(id)
      if (!entry) return false
      const root = 'ownerNodeId' in entry ? snapshot.index.nodesById.get(entry.ownerNodeId) : entry
      return scopes.some((scope) => {
        if (scope.section)
          return (
            root &&
            'nodeIndex' in root &&
            sectionsFor(snapshot.structure, root.story.storyId, root.nodeIndex).includes(
              scope.section.nodeId
            )
          )
        if (scope.slot) return scope.slot.partName === entry.partName
        if (!scope.content) return false
        for (let n: Node | null = entry.node; n; n = n.parentNode)
          if (n === scope.content.node) return true
        for (let n: Node | null = scope.content.node; n; n = n.parentNode)
          if (n === entry.node) return true
        return false
      })
    })
  const commentsById = new Map(comments.map((comment) => [comment.commentId, comment]))
  const anchorFor = (comment: (typeof comments)[number]) => {
    let id: string | undefined = comment.commentId
    const seen = new Set<string>()
    while (id && !seen.has(id)) {
      const anchor = annotationIndex.comments.get(id)
      if (anchor) return anchor
      seen.add(id)
      const entry = commentsById.get(id)
      id = entry && parentByParagraphId.get(entry.paragraphId)
    }
    return undefined
  }
  const publicAnchors = (ids: string[]) =>
    ids
      .map(
        (id) =>
          snapshot.identity.publicIdByInternalId.get(id) ??
          snapshot.identity.publicNodeIdByInternalId.get(id)
      )
      .filter((v): v is string => Boolean(v))
  const revisions = [...annotationIndex.revisions.values()]
    .filter(
      ({ record, elements }) =>
        inScope(record.anchorNodeIds) ||
        elements.some((element) => {
          for (let n: Node | null = element; n; n = n.parentNode) {
            const section = snapshot.structure?.sectionByBodyBlock.get(n)
            if (section) return scopes?.some((scope) => scope.section?.nodeId === section)
          }
          return false
        })
    )
    .map(({ record }) => ({ ...record, anchorNodeIds: publicAnchors(record.anchorNodeIds) }))
  const trackTag = settingsXml
    ? new DOMParser()
        .parseFromString(settingsXml, 'application/xml')
        .getElementsByTagNameNS('*', 'trackRevisions')
        .item(0)
    : null
  return {
    checksum: snapshot.checksum,
    trackChanges: Boolean(
      trackTag && !['0', 'false', 'off'].includes(localAttribute(trackTag, 'val'))
    ),
    comments: comments.flatMap((comment) => {
      const anchor = anchorFor(comment)
      const ids = anchor?.anchorNodeIds ?? []
      if (!inScope(ids)) return []
      const parentCommentId = parentByParagraphId.get(comment.paragraphId)
      return [
        {
          commentId: comment.commentId,
          anchorNodeIds: publicAnchors(ids),
          anchorText: anchor?.anchorText,
          text: comment.text,
          ...(comment.author ? { author: comment.author } : {}),
          ...(parentCommentId ? { parentCommentId } : {})
        }
      ]
    }),
    revisions
  }
}
