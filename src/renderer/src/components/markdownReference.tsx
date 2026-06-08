import React from 'react'
import {
  FileTextOutlined,
  GlobalOutlined,
  LinkOutlined,
  SnippetsOutlined
} from '@ant-design/icons'

export type ParsedNcuratorRefKind = 'reference' | 'normal'
export type ParsedNcuratorRefSourceType = 'file' | 'web'

export type ParsedRefLink =
  | {
      type: 'reference'
      kind: ParsedNcuratorRefKind
      sourceType: ParsedNcuratorRefSourceType
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
    const sourceType = url.searchParams.get('sourceType')
    const label = url.searchParams.get('label') || ''
    const path = url.searchParams.get('path') || ''
    if (
      (kind !== 'reference' && kind !== 'normal') ||
      (sourceType !== 'file' && sourceType !== 'web') ||
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
      sourceType,
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
  sourceType: ParsedNcuratorRefSourceType
}): React.ReactNode =>
  input.kind === 'reference' ? (
    <SnippetsOutlined />
  ) : input.sourceType === 'web' ? (
    <GlobalOutlined />
  ) : input.sourceType === 'file' ? (
    <FileTextOutlined />
  ) : (
    <LinkOutlined />
  )
