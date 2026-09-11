import React from 'react'
import { FileTextOutlined, GlobalOutlined } from '@ant-design/icons'
import {
  transformAssistantMarkdownUrl,
  resolveMarkdownLinkForRender,
  type OpenableMarkdownReference,
  type ResolvedMarkdownLink
} from '../../../shared/markdownLink'
import {
  parseNcuratorRefHref,
  normalizeNcuratorRefMarkdownLinks,
  repairInlineCodeWrappedNcuratorLinks,
  type NcuratorRefKind,
  type NcuratorRefResourceType,
  type ParsedNcuratorRef
} from '../../../shared/ncuratorRef'
import type { MarkdownLinkResourceType } from '../../../shared/types'

export type { OpenableMarkdownReference, ResolvedMarkdownLink }
export { resolveMarkdownLinkForRender, transformAssistantMarkdownUrl }

export type ParsedNcuratorRefKind = NcuratorRefKind
export type ParsedNcuratorRefResourceType = NcuratorRefResourceType
export type ParsedRefLink = ParsedNcuratorRef

export const parseRefHref = parseNcuratorRefHref
export const normalizeRefMarkdownLinks = normalizeNcuratorRefMarkdownLinks
export { repairInlineCodeWrappedNcuratorLinks }

export const renderReferenceIcon = (resourceType: MarkdownLinkResourceType): React.ReactNode =>
  resourceType === 'web' ? <GlobalOutlined /> : <FileTextOutlined />
