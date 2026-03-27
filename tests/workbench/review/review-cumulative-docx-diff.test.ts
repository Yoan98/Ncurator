import fs from 'node:fs/promises'
import { describe, it } from 'vitest'
import { computeCumulativeDocxChangeSeeds } from '../../../src/main/services/ai/human/tools/docx/review/cumulativeDiff'
import { writeTestDocxFile } from '../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../harness/backend/run-backend-case'

describe('workbench review backend', () => {
  it('review-cumulative-docx-diff', async () => {
    await runBackendCase({
      caseId: 'review-cumulative-docx-diff',
      domain: 'workbench',
      suite: 'review',
      description: '同一文件多轮修改后，累计 diff 以源文件为基线生成最终 change seeds。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const sourcePath = await writeTestDocxFile(runtime.workspaceRoot, 'source.docx', [
          {
            type: 'heading',
            text: 'NCurator Weekly Report',
            level: 1
          },
          {
            type: 'paragraph',
            text: 'Second block keeps the original summary.'
          },
          {
            type: 'paragraph',
            text: 'Third block keeps the original action items.'
          }
        ])
        const latestPath = await writeTestDocxFile(runtime.workspaceRoot, 'latest.docx', [
          {
            type: 'heading',
            text: 'NCurator Weekly Report',
            level: 1
          },
          {
            type: 'paragraph',
            text: 'Second block now reflects the final revised summary.'
          },
          {
            type: 'paragraph',
            text: 'Third block now reflects the final revised action items.'
          }
        ])

        return {
          changes: await computeCumulativeDocxChangeSeeds({
            sourceBuffer: await fs.readFile(sourcePath),
            latestDraftBuffer: await fs.readFile(latestPath),
            latestDraftSnapshotId: 'snapshot-final'
          })
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(result.changes.length === 2, {
          name: 'only-final-blocks-remain',
          message: '累计 diff 应只保留相对源文件仍然成立的第 2 / 3 块差异。',
          data: {
            changeCount: result.changes.length,
            blockIds: result.changes.map((change) =>
              typeof change.locator.blockId === 'string' ? change.locator.blockId : ''
            )
          }
        })

        const blockIds = result.changes.map((change) =>
          typeof change.locator.blockId === 'string' ? change.locator.blockId : ''
        )
        runtime.assertThat(blockIds[0] === 'b:2' && blockIds[1] === 'b:1', {
          name: 'diff-targets-latest-final-blocks',
          message: '累计 diff 应命中源文件的第 2 / 3 个正文块，而不是遗漏先前轮次仍然成立的修改。',
          data: { blockIds }
        })

        runtime.assertThat(
          result.changes.every(
            (change) =>
              change.docxOp.type === 'replace_text' &&
              typeof change.metadata.engine === 'string' &&
              change.metadata.engine === 'docx_cumulative_diff_v1'
          ),
          {
            name: 'changes-built-from-cumulative-engine',
            message: '累计 diff 应输出新的累计 change seeds，而不是沿用旧的增量 change metadata。'
          }
        )
      }
    })
  })
})
