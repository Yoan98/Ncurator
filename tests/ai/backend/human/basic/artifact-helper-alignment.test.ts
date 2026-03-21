import { describe, expect, it } from 'vitest'
import {
  buildRunArtifactsFromDraftReviewDetail,
  extractArtifactRefsFromToolResults,
  mergeArtifactRefs
} from '../../../../../src/main/services/ai/utils/artifacts'
import type { DraftReviewDetail } from '../../../../../src/shared/types'

describe('artifact helper alignment', () => {
  it('deduplicates file artifacts by path and keeps the latest metadata', () => {
    const merged = mergeArtifactRefs(
      [
        {
          kind: 'file',
          capability: 'docx',
          path: '/tmp/result.docx',
          fileName: 'result.docx',
          operation: 'created',
          artifactRole: 'preview',
          summary: 'preview generated'
        }
      ],
      [
        {
          kind: 'file',
          capability: 'docx',
          path: '/tmp/result.docx',
          fileName: 'result.docx',
          operation: 'updated',
          artifactRole: 'committed',
          summary: 'final doc saved'
        }
      ]
    )

    expect(merged).toEqual([
      {
        kind: 'file',
        capability: 'docx',
        path: '/tmp/result.docx',
        fileName: 'result.docx',
        operation: 'updated',
        artifactRole: 'committed',
        summary: 'final doc saved'
      }
    ])
  })

  it('extracts file artifacts from terminal and docx tool results', () => {
    const artifacts = extractArtifactRefsFromToolResults([
      {
        toolName: 'terminal_run_command',
        ok: true,
        code: 'ok',
        summary: 'terminal output ready',
        data: {
          artifacts: [
            {
              path: '/tmp/terminal-output.txt',
              operation: 'created'
            }
          ]
        }
      },
      {
        toolName: 'docx_render_preview',
        ok: true,
        code: 'ok',
        summary: 'preview generated (html)',
        data: {
          previewPath: '/tmp/preview.docx'
        }
      }
    ])

    expect(artifacts).toEqual([
      {
        kind: 'file',
        capability: 'terminal_exec',
        path: '/tmp/terminal-output.txt',
        fileName: 'terminal-output.txt',
        operation: 'created',
        summary: 'terminal output ready'
      },
      {
        kind: 'file',
        capability: 'docx',
        path: '/tmp/preview.docx',
        fileName: 'preview.docx',
        operation: 'created',
        artifactRole: 'preview',
        summary: 'preview generated (html)'
      }
    ])
  })

  it('builds run-level draft review artifacts from finalized review detail', () => {
    const detail: DraftReviewDetail = {
      review: {
        id: 'review-1',
        session_id: 'session-1',
        run_id: 'run-1',
        status: 'open',
        title: 'Draft review',
        document_count: 1,
        change_count: 3,
        pending_change_count: 0,
        accepted_change_count: 3,
        rejected_change_count: 0,
        created_at: 1,
        updated_at: 2
      },
      documents: [
        {
          id: 'doc-1',
          review_id: 'review-1',
          source_path: '/workspace/source.docx',
          source_name: 'source.docx',
          format: 'docx',
          latest_draft_snapshot_id: 'snapshot-1',
          draft_artifact_path: '/workspace/.ncurator/drafts/source-draft.docx',
          source_version: {
            mtime_ms: 10,
            byte_size: 20
          },
          total_change_count: 3,
          pending_change_count: 0,
          accepted_change_count: 3,
          rejected_change_count: 0,
          created_at: 1,
          updated_at: 2
        }
      ],
      changes: [],
      commit_jobs: []
    }

    expect(buildRunArtifactsFromDraftReviewDetail(detail)).toEqual([
      {
        kind: 'draft_review',
        review: {
          reviewId: 'review-1',
          documentCount: 1,
          changeCount: 3
        },
        summary: 'draft review ready (1 docs, 3 changes)'
      },
      {
        kind: 'file',
        capability: 'docx',
        path: '/workspace/.ncurator/drafts/source-draft.docx',
        fileName: 'source-draft.docx',
        operation: 'created',
        artifactRole: 'draft',
        reviewId: 'review-1',
        draftDocumentId: 'doc-1',
        draftSnapshotId: 'snapshot-1',
        summary: 'draft ready: source.docx'
      }
    ])
  })
})
