import React from 'react'
import { Button, Card } from 'antd'
import {
  CopyOutlined,
  EyeOutlined,
  FolderOpenOutlined,
  FileTextOutlined
} from '@ant-design/icons'
import type { SearchResult } from '../../../../shared/types'
import { workbenchSelectors } from '../../testing/selectors'
import type { WorkbenchInspector } from '../../types/workbench'
import MarkdownRenderer from '../MarkdownRenderer'

const extractAbsolutePaths = (text: string): string[] => {
  const matches = String(text || '').match(/\/[^^\s"'`;]+/g) || []
  const unique = Array.from(new Set(matches.map((value) => value.trim()).filter(Boolean)))
  return unique.slice(0, 5)
}

const stringifyData = (value: string | number | boolean | object | null): string => {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

const copyText = async (value: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    // ignore clipboard failures in sandboxed contexts
  }
}

const renderSearchCard = (
  result: SearchResult,
  index: number,
  onOpenSearchResult: (result: SearchResult) => void
): React.ReactNode => {
  return (
    <button
      key={`${result.id || index}`}
      type="button"
      className="w-full rounded-xl border border-[#E5E5E4] bg-white p-3 text-left transition-colors hover:border-[#D97757]"
      onClick={() => onOpenSearchResult(result)}
    >
      <div className="text-xs font-semibold text-[#1F1F1F] truncate">
        {index + 1}. {result.document_name}
      </div>
      <div className="mt-2 text-xs leading-relaxed text-[#666666] line-clamp-5">{result.text}</div>
    </button>
  )
}

type WorkbenchInspectorProps = {
  inspector: WorkbenchInspector
  runId: string | null
  onOpenSearchResult: (result: SearchResult) => void
  onOpenArtifactPreview: (artifactPath: string, fileName: string) => void
  onOpenReview?: (reviewId: string) => void
  onOpenPath: (filePath: string) => Promise<void>
  onRevealPath: (filePath: string) => Promise<void>
}

const WorkbenchInspectorPanel: React.FC<WorkbenchInspectorProps> = ({
  inspector,
  runId,
  onOpenSearchResult,
  onOpenArtifactPreview,
  onOpenReview,
  onOpenPath,
  onRevealPath
}) => {
  return (
    <Card
      className="rounded-xl border border-[#E5E5E4] bg-white shadow-sm"
      styles={{ body: { padding: 0 } }}
    >
      <div className="flex items-center justify-between border-b border-[#E5E5E4] px-4 py-3">
        <div
          className="truncate text-sm font-medium text-[#1F1F1F]"
          data-testid={workbenchSelectors.inspectorTitle}
        >
          {inspector.title}
        </div>
        <div className="text-xs text-[#999999]">{runId ? runId.slice(0, 8) : ''}</div>
      </div>
      <div className="max-h-[calc(100vh-220px)] overflow-auto p-4">
        {inspector.kind === 'empty' ? (
          <div className="rounded-xl border border-dashed border-[#E5E5E4] bg-[#F8F8F7] px-4 py-6 text-sm text-[#999999]">
            {inspector.description}
          </div>
        ) : null}

        {inspector.kind === 'search_results' ? (
          <div className="flex flex-col gap-3" data-testid={workbenchSelectors.searchResults}>
            <div className="text-xs text-[#999999]">查询：{inspector.query}</div>
            {inspector.results.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#E5E5E4] bg-[#F8F8F7] px-4 py-6 text-sm text-[#999999]">
                当前步骤没有返回检索结果。
              </div>
            ) : (
              inspector.results.map((result, index) => renderSearchCard(result, index, onOpenSearchResult))
            )}
          </div>
        ) : null}

        {inspector.kind === 'docs' ? (
          <div className="flex flex-col gap-2">
            {inspector.data.map((document, index) => (
              <div key={`${document.id}-${index}`} className="rounded-xl border border-[#E5E5E4] bg-[#F8F8F7] px-3 py-3">
                <div className="text-xs font-semibold text-[#1F1F1F] truncate">
                  {index + 1}. {document.name}
                </div>
                <div className="mt-1 text-[11px] text-[#999999] break-all">{document.id}</div>
              </div>
            ))}
          </div>
        ) : null}

        {inspector.kind === 'plan' ? (
          <div className="space-y-3">
            {inspector.items.map((item, index) => (
              <div key={item.id} className="rounded-xl border border-[#E5E5E4] bg-[#F8F8F7] px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-[#1F1F1F]">
                    {index + 1}. {item.title}
                  </div>
                  <span className="rounded-full bg-white px-2 py-1 text-[11px] text-[#666666]">{item.status}</span>
                </div>
                <div className="mt-2 text-xs leading-relaxed text-[#666666]">{item.objective}</div>
                {item.resultMessage ? (
                  <div className="mt-2 text-xs text-[#999999]">{item.resultMessage}</div>
                ) : null}
                {item.deliveryMarkdown ? (
                  <div className="mt-3 rounded-xl border border-white bg-white px-3 py-3">
                    <MarkdownRenderer content={item.deliveryMarkdown} className="text-sm" />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {inspector.kind === 'human_step' ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-[#E5E5E4] bg-[#FBF5F2] px-4 py-4">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#999999]">用户可见叙事</div>
              <div className="mt-2 text-sm leading-relaxed text-[#1F1F1F]">{inspector.event.publicNarrative}</div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-[#E5E5E4] bg-[#F8F8F7] px-4 py-3">
                <div className="text-xs text-[#999999]">动作</div>
                <div className="mt-2 text-sm text-[#1F1F1F]">{inspector.event.action}</div>
              </div>
              <div className="rounded-xl border border-[#E5E5E4] bg-[#F8F8F7] px-4 py-3">
                <div className="text-xs text-[#999999]">结果</div>
                <div className="mt-2 text-sm text-[#1F1F1F]">{inspector.event.resultStatus || 'running'}</div>
              </div>
            </div>
            {inspector.event.draftRef?.draftSnapshotId ? (
              <div className="rounded-xl border border-[#E5E5E4] bg-white px-4 py-3 text-xs text-[#666666]">
                当前步骤读取的是最新草稿快照：{inspector.event.draftRef.draftSnapshotId}
              </div>
            ) : null}
          </div>
        ) : null}

        {inspector.kind === 'task_delivery' ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-[#E5E5E4] bg-[#F8F8F7] px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-[#1F1F1F]">{inspector.event.taskId}</div>
                  <div className="mt-1 text-xs text-[#666666]">{inspector.event.summary}</div>
                </div>
                <Button
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => void copyText(inspector.event.deliveryMarkdown)}
                >
                  复制交付
                </Button>
              </div>
            </div>
            <div className="rounded-xl border border-[#E5E5E4] bg-white px-4 py-4">
              <MarkdownRenderer content={inspector.event.deliveryMarkdown} className="text-sm" />
            </div>
            {extractAbsolutePaths(inspector.event.deliveryMarkdown).length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {extractAbsolutePaths(inspector.event.deliveryMarkdown).map((filePath) => (
                  <Button
                    key={filePath}
                    size="small"
                    icon={<FolderOpenOutlined />}
                    onClick={() => void onRevealPath(filePath)}
                  >
                    定位路径
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {inspector.kind === 'tool_result' ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-[#E5E5E4] bg-[#F8F8F7] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-[#1F1F1F]">{inspector.event.toolName}</div>
                <span className="rounded-full bg-white px-2 py-1 text-[11px] text-[#666666]">
                  {inspector.event.error ? 'error' : 'ok'}
                </span>
              </div>
              {inspector.event.draftRef?.draftSnapshotId ? (
                <div className="mt-2 text-xs text-[#999999]">
                  草稿快照：{inspector.event.draftRef.draftSnapshotId}
                </div>
              ) : null}
              <pre className="mt-3 overflow-x-auto rounded-xl bg-white p-3 text-xs leading-relaxed text-[#666666]">
                {stringifyData(inspector.event.outputPreview)}
              </pre>
            </div>
          </div>
        ) : null}

        {inspector.kind === 'artifact' ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-[#E5E5E4] bg-[#F8F8F7] px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-[#1F1F1F]">{inspector.event.fileName}</div>
                  <div className="mt-1 text-xs text-[#666666]">{inspector.event.summary}</div>
                </div>
                <span className="rounded-full bg-white px-3 py-1 text-[11px] text-[#666666]">
                  {inspector.event.artifactRole || 'artifact'}
                </span>
              </div>
              <div className="mt-3 break-all text-xs text-[#999999]">{inspector.event.path}</div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  size="small"
                  icon={<EyeOutlined />}
                  onClick={() => onOpenArtifactPreview(inspector.event.path, inspector.event.fileName)}
                >
                  预览
                </Button>
                <Button size="small" icon={<FileTextOutlined />} onClick={() => void onOpenPath(inspector.event.path)}>
                  打开
                </Button>
                <Button size="small" icon={<FolderOpenOutlined />} onClick={() => void onRevealPath(inspector.event.path)}>
                  定位
                </Button>
              </div>
            </div>

            {inspector.related.length > 1 ? (
              <div className="space-y-2">
                <div className="text-xs text-[#999999]">同次运行的其他产物</div>
                {inspector.related.map((artifact) => (
                  <div key={artifact.artifactId} className="rounded-xl border border-[#E5E5E4] bg-white px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs font-medium text-[#1F1F1F] truncate">{artifact.fileName}</div>
                      <span className="rounded-full bg-[#F5F5F4] px-2 py-1 text-[11px] text-[#666666]">
                        {artifact.artifactRole || 'artifact'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {inspector.kind === 'approval' ? (
          <div className="rounded-xl border border-[#FDECC8] bg-[#FFF9ED] px-4 py-4 text-sm text-[#8A6510]">
            <div className="font-semibold text-[#1F1F1F]">等待审批</div>
            <div className="mt-2">{inspector.event.reason}</div>
            <div className="mt-3 rounded-xl bg-white px-3 py-3 text-xs text-[#666666]">
              命令：{inspector.event.command}
            </div>
          </div>
        ) : null}

        {inspector.kind === 'workspace' ? (
          <div className="rounded-xl border border-[#FDECC8] bg-[#FFF9ED] px-4 py-4 text-sm text-[#8A6510]">
            <div className="font-semibold text-[#1F1F1F]">需要工作区</div>
            <div className="mt-2">{inspector.event.reason}</div>
          </div>
        ) : null}

        {inspector.kind === 'runtime_issue' ? (
          <div className="rounded-xl border border-[#FFF1F0] bg-[#FFF7F6] px-4 py-4 text-sm text-[#C2413B]">
            <div className="font-semibold text-[#1F1F1F]">运行阻塞</div>
            <div className="mt-2">{inspector.event.message}</div>
            <div className="mt-3 text-xs text-[#999999]">{inspector.event.code}</div>
          </div>
        ) : null}

        {inspector.kind === 'watchdog' ? (
          <div className="rounded-xl border border-[#FDECC8] bg-[#FFF9ED] px-4 py-4 text-sm text-[#8A6510]">
            <div className="font-semibold text-[#1F1F1F]">Watchdog 监督</div>
            <div className="mt-2">{inspector.event.summary}</div>
            {inspector.event.signs.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {inspector.event.signs.map((sign) => (
                  <span key={sign} className="rounded-full bg-white px-2 py-1 text-[11px] text-[#666666]">
                    {sign}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {inspector.kind === 'draft_review' ? (
          <div className="rounded-xl border border-[#F4E5DF] bg-[#FBF5F2] px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[#1F1F1F]">草稿审阅已就绪</div>
                <div className="mt-1 text-xs text-[#666666]">
                  {inspector.review.documentCount} 个文档，{inspector.review.changeCount} 处修改
                </div>
              </div>
              {onOpenReview ? (
                <Button type="primary" size="large" onClick={() => onOpenReview(inspector.review.reviewId)}>
                  打开审阅中心
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {inspector.kind === 'json' ? (
          <div className="space-y-3">
            <pre className="overflow-x-auto rounded-xl border border-[#E5E5E4] bg-[#F8F8F7] p-4 text-xs leading-relaxed text-[#666666]">
              {stringifyData(inspector.data)}
            </pre>
            {extractAbsolutePaths(stringifyData(inspector.data)).map((path) => (
              <div key={path} className="flex items-center justify-between gap-2 rounded-xl border border-[#E5E5E4] bg-white px-3 py-2">
                <div className="truncate text-xs text-[#666666]">{path}</div>
                <div className="flex flex-wrap gap-2">
                  <Button size="small" icon={<CopyOutlined />} onClick={() => void copyText(path)}>
                    复制
                  </Button>
                  <Button size="small" icon={<FileTextOutlined />} onClick={() => void onOpenPath(path)}>
                    打开
                  </Button>
                  <Button size="small" icon={<FolderOpenOutlined />} onClick={() => void onRevealPath(path)}>
                    定位
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Card>
  )
}

type WorkbenchInspectorContainerProps = WorkbenchInspectorProps

const WorkbenchInspector: React.FC<WorkbenchInspectorContainerProps> = (props) => {
  return (
    <div className="space-y-4" data-testid={workbenchSelectors.inspector}>
      <WorkbenchInspectorPanel {...props} />
    </div>
  )
}

export default WorkbenchInspector
