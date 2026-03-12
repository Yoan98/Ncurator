import React from 'react'
import { Button } from 'antd'
import { EyeOutlined } from '@ant-design/icons'
import type { DraftDiffRendererProps } from './types'

type PlaceholderDraftDiffRendererProps = DraftDiffRendererProps & {
  title: string
  description: string
}

const PlaceholderDraftDiffRenderer: React.FC<PlaceholderDraftDiffRendererProps> = ({
  document,
  change,
  title,
  description,
  onOpenPreview
}) => {
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-[#E5E5E4] bg-[#F8F8F7] px-4 py-4">
        <div className="text-sm font-semibold text-[#1F1F1F]">{title}</div>
        <div className="mt-2 text-sm leading-relaxed text-[#666666]">{description}</div>
        <div className="mt-3 text-xs text-[#999999]">当前格式：{document.format}</div>
      </div>
      {change ? (
        <div className="rounded-2xl border border-[#E5E5E4] bg-white px-4 py-4">
          <div className="text-sm font-medium text-[#1F1F1F]">{change.title}</div>
          <div className="mt-2 text-sm text-[#666666]">{change.summary}</div>
        </div>
      ) : null}
      {document.preview_artifact_path ? (
        <Button
          size="large"
          icon={<EyeOutlined />}
          onClick={() => onOpenPreview(document.preview_artifact_path || '', document.source_name)}
        >
          打开格式预览
        </Button>
      ) : null}
    </div>
  )
}

export default PlaceholderDraftDiffRenderer
