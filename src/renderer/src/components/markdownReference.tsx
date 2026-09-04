import React from 'react'
import { FileTextOutlined, GlobalOutlined } from '@ant-design/icons'
import {
  classifyMarkdownHref,
  findMarkdownLinkAccess,
  transformAssistantMarkdownUrl
} from '../../../shared/markdownLink'
import {
  parseNcuratorRefHref,
  normalizeNcuratorRefMarkdownLinks,
  repairInlineCodeWrappedNcuratorLinks,
  type NcuratorRefKind,
  type NcuratorRefResourceType,
  type ParsedNcuratorRef
} from '../../../shared/ncuratorRef'
import type { MarkdownLinkAccessEntry, MarkdownLinkResourceType } from '../../../shared/types'

export type ParsedNcuratorRefKind = NcuratorRefKind
export type ParsedNcuratorRefResourceType = NcuratorRefResourceType
export type ParsedRefLink = ParsedNcuratorRef

export const parseRefHref = parseNcuratorRefHref
export const normalizeRefMarkdownLinks = normalizeNcuratorRefMarkdownLinks
export { repairInlineCodeWrappedNcuratorLinks, transformAssistantMarkdownUrl }

export type OpenableMarkdownReference = {
  resourceType: MarkdownLinkResourceType
  label: string
  path: string
}

export type ResolvedMarkdownLink =
  | {
      mode: 'unavailable'
      reason: 'access' | 'unknown' | 'legacy_invalid'
    }
  | {
      mode: 'openable'
      reference: OpenableMarkdownReference
    }
  | {
      mode: 'external'
      href: string
    }

/**
 * Resolve a rendered href for UI.
 * - Legacy `ncurator://ref` uses embedded accessStatus.
 * - When `linkAccess` is defined (delivery finished), match sidecar; missing → unavailable.
 * - When `linkAccess` is undefined (streaming), classified links stay openable.
 */
export const resolveMarkdownLinkForRender = (input: {
  href?: string
  linkAccess?: MarkdownLinkAccessEntry[]
  label: string
}): ResolvedMarkdownLink => {
  const href = input.href || ''
  const legacy = parseNcuratorRefHref(href)
  if (legacy.type === 'invalid') {
    return { mode: 'unavailable', reason: 'legacy_invalid' }
  }
  if (legacy.type === 'reference') {
    if (legacy.kind === 'reference' && legacy.accessStatus === 'unavailable') {
      return { mode: 'unavailable', reason: 'access' }
    }
    return {
      mode: 'openable',
      reference: {
        resourceType: legacy.resourceType,
        label: legacy.label || input.label,
        path: legacy.path
      }
    }
  }

  const classified = classifyMarkdownHref(href)
  if (classified.type === 'unknown') {
    if (input.linkAccess !== undefined) {
      return { mode: 'unavailable', reason: 'unknown' }
    }
    return href ? { mode: 'external', href } : { mode: 'unavailable', reason: 'unknown' }
  }

  if (input.linkAccess !== undefined) {
    const access = findMarkdownLinkAccess(input.linkAccess, href)
    if (!access || access.accessStatus === 'unavailable') {
      return { mode: 'unavailable', reason: 'access' }
    }
  }

  return {
    mode: 'openable',
    reference: {
      resourceType: classified.type === 'web' ? 'web' : 'file',
      label: input.label,
      path: classified.type === 'web' ? classified.url : classified.path
    }
  }
}

export const renderReferenceIcon = (resourceType: MarkdownLinkResourceType): React.ReactNode =>
  resourceType === 'web' ? <GlobalOutlined /> : <FileTextOutlined />
