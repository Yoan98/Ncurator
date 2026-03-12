import React from 'react'
import { Button } from 'antd'
import { EyeOutlined } from '@ant-design/icons'
import type { JsonValue } from '../../../../../shared/types'
import type { DraftDiffRendererProps } from './types'

const formatJsonValue = (value: JsonValue | undefined): string => {
  if (value === undefined) return '未提供定位信息'
  return JSON.stringify(value, null, 2)
}

const DocxDraftDiffRenderer: React.FC<DraftDiffRendererProps> = ({
  document,
  change,
  onOpenPreview
}) => {
  if (!change) {
    return (
      <div className="rounded-2xl border border-dashed border-[#E5E5E4] bg-[#F8F8F7] px-4 py-8 text-sm text-[#999999]">
        先从左侧选择一个变更块，再查看具体的 before / after 对比。
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[#E5E5E4] bg-[#FBF5F2] px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-[#1F1F1F]">{change.title}</div>
            <div className="mt-2 text-sm leading-relaxed text-[#666666]">{change.summary}</div>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-[11px] text-[#666666]">
            {change.change_kind}
          </span>
        </div>
        {document.preview_artifact_path ? (
          <div className="mt-4">
            <Button
              size="large"
              icon={<EyeOutlined />}
              onClick={() => onOpenPreview(document.preview_artifact_path || '', document.source_name)}
            >
              打开文档预览
            </Button>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-[#E5E5E4] bg-white p-4">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#999999]">修改前</div>
          <pre className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-[#F8F8F7] p-4 text-sm leading-relaxed text-[#1F1F1F]">
            {change.before_text || '该位置原本为空。'}
          </pre>
        </div>
        <div className="rounded-2xl border border-[#F4E5DF] bg-white p-4">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#999999]">修改后</div>
          <pre className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-[#FBF5F2] p-4 text-sm leading-relaxed text-[#1F1F1F]">
            {change.after_text || '该位置被清空。'}
          </pre>
        </div>
      </div>

      <div className="rounded-2xl border border-[#E5E5E4] bg-white p-4">
        <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#999999]">块定位</div>
        <pre className="mt-3 overflow-x-auto rounded-xl bg-[#F8F8F7] p-4 text-xs leading-relaxed text-[#666666]">
          {formatJsonValue(change.locator)}
        </pre>
      </div>
    </div>
  )
}

export default DocxDraftDiffRenderer
