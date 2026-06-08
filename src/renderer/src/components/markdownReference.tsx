import React from 'react'
import {
  FileTextOutlined,
  GlobalOutlined,
  LinkOutlined,
  SnippetsOutlined
} from '@ant-design/icons'

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
    const url = new URL(href)
    const kind = url.searchParams.get('kind')
    const resourceType = url.searchParams.get('resourceType')
    const label = url.searchParams.get('label') || ''
    const path = url.searchParams.get('path') || ''
    if (
      (kind !== 'reference' && kind !== 'normal') ||
      (resourceType !== 'file' && resourceType !== 'web') ||
      !label ||
      !path
    ) {
      return {
        type: 'normal',
        href
      }
    }
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
  input.kind === 'reference' ? (
    <SnippetsOutlined />
  ) : input.resourceType === 'web' ? (
    <GlobalOutlined />
  ) : input.resourceType === 'file' ? (
    <FileTextOutlined />
  ) : (
    <LinkOutlined />
  )
