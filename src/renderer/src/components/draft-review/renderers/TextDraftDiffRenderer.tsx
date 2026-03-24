import React, { useMemo, useState } from 'react'
import { Button } from 'antd'
import { buildFallbackDiffHunks, buildUnifiedDiffText } from '../../workbench/utils'
import type { DraftDiffRendererProps } from './types'

const lineTone: Record<'context' | 'added' | 'removed', string> = {
  context: 'text-[#666666]',
  added: 'bg-[#F3FAF0] text-[#4F7A46]',
  removed: 'bg-[#FFF2F4] text-[#B5455D]'
}

const TextDraftDiffRenderer: React.FC<DraftDiffRendererProps> = ({ change }) => {
  const [showRawDiff, setShowRawDiff] = useState(false)

  const hunks = useMemo(() => (change ? buildFallbackDiffHunks(change) : []), [change])

  if (!change) {
    return (
      <div className="rounded-2xl border border-dashed border-[#E5E5E4] bg-[#F8F8F7] px-4 py-8 text-sm text-[#999999]">
        先选择一个文本变更，再查看具体的 hunk 对比。
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
          <Button size="small" onClick={() => setShowRawDiff((previous) => !previous)}>
            {showRawDiff ? '查看可读对比' : '查看原始 unified diff'}
          </Button>
        </div>
      </div>

      {showRawDiff ? (
        <pre className="overflow-x-auto rounded-2xl border border-[#E5E5E4] bg-[#F8F8F7] p-4 text-xs leading-relaxed text-[#1F1F1F]">
          {buildUnifiedDiffText(change)}
        </pre>
      ) : (
        <>
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

          <div className="space-y-3">
            {hunks.map((hunk) => (
              <details
                key={hunk.id}
                open
                className="rounded-2xl border border-[#E5E5E4] bg-white px-4 py-3"
              >
                <summary className="cursor-pointer text-sm font-medium text-[#1F1F1F]">
                  {hunk.title || '文本 hunk'}
                </summary>
                {hunk.summary ? (
                  <div className="mt-2 text-xs leading-relaxed text-[#666666]">{hunk.summary}</div>
                ) : null}
                <div className="mt-3 space-y-1">
                  {hunk.lines.map((line, index) => (
                    <div
                      key={`${hunk.id}-${index}`}
                      className={`rounded-lg px-3 py-2 font-mono text-xs leading-relaxed ${lineTone[line.type]}`}
                    >
                      <span className="mr-2 text-[#999999]">
                        {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                      </span>
                      <span>{line.value || ' '}</span>
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default TextDraftDiffRenderer
