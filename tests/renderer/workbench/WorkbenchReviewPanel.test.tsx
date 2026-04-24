import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import WorkbenchReviewPanel from '../../../src/renderer/src/components/workbench/WorkbenchReviewPanel'
import type { FileReviewDetail } from '../../../src/shared/types'

vi.mock('../../../src/renderer/src/components/fileRenders/EmbeddedFileViewer', () => ({
  default: (props: { filePath?: string; fileName?: string; emptyText?: string }): React.JSX.Element => (
    <div data-testid="embedded-file-viewer">
      {props.filePath ? `${props.fileName}:${props.filePath}` : props.emptyText || 'empty'}
    </div>
  )
}))

const buildReviewDetail = (
  overrides: Partial<FileReviewDetail['review']> = {}
): FileReviewDetail => ({
  review: {
    id: 'review-1',
    session_id: 'session-1',
    run_id: 'run-1',
    status: 'pending_confirm',
    title: '审阅稿：sample.docx',
    source_path: '/workspace/sample.docx',
    source_name: 'sample.docx',
    output_operation: 'updated',
    format: 'docx',
    review_render_kind: 'docx_block',
    latest_draft_snapshot_id: 'draft-1',
    draft_artifact_path: '/artifacts/draft-sample.docx',
    working_artifact_path: '/artifacts/working-sample.docx',
    committed_artifact_path: '/artifacts/committed-sample.docx',
    source_version: {
      exists: true,
      checksum: 'checksum-1',
      byte_size: 100,
      mtime_ms: 123
    },
    change_count: 1,
    pending_change_count: 1,
    accepted_change_count: 0,
    rejected_change_count: 0,
    created_at: 1,
    updated_at: 1,
    ...overrides
  },
  changes: [
    {
      id: 'change-1',
      review_id: 'review-1',
      order_index: 1,
      change_kind: 'block',
      title: '修改摘要',
      summary: '修改摘要',
      decision: 'pending',
      anchor_name: 'a1',
      created_at: 1,
      updated_at: 1
    }
  ],
  commit_attempts: []
})

describe('WorkbenchReviewPanel', () => {
  it('shows confirm-create for active create-target review', () => {
    render(
      <WorkbenchReviewPanel
        review={buildReviewDetail({
          source_path: '/workspace/generated-summary.docx',
          source_name: 'generated-summary.docx',
          output_operation: 'created',
          source_version: { exists: false }
        })}
        loading={false}
        validation={null}
        committing={false}
        discarding={false}
        tabs={[
          {
            fileKey: '/workspace/generated-summary.docx',
            fileName: 'generated-summary.docx',
            changeCount: 1,
            unseen: false
          }
        ]}
        onSelectTab={() => undefined}
        onCommit={() => undefined}
        onDiscard={() => undefined}
      />
    )

    expect(screen.getByText('确认创建')).toBeTruthy()
    expect(screen.queryByText('确认替换')).toBeNull()
    expect(screen.getByTestId('embedded-file-viewer').textContent).toContain(
      'generated-summary-审阅稿.docx:/artifacts/draft-sample.docx'
    )
  })

  it('hides actions and avoids missing source preview for discarded create-target review', () => {
    render(
      <WorkbenchReviewPanel
        review={buildReviewDetail({
          status: 'discarded',
          source_path: '/workspace/generated-summary.docx',
          source_name: 'generated-summary.docx',
          output_operation: 'created',
          draft_artifact_path: undefined,
          working_artifact_path: undefined,
          committed_artifact_path: undefined,
          source_version: { exists: false }
        })}
        loading={false}
        validation={null}
        committing={false}
        discarding={false}
        tabs={[
          {
            fileKey: '/workspace/generated-summary.docx',
            fileName: 'generated-summary.docx',
            changeCount: 1,
            unseen: false
          }
        ]}
        onSelectTab={() => undefined}
        onCommit={() => undefined}
        onDiscard={() => undefined}
      />
    )

    expect(screen.queryByText('确认创建')).toBeNull()
    expect(screen.queryByText('放弃')).toBeNull()
    expect(screen.getByText('本文件修改已放弃，源文件保持不变。')).toBeTruthy()
    expect(screen.getByTestId('embedded-file-viewer').textContent).toContain(
      '当前审阅稿暂时不可预览。'
    )
  })
})
