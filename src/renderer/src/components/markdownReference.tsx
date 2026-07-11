import React from 'react'
import { FileTextOutlined, GlobalOutlined } from '@ant-design/icons'
import {
  parseNcuratorRefHref,
  type NcuratorRefKind,
  type NcuratorRefResourceType,
  type ParsedNcuratorRef
} from '../../../shared/ncuratorRef'

export type ParsedNcuratorRefKind = NcuratorRefKind
export type ParsedNcuratorRefResourceType = NcuratorRefResourceType
export type ParsedRefLink = ParsedNcuratorRef

export const parseRefHref = parseNcuratorRefHref

export const renderReferenceIcon = (input: {
  kind: ParsedNcuratorRefKind
  resourceType: ParsedNcuratorRefResourceType
}): React.ReactNode =>
  input.resourceType === 'web' ? (
    <GlobalOutlined />
  ) : input.resourceType === 'file' ? (
    <FileTextOutlined />
  ) : null
