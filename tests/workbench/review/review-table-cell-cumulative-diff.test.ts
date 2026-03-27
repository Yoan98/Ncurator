import fs from 'node:fs/promises'
import { describe, it } from 'vitest'
import { computeCumulativeDocxChangeSeeds } from '../../../src/main/services/ai/human/tools/docx/review/cumulativeDiff'
import { writeTestDocxFile } from '../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../harness/backend/run-backend-case'

describe('workbench review backend', () => {
  it('review-table-cell-cumulative-diff', async () => {
    await runBackendCase({
      caseId: 'review-table-cell-cumulative-diff',
      domain: 'workbench',
      suite: 'review',
      description: '表格结构稳定时输出单元格级累计 diff，结构变化时退化为整表替换。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const stableSourcePath = await writeTestDocxFile(runtime.workspaceRoot, 'table-source.docx', [
          {
            type: 'table',
            rows: [
              ['Topic', 'Owner'],
              ['Risk', 'Alice']
            ]
          }
        ])
        const stableLatestPath = await writeTestDocxFile(runtime.workspaceRoot, 'table-latest.docx', [
          {
            type: 'table',
            rows: [
              ['Topic', 'Owner'],
              ['Risk', 'Bob']
            ]
          }
        ])
        const structuralLatestPath = await writeTestDocxFile(
          runtime.workspaceRoot,
          'table-structural-latest.docx',
          [
            {
              type: 'table',
              rows: [
                ['Topic', 'Owner', 'Status'],
                ['Risk', 'Bob', 'Open']
              ]
            }
          ]
        )

        return {
          stableChanges: await computeCumulativeDocxChangeSeeds({
            sourceBuffer: await fs.readFile(stableSourcePath),
            latestDraftBuffer: await fs.readFile(stableLatestPath),
            latestDraftSnapshotId: 'snapshot-table-stable'
          }),
          structuralChanges: await computeCumulativeDocxChangeSeeds({
            sourceBuffer: await fs.readFile(stableSourcePath),
            latestDraftBuffer: await fs.readFile(structuralLatestPath),
            latestDraftSnapshotId: 'snapshot-table-structural'
          })
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(result.stableChanges.length === 1, {
          name: 'stable-table-produces-single-cell-change',
          message: '表格结构不变时，应只生成单元格级 change，而不是整表替换。',
          data: {
            changeCount: result.stableChanges.length,
            changeTypes: result.stableChanges.map((change) => change.docxOp.type)
          }
        })

        runtime.assertThat(
          result.stableChanges[0]?.docxOp.type === 'update_table_cell' &&
            typeof result.stableChanges[0]?.locator.blockId === 'string' &&
            result.stableChanges[0].locator.blockId === 'tbl:0.r:2.c:2',
          {
            name: 'stable-table-targets-correct-cell',
            message: '表格结构不变时，应定位到正确的单元格 blockId。',
            data: {
              docxOpType: result.stableChanges[0]?.docxOp.type,
              blockId: result.stableChanges[0]?.locator.blockId
            }
          }
        )

        runtime.assertThat(
          result.structuralChanges.length === 1 &&
            result.structuralChanges[0]?.docxOp.type === 'replace_block' &&
            typeof result.structuralChanges[0]?.locator.blockId === 'string' &&
            result.structuralChanges[0].locator.blockId === 'tbl:0',
          {
            name: 'structural-table-falls-back-to-replace-block',
            message: '表格行列结构变化时，应退化为整表 replace_block，避免生成失真的单元格更新。',
            data: {
              changeCount: result.structuralChanges.length,
              docxOpType: result.structuralChanges[0]?.docxOp.type,
              blockId: result.structuralChanges[0]?.locator.blockId
            }
          }
        )
      }
    })
  })
})
