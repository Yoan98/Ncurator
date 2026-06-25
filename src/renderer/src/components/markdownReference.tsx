import React from 'react'
import { FileTextOutlined, GlobalOutlined } from '@ant-design/icons'

export type ParsedNcuratorRefKind = 'reference' | 'normal'
export type ParsedNcuratorRefResourceType = 'file' | 'web'

export type ParsedRefLink =
  | {
      type: 'reference'
      kind: ParsedNcuratorRefKind
      resourceType: ParsedNcuratorRefResourceType
      label: string
      path: string
    }
  | {
      type: 'normal'
      href?: string
    }

export const parseRefHref = (href?: string): ParsedRefLink => {
  if (!href?.startsWith('ncurator://ref?')) {
    return {
      type: 'normal',
      href
    }
  }

  try {
    const params = new URLSearchParams(href.slice('ncurator://ref?'.length))
    const rawKind = params.get('kind')
    const rawResourceType = params.get('resourceType')
    const path = params.get('path') || ''
    if (!path) {
      return {
        type: 'normal',
        href
      }
    }
    const kind: ParsedNcuratorRefKind =
      rawKind === 'reference' || rawKind === 'normal' ? rawKind : 'normal'
    const resourceType: ParsedNcuratorRefResourceType =
      rawResourceType === 'file' || rawResourceType === 'web'
        ? rawResourceType
        : /^https?:\/\//i.test(path)
          ? 'web'
          : 'file'
    const normalizedPath = path.replace(/\\/g, '/')
    const fallbackLabel = normalizedPath.split('/').filter(Boolean).pop() || normalizedPath || path
    const label = params.get('label') || fallbackLabel
    return {
      type: 'reference',
      kind,
      resourceType,
      label,
      path
    }
  } catch {
    return {
      type: 'normal',
      href
    }
  }
}

export const renderReferenceIcon = (input: {
  kind: ParsedNcuratorRefKind
  resourceType: ParsedNcuratorRefResourceType
}): React.ReactNode =>
  input.resourceType === 'web' ? (
    <GlobalOutlined />
  ) : input.resourceType === 'file' ? (
    <FileTextOutlined />
  ) : null
