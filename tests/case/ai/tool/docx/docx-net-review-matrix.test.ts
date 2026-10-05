import fs from 'node:fs/promises'
import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  writeRichTestDocxFile,
  writeTestDocxFile
} from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  readReviewPart,
  reviewRuns,
  storyText,
  storyStructure
} from '../../../../harness/backend/docxReviewAssertions'
import type { DocxSearchResult } from './testUtils'
import type { DocxPublicReadRootNode } from '../../../../../src/main/services/ai/human/tools/docx/nodeTypes'
import type { DocxApplyRecord } from '../../../../../src/shared/types'

describe('DOCX net review public tool matrix', () => {
  it('docx-net-review-matrix', async () => {
    await runBackendCase({
      caseId: 'docx-net-review-matrix',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      harnessMode: 'tool-real',
      fixtures: [],
      runMode: 'single',
      description: '真实公开工具验证移动组合、逐字/格式范围、连续基线、零净记录与字节回退。',
      execute: async (runtime) => {
        const harness = createDocxToolHarness(runtime)
        const observations: Array<{ name: string; stats?: number[]; review?: string[] }> = []
        const equivalentReviews = new Map<string, string>()
        const id = async (sourcePath: string, query: string, occurrence = 0) =>
          (await harness.invoke<DocxSearchResult>('docx_search', { sourcePath, query })).matches[
            occurrence
          ]!.nodeId
        const edit = async (sourcePath: string, args: Record<string, object | string | number>) => {
          const result = await harness.invoke<{ error?: string }>('docx_content_edit', {
            sourcePath,
            ...args
          })
          if (result.error) throw new Error(result.error)
        }
        const move = async (
          sourcePath: string,
          text: string,
          anchor: string,
          position = 'before',
          occurrence = 0
        ) =>
          edit(sourcePath, {
            type: 'move_node',
            nodeId: await id(sourcePath, text, occurrence),
            anchorNodeId: await id(sourcePath, anchor),
            position
          })
        const replace = async (sourcePath: string, oldText: string, newText: string) =>
          edit(sourcePath, {
            type: 'replace_text',
            nodeId: await id(sourcePath, oldText),
            oldText,
            newText
          })
        const apply = async (
          sourcePath: string,
          target = harness
        ): Promise<DocxApplyRecord | undefined> => {
          const record = (await target.ctx.finalizeRunFileChanges()).find(
            (record) => record.path === sourcePath
          )
          return record
            ? (await runtime.docxApplyService.getRecord({ applyId: record.id })).record
            : undefined
        }
        const verify = async (
          name: string,
          sourcePath: string,
          before: Buffer,
          record?: DocxApplyRecord,
          zero = false
        ) => {
          if (zero) {
            runtime.assertThat(
              !record &&
                !(await harness.ctx.listFileChangeRecords({ runId: runtime.runId })).some(
                  (r) => r.path === sourcePath && r.status === 'applied'
                ),
              { name: `${name}-zero`, message: '恢复原状后不得保留记录或过期统计' }
            )
            observations.push({ name })
            return
          }
          if (!record) throw new Error(`missing record ${name}`)
          const original = await readReviewPart(before),
            final = await readReviewPart(await fs.readFile(sourcePath)),
            review = await readReviewPart(await fs.readFile(record.preview_diff_artifact_path))
          runtime.assertThat(
            JSON.stringify(storyText(review, true)) === JSON.stringify(storyText(final)) &&
              JSON.stringify(storyText(review, false)) === JSON.stringify(storyText(original)) &&
              storyStructure(review, true) === storyStructure(final) &&
              storyStructure(review, false) === storyStructure(original),
            {
              name: `${name}-both-orders`,
              message: '接受/拒绝审阅应还原最终/原始内容及顺序',
              data: {
                original: storyText(original),
                final: storyText(final),
                review: storyText(review)
              }
            }
          )
          runtime.assertThat(!reviewRuns(final).some((r) => r.kind), {
            name: `${name}-clean-final`,
            message: '正式文件不得含系统审阅标记'
          })
          if (['edit-then-move', 'move-then-edit'].includes(name)) {
            const value = JSON.stringify({
              stats: [record.change_count, record.insert_count, record.delete_count],
              structure: storyStructure(review),
              runs: reviewRuns(review)
            })
            const first = equivalentReviews.get('edit-and-move')
            if (first)
              runtime.assertThat(first === value, {
                name: 'operation-path-equivalence',
                message: '相同首尾状态通过不同操作路径得到相同审阅和统计'
              })
            else equivalentReviews.set('edit-and-move', value)
          }
          const revert = await runtime.docxApplyService.revertRecord({ applyId: record.id })
          runtime.assertThat(revert.success && before.equals(await fs.readFile(sourcePath)), {
            name: `${name}-byte-revert`,
            message: '回退应逐字节恢复首次原始快照'
          })
          observations.push({
            name,
            stats: [record.change_count, record.insert_count, record.delete_count],
            review: storyText(review)
          })
        }
        try {
          const scenarios: Array<{
            name: string
            zero?: boolean
            execute: (path: string) => Promise<void>
          }> = [
            { name: 'up', execute: (path) => move(path, 'risk', 'conclusion') },
            { name: 'down', execute: (path) => move(path, 'conclusion', 'risk', 'after') },
            { name: 'adjacent', execute: (path) => move(path, 'risk', 'section') },
            { name: 'first', execute: (path) => move(path, 'risk', 'title') },
            { name: 'last', execute: (path) => move(path, 'conclusion', 'tail', 'after') },
            {
              name: 'multi',
              execute: async (path) => {
                await move(path, 'risk', 'conclusion')
                await move(path, 'tail', 'conclusion')
              }
            },
            {
              name: 'edit-then-move',
              execute: async (path) => {
                await replace(path, 'risk', 'risk changed')
                await move(path, 'risk changed', 'conclusion')
              }
            },
            {
              name: 'move-then-edit',
              execute: async (path) => {
                await move(path, 'risk', 'conclusion')
                await replace(path, 'risk', 'risk changed')
              }
            },
            {
              name: 'back-with-edit',
              execute: async (path) => {
                await move(path, 'risk', 'conclusion')
                await replace(path, 'risk', 'risk changed')
                await move(path, 'risk changed', 'tail')
              }
            },
            {
              name: 'move-delete',
              execute: async (path) => {
                await move(path, 'risk', 'conclusion')
                await edit(path, { type: 'delete_node', nodeId: await id(path, 'risk') })
              }
            },
            {
              name: 'move-back',
              zero: true,
              execute: async (path) => {
                await move(path, 'risk', 'conclusion')
                await move(path, 'risk', 'tail')
              }
            },
            { name: 'noop-before', zero: true, execute: (path) => move(path, 'section', 'risk') },
            {
              name: 'noop-after',
              zero: true,
              execute: (path) => move(path, 'risk', 'section', 'after')
            },
            { name: 'noop-self', zero: true, execute: (path) => move(path, 'risk', 'risk') },
            {
              name: 'replace-restore',
              zero: true,
              execute: async (path) => {
                await replace(path, 'risk', 'middle')
                await replace(path, 'middle', 'risk')
              }
            },
            {
              name: 'insert-delete',
              zero: true,
              execute: async (path) => {
                await edit(path, {
                  type: 'insert_nodes',
                  position: 'document_end',
                  nodes: [{ type: 'paragraph', text: 'temporary' }]
                })
                await edit(path, { type: 'delete_node', nodeId: await id(path, 'temporary') })
              }
            },
            { name: 'clear', execute: (path) => replace(path, 'risk', '') },
            {
              name: 'replace-node-same',
              zero: true,
              execute: async (path) =>
                edit(path, {
                  type: 'replace_node',
                  nodeId: await id(path, 'risk'),
                  node: { type: 'paragraph', text: 'risk' }
                })
            }
          ]
          for (const scenario of scenarios) {
            const sourcePath = await writeTestDocxFile(
              runtime.workspaceRoot,
              `${scenario.name}.docx`,
              ['title', 'date', 'conclusion', 'section', 'risk', 'tail'].map((text) => ({
                type: 'paragraph',
                text
              }))
            )
            const before = await fs.readFile(sourcePath)
            await scenario.execute(sourcePath)
            await verify(scenario.name, sourcePath, before, await apply(sourcePath), scenario.zero)
          }
          for (const [index, [beforeText, afterText]] of [
            ['二期126万', '二期128万'],
            ['中文 ABC 9！', '中英 ADC 8？'],
            ['👩🏽‍💻 é 🙂', '👩🏽‍💻 é 🙃'],
            ['甲乙丙丁', '甲新丙好']
          ].entries()) {
            const sourcePath = await writeRichTestDocxFile(
              runtime.workspaceRoot,
              `char-${index}.docx`,
              [
                {
                  type: 'paragraph',
                  paragraph: {
                    runs: [
                      { text: beforeText!.slice(0, 2), bold: true },
                      { text: beforeText!.slice(2) }
                    ]
                  }
                }
              ]
            )
            const before = await fs.readFile(sourcePath)
            await replace(sourcePath, beforeText!, afterText!)
            const record = await apply(sourcePath)
            if (!record) throw new Error('missing character diff')
            const runs = reviewRuns(
              await readReviewPart(await fs.readFile(record.preview_diff_artifact_path))
            )
            runtime.assertThat(
              runs.some((r) => !['inserted', 'deleted'].includes(r.kind)) &&
                record.change_count === 1 &&
                record.insert_count === 1 &&
                record.delete_count === 1,
              {
                name: `char-${index}-local-stat`,
                message: '逐字差异应保留未变文字，统计以段落为单位',
                data: runs
              }
            )
            await verify(`char-${index}`, sourcePath, before, record)
          }
          const formatPath = await writeTestDocxFile(runtime.workspaceRoot, 'local-format.docx', [
            { type: 'paragraph', text: '前缀重点跟进后缀' }
          ])
          const formatBefore = await fs.readFile(formatPath)
          await harness.invoke('docx_format', {
            sourcePath: formatPath,
            type: 'format_text',
            targets: [{ nodeId: await id(formatPath, '重点跟进'), text: '重点跟进' }],
            format: { bold: true }
          })
          const formatRecord = await apply(formatPath)
          if (!formatRecord) throw new Error('missing format record')
          const formatRuns = reviewRuns(
            await readReviewPart(await fs.readFile(formatRecord.preview_diff_artifact_path))
          )
          runtime.assertThat(
            formatRuns
              .filter((r) => r.kind)
              .map((r) => r.text)
              .join('') === '重点跟进' &&
              formatRuns.filter((r) => r.kind).every((r) => r.kind === 'formatted') &&
              formatRecord.insert_count === 0 &&
              formatRecord.delete_count === 0 &&
              formatRecord.change_count === 1,
            {
              name: 'format-local',
              message: '只标绿实际格式范围，不重复正文、不制造增删',
              data: formatRuns
            }
          )
          await verify('format-local', formatPath, formatBefore, formatRecord)

          for (const operation of [
            'format_paragraph',
            'format_section',
            'reset_format',
            'apply_named_style',
            'set_numbering',
            'create_named_style',
            'delete_named_style'
          ] as const) {
            const sourcePath = await writeRichTestDocxFile(
              runtime.workspaceRoot,
              `${operation}.docx`,
              [{ type: 'paragraph', paragraph: { runs: [{ text: 'format target' }] } }]
            )
            const JSZip = (await import('jszip')).default,
              zip = await JSZip.loadAsync(await fs.readFile(sourcePath))
            if (operation === 'reset_format')
              zip.file(
                'word/document.xml',
                (await zip.file('word/document.xml')!.async('text')).replace(
                  '<w:p>',
                  '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>'
                )
              )
            zip.file(
              'word/styles.xml',
              (await zip.file('word/styles.xml')!.async('text')).replace(
                '</w:styles>',
                '<w:style w:type="paragraph" w:styleId="Local"><w:name w:val="Local"/><w:rPr><w:b/></w:rPr></w:style></w:styles>'
              )
            )
            await fs.writeFile(sourcePath, await zip.generateAsync({ type: 'nodebuffer' }))
            const before = await fs.readFile(sourcePath),
              nodeId = await id(sourcePath, 'format target')
            const args: Record<string, object | string | number> = { sourcePath, type: operation }
            if (operation === 'format_paragraph')
              Object.assign(args, { nodeIds: [nodeId], format: { alignment: 'center' } })
            if (operation === 'format_section')
              Object.assign(args, { nodeIds: [nodeId], orientation: 'landscape' })
            if (operation === 'reset_format') Object.assign(args, { nodeIds: [nodeId] })
            if (operation === 'apply_named_style')
              Object.assign(args, { nodeIds: [nodeId], styleId: 'Local' })
            if (operation === 'set_numbering')
              Object.assign(args, { nodeIds: [nodeId], kind: 'bullet', level: 0 })
            if (operation === 'create_named_style')
              Object.assign(args, { styleId: 'NewLocal', name: 'NewLocal', run: { bold: true } })
            if (operation === 'delete_named_style') Object.assign(args, { styleId: 'Local' })
            const response = await harness.invoke<{ error?: string }>('docx_format', args)
            if (response.error) throw new Error(`${operation}: ${response.error}`)
            const record = await apply(sourcePath)
            runtime.assertThat(
              record?.change_count === 1 && record.insert_count === 0 && record.delete_count === 0,
              {
                name: `${operation}-net-format-stats`,
                message: '格式或独立样式变更应有效计数且无假正文增删',
                data: record
                  ? [record.change_count, record.insert_count, record.delete_count]
                  : null
              }
            )
            await verify(operation, sourcePath, before, record)
          }

          for (const operation of [
            'create_table',
            'delete_table',
            'insert_row',
            'delete_row',
            'insert_column',
            'delete_column',
            'merge_cells',
            'split_cell',
            'format_table',
            'format_row',
            'format_cell'
          ] as const) {
            const sourcePath = await writeTestDocxFile(runtime.workspaceRoot, `${operation}.docx`, [
              { type: 'paragraph', text: 'anchor' },
              {
                type: 'table',
                rows: [
                  ['A1', 'A2'],
                  ['B1', 'B2']
                ]
              }
            ])
            const before = await fs.readFile(sourcePath)
            const search = (
              await harness.invoke<DocxSearchResult>('docx_search', { sourcePath, query: 'A1' })
            ).matches[0]!
            const read = await harness.invoke<{ nodes: DocxPublicReadRootNode[] }>(
              'docx_read_nodes',
              { sourcePath, range: { type: 'node_ids', nodeIds: [search.tableNodeId!] } }
            )
            const table = read.nodes[0]
            if (table?.type !== 'table') throw new Error('table missing')
            const row = table.children[0]!,
              cell = row.children[0]!
            const args: Record<string, object | string | number> = { type: operation }
            if (operation === 'create_table')
              Object.assign(args, { position: 'document_end', rows: [['X', 'Y']] })
            else if (operation === 'delete_row') Object.assign(args, { rowNodeId: row.nodeId })
            else if (operation === 'split_cell')
              Object.assign(args, { cellNodeId: cell.nodeId, rows: 1, columns: 2 })
            else if (operation.startsWith('format_'))
              Object.assign(args, {
                nodeIds: [
                  operation === 'format_table'
                    ? table.nodeId
                    : operation === 'format_row'
                      ? row.nodeId
                      : cell.nodeId
                ],
                format:
                  operation === 'format_table'
                    ? { alignment: 'center' }
                    : operation === 'format_row'
                      ? { repeatHeader: true }
                      : { shading: 'FFFF00' }
              })
            else {
              Object.assign(args, { tableNodeId: table.nodeId })
              if (operation === 'insert_row')
                Object.assign(args, { rowNodeId: row.nodeId, position: 'after', cells: ['X', 'Y'] })
              if (operation === 'insert_column')
                Object.assign(args, { columnIndex: 2, cells: ['X', 'Y'] })
              if (operation === 'delete_column') Object.assign(args, { columnIndex: 2 })
              if (operation === 'merge_cells')
                Object.assign(args, { fromRow: 1, fromColumn: 1, toRow: 1, toColumn: 2 })
            }
            const response = await harness.invoke<{ error?: string }>('docx_table_edit', {
              sourcePath,
              ...args
            })
            if (response.error) throw new Error(`${operation}: ${response.error}`)
            const record = await apply(sourcePath)
            if (operation.startsWith('format_'))
              runtime.assertThat(record?.insert_count === 0 && record?.delete_count === 0, {
                name: `${operation}-no-text-count`,
                message: '纯表格格式变化不得计入正文增删'
              })
            await verify(operation, sourcePath, before, record)
          }
          for (const restore of [false, true]) {
            const sourcePath = await writeTestDocxFile(
              runtime.workspaceRoot,
              `named-style-${restore}.docx`,
              [
                { type: 'paragraph', text: 'styled' },
                { type: 'paragraph', text: 'plain' }
              ]
            )
            // Establish a named-style baseline before the review session.
            const JSZip = (await import('jszip')).default,
              zip = await JSZip.loadAsync(await fs.readFile(sourcePath))
            zip.file(
              'word/styles.xml',
              (await zip.file('word/styles.xml')!.async('text')).replace(
                '</w:styles>',
                '<w:style w:type="paragraph" w:styleId="Local"><w:name w:val="Local"/><w:rPr><w:b w:val="0"/></w:rPr></w:style></w:styles>'
              )
            )
            zip.file(
              'word/document.xml',
              (await zip.file('word/document.xml')!.async('text')).replace(
                '<w:p>',
                '<w:p><w:pPr><w:pStyle w:val="Local"/></w:pPr>'
              )
            )
            await fs.writeFile(sourcePath, await zip.generateAsync({ type: 'nodebuffer' }))
            const before = await fs.readFile(sourcePath)
            await harness.invoke('docx_format', {
              sourcePath,
              type: 'update_named_style',
              styleId: 'Local',
              run: { bold: true }
            })
            if (restore)
              await harness.invoke('docx_format', {
                sourcePath,
                type: 'update_named_style',
                styleId: 'Local',
                run: { bold: false }
              })
            const record = await apply(sourcePath)
            if (record) {
              const runs = reviewRuns(
                await readReviewPart(await fs.readFile(record.preview_diff_artifact_path))
              )
              runtime.assertThat(
                runs
                  .filter((r) => r.kind)
                  .map((r) => r.text)
                  .join('') === 'styled',
                {
                  name: 'named-style-affected-only',
                  message: '样式间接变化只标绿受影响文字',
                  data: runs
                }
              )
            }
            await verify(`named-style-${restore}`, sourcePath, before, record, restore)
          }
          const restoreFormat = await writeTestDocxFile(
            runtime.workspaceRoot,
            'format-restored.docx',
            [{ type: 'paragraph', text: 'format restore' }]
          )
          const restoreFormatBefore = await fs.readFile(restoreFormat),
            restoreId = await id(restoreFormat, 'format restore')
          await harness.invoke('docx_format', {
            sourcePath: restoreFormat,
            type: 'format_text',
            targets: [{ nodeId: restoreId, text: 'restore' }],
            format: { bold: true }
          })
          await harness.invoke('docx_format', {
            sourcePath: restoreFormat,
            type: 'format_text',
            targets: [{ nodeId: restoreId, text: 'restore' }],
            format: { bold: false }
          })
          await verify(
            'format-restored',
            restoreFormat,
            restoreFormatBefore,
            await apply(restoreFormat),
            true
          )
          const repeated = await writeTestDocxFile(
            runtime.workspaceRoot,
            'duplicate.docx',
            ['title', 'same', 'middle', 'same', 'end'].map((text) => ({ type: 'paragraph', text }))
          )
          const repeatedBefore = await fs.readFile(repeated)
          await move(repeated, 'same', 'title', 'before', 1)
          await verify('duplicate', repeated, repeatedBefore, await apply(repeated))
          const tableMove = await writeTestDocxFile(runtime.workspaceRoot, 'table-move.docx', [
            { type: 'paragraph', text: 'start' },
            { type: 'table', rows: [['table anchor']] },
            { type: 'paragraph', text: 'risk' },
            { type: 'paragraph', text: 'tail' }
          ])
          const tableMoveBefore = await fs.readFile(tableMove)
          const tableAnchor = (
            await harness.invoke<DocxSearchResult>('docx_search', {
              sourcePath: tableMove,
              query: 'table anchor'
            })
          ).matches[0]!.tableNodeId!
          await edit(tableMove, {
            type: 'move_node',
            nodeId: await id(tableMove, 'risk'),
            anchorNodeId: tableAnchor,
            position: 'before'
          })
          await verify('move-table-before', tableMove, tableMoveBefore, await apply(tableMove))
          for (const operation of [
            'update_comment',
            'reply_comment',
            'delete_comment',
            'disable_track_changes',
            'accept_revision',
            'reject_revision',
            'accept_all_revisions',
            'reject_all_revisions'
          ] as const) {
            const sourcePath = await writeTestDocxFile(runtime.workspaceRoot, `${operation}.docx`, [
              { type: 'paragraph', text: 'Comment original' }
            ])
            // Prepare the original user annotations before the first tool opens the file.
            const JSZip = (await import('jszip')).default,
              zip = await JSZip.loadAsync(await fs.readFile(sourcePath))
            const rel = await zip.file('word/_rels/document.xml.rels')!.async('text')
            zip.file(
              'word/_rels/document.xml.rels',
              rel.replace(
                '</Relationships>',
                '<Relationship Id="comments" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/><Relationship Id="settings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>'
              )
            )
            zip.file(
              'word/comments.xml',
              '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:comment w:id="0" w:author="User"><w:p w14:paraId="1234ABCD"><w:r><w:t>Original comment</w:t></w:r></w:p></w:comment></w:comments>'
            )
            zip.file(
              'word/settings.xml',
              '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:trackRevisions/></w:settings>'
            )
            zip.file(
              'word/document.xml',
              (await zip.file('word/document.xml')!.async('text')).replace(
                '<w:sectPr',
                '<w:ins w:id="42" w:author="User"><w:p><w:r><w:t>User inserted</w:t></w:r></w:p></w:ins><w:sectPr'
              )
            )
            await fs.writeFile(sourcePath, await zip.generateAsync({ type: 'nodebuffer' }))
            const before = await fs.readFile(sourcePath),
              args: Record<string, string> = { sourcePath, type: operation }
            if (['update_comment', 'reply_comment', 'delete_comment'].includes(operation)) {
              args.commentId = '0'
              if (operation !== 'delete_comment') args.comment = 'Changed comment'
            }
            if (['accept_revision', 'reject_revision'].includes(operation)) args.revisionId = '42'
            const result = await harness.invoke<{ error?: string }>('docx_comments_revisions', args)
            if (result.error) throw new Error(`${operation}: ${result.error}`)
            await verify(operation, sourcePath, before, await apply(sourcePath))
          }
          const continuous = await writeTestDocxFile(runtime.workspaceRoot, 'continuous.docx', [
            { type: 'paragraph', text: '原始A' }
          ])
          const baseline = await fs.readFile(continuous)
          await replace(continuous, '原始A', '中间B')
          const first = (await harness.ctx.listFileChangeRecords({ runId: runtime.runId })).find(
            (record) => record.path === continuous
          )
          await replace(continuous, '中间B', '最终C')
          const second = (await harness.ctx.listFileChangeRecords({ runId: runtime.runId })).find(
            (record) => record.path === continuous
          )
          runtime.assertThat(
            first?.id === second?.id && first?.beforeChecksum === second?.beforeChecksum,
            { name: 'continuous-first-baseline', message: '连续应用共用首次基线和同一个修改记录' }
          )
          await replace(continuous, '最终C', '原始A')
          await verify('continuous-restored', continuous, baseline, await apply(continuous), true)
          const continuousNext = await writeTestDocxFile(
            runtime.workspaceRoot,
            'continuous-after-zero.docx',
            [{ type: 'paragraph', text: '原始A' }]
          )
          const nextBaseline = await fs.readFile(continuousNext)
          await replace(continuousNext, '原始A', '最终D')
          await verify(
            'continuous-after-zero',
            continuousNext,
            nextBaseline,
            await apply(continuousNext)
          )
          const regions = await writeTestDocxFile(runtime.workspaceRoot, 'regions.docx', [
            { type: 'paragraph', text: 'Body unchanged' }
          ])
          const JSZip = (await import('jszip')).default,
            regionZip = await JSZip.loadAsync(await fs.readFile(regions))
          let relXml = await regionZip.file('word/_rels/document.xml.rels')!.async('text')
          const regionKinds = ['header', 'footer', 'footnotes', 'endnotes'] as const
          for (const kind of regionKinds) {
            relXml = relXml.replace(
              '</Relationships>',
              `<Relationship Id="${kind}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${kind}" Target="${kind}.xml"/></Relationships>`
            )
            const root = kind === 'header' ? 'hdr' : kind === 'footer' ? 'ftr' : kind
            const content = `<w:p><w:r><w:t>${kind} A</w:t></w:r></w:p>`
            regionZip.file(
              `word/${kind}.xml`,
              `<w:${root} xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${kind.endsWith('notes') ? `<w:${kind.slice(0, -1)} w:id="1">${content}</w:${kind.slice(0, -1)}>` : content}</w:${root}>`
            )
          }
          regionZip.file('word/_rels/document.xml.rels', relXml)
          await fs.writeFile(regions, await regionZip.generateAsync({ type: 'nodebuffer' }))
          const regionsBefore = await fs.readFile(regions)
          const crossStory = await harness.invoke<{ error?: string }>('docx_content_edit', {
            sourcePath: regions,
            type: 'move_node',
            nodeId: await id(regions, 'Body unchanged'),
            anchorNodeId: await id(regions, 'header A'),
            position: 'before'
          })
          runtime.assertThat(
            !!crossStory.error &&
              regionsBefore.equals(await fs.readFile(regions)) &&
              !(await apply(regions)),
            {
              name: 'cross-story-no-partial-commit',
              message: '跨区域移动拒绝后文件逐字节不变且无修改记录'
            }
          )
          for (const kind of regionKinds) await replace(regions, `${kind} A`, `${kind} C`)
          const regionRecord = await apply(regions)
          if (!regionRecord) throw new Error('region review missing')
          const regionReview = await fs.readFile(regionRecord.preview_diff_artifact_path)
          for (const kind of regionKinds) {
            const xml = await readReviewPart(regionReview, `word/${kind}.xml`)
            runtime.assertThat(
              storyText(xml, true).join('') === `${kind} C` &&
                storyText(xml, false).join('') === `${kind} A`,
              { name: `${kind}-char-order`, message: '独立区域应逐字还原首尾内容' }
            )
          }
          await verify('regions', regions, regionsBefore, regionRecord)
          const crossPath = await writeTestDocxFile(runtime.workspaceRoot, 'cross-execution.docx', [
            { type: 'paragraph', text: 'First baseline A' }
          ])
          const crossBefore = await fs.readFile(crossPath)
          await replace(crossPath, 'First baseline A', 'Intermediate B')
          const crossFirst = (
            await harness.ctx.listFileChangeRecords({ runId: runtime.runId })
          ).find((record) => record.path === crossPath)
          const next = createDocxToolHarness(runtime, {
            runId: `${runtime.runId}-next`,
            ownerRunId: runtime.runId
          })
          try {
            const query = async (text: string) =>
              (
                await next.invoke<DocxSearchResult>('docx_search', {
                  sourcePath: crossPath,
                  query: text
                })
              ).matches[0]!.nodeId
            await next.invoke('docx_content_edit', {
              sourcePath: crossPath,
              type: 'replace_text',
              nodeId: await query('Intermediate B'),
              oldText: 'Intermediate B',
              newText: 'Final C'
            })
            const second = (await next.ctx.listFileChangeRecords({ runId: runtime.runId })).find(
              (record) => record.path === crossPath
            )!
            runtime.assertThat(
              second.id === crossFirst?.id && second.beforeChecksum === crossFirst?.beforeChecksum,
              {
                name: 'separate-executions-first-baseline',
                message: '独立 Worker 执行共用 owner 首次基线及记录'
              }
            )
            await next.invoke('docx_content_edit', {
              sourcePath: crossPath,
              type: 'replace_text',
              nodeId: await query('Final C'),
              oldText: 'Final C',
              newText: 'First baseline A'
            })
            runtime.assertThat(
              !(await next.ctx.finalizeRunFileChanges()).some(
                (record) => record.path === crossPath
              ) &&
                !(await next.ctx.listFileChangeRecords({ participatingOnly: false })).some(
                  (r) => r.path === crossPath
                ),
              { name: 'zero-removes-both-stores', message: '恢复后 DOCX 和统一文件入口同时清除' }
            )
          } finally {
            await next.release()
          }
          await fs.writeFile(crossPath, crossBefore)
          // Start a fresh edit after the completed zero-change review.
          const last = createDocxToolHarness(runtime, {
            runId: `${runtime.runId}-last`,
            ownerRunId: runtime.runId
          })
          try {
            const node = (
              await last.invoke<DocxSearchResult>('docx_search', {
                sourcePath: crossPath,
                query: 'First baseline A'
              })
            ).matches[0]!
            await last.invoke('docx_content_edit', {
              sourcePath: crossPath,
              type: 'replace_text',
              nodeId: node.nodeId,
              oldText: 'First baseline A',
              newText: 'Final D'
            })
            const record = (await apply(crossPath, last))!
            await verify('cross-execution-after-zero', crossPath, crossBefore, record)
          } finally {
            await last.release()
          }
          const pendingPath = await writeTestDocxFile(runtime.workspaceRoot, 'record-order.docx', [
            { type: 'paragraph', text: 'Original A' }
          ])
          const pendingBefore = await fs.readFile(pendingPath)
          await replace(pendingPath, 'Original A', 'Intermediate B')
          const ahead = createDocxToolHarness(runtime, {
            runId: `${runtime.runId}-ahead`,
            ownerRunId: runtime.runId
          })
          try {
            const target = (
              await ahead.invoke<DocxSearchResult>('docx_search', {
                sourcePath: pendingPath,
                query: 'Intermediate B'
              })
            ).matches[0]!
            await ahead.invoke('docx_content_edit', {
              sourcePath: pendingPath,
              type: 'replace_text',
              nodeId: target.nodeId,
              oldText: 'Intermediate B',
              newText: 'Final C'
            })
            const record = (await apply(pendingPath, ahead))!
            runtime.assertThat(
              !!record.before_snapshot_path &&
                pendingBefore.equals(await fs.readFile(record.before_snapshot_path)),
              {
                name: 'first-open-before-record-order',
                message: '先进入编辑的任务固定首次快照，后续执行先生成记录也不得以中间稿为基线'
              }
            )
            await verify('record-order', pendingPath, pendingBefore, record)
          } finally {
            await ahead.release()
          }
          return { observations }
        } finally {
          await harness.release()
        }
      },
      assert: async () => {}
    })
  })
})
