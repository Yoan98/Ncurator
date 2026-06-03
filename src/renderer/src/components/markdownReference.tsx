import React from 'react'
import {
  BookOutlined,
  FileMarkdownOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  FileWordOutlined,
  GlobalOutlined,
  LinkOutlined
} from '@ant-design/icons'
import { inferReferenceIconKind } from '../../../main/services/ai/human/shared/references'

export type ParsedRefLink =
  | {
      type: 'reference'
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
    const label = decodeURIComponent(url.searchParams.get('label') || '')
    const path = decodeURIComponent(url.searchParams.get('path') || '')
    if (!label || !path) {
      return {
        type: 'normal',
        href
      }
    }
    return {
      type: 'reference',
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

export const renderReferenceIcon = (label: string, path: string): React.ReactNode => {
  switch (inferReferenceIconKind({ label, path })) {
    case 'web':
      return <GlobalOutlined />
    case 'knowledge':
      return <BookOutlined />
    case 'docx':
      return <FileWordOutlined />
    case 'pdf':
      return <FilePdfOutlined />
    case 'markdown':
      return <FileMarkdownOutlined />
    case 'text':
      return <FileTextOutlined />
    default:
      return <LinkOutlined />
  }
}
