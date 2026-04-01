import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createDocxToolHarness,
  writeTestDocxFile
} from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { filterEventsByType } from '../testHelpers'
import { readCapturedRunLog } from '../logHelpers'
import {
  type DocxApplyOpsResult,
  type DocxFailureResult,
  type DocxOpenResult,
  type DocxSaveResult
} from './testUtils'

const createEditedDoc = async (
  harness: ReturnType<typeof createDocxToolHarness>,
  sourcePath: string,
  replacementText: string
): Promise<DocxApplyOpsResult> => {
  const opened = await harness.invoke<DocxOpenResult>('docx_open', {
    sourcePath
  })
  return await harness.invoke<DocxApplyOpsResult>('docx_apply_ops', {
    docId: opened.docId,
    ops: [
      {
        type: 'replace_text',
        query: 'Original save content.',
        replace: replacementText
      }
    ]
  })
}

describe('ai tool docx backend', () => {
  it('docx-save-overwrite-approval', async () => {
    let runId = ''

    await runBackendCase({
      caseId: 'docx-save-overwrite-approval',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证新路径保存、覆盖已有文件审批通过，以及审批拒绝后原文件不被改写。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        runId = runtime.runId
        await writeTestDocxFile(runtime.workspaceRoot, 'save-source.docx', [
          {
            type: 'paragraph',
            text: 'Original save content.'
          }
        ])
        await writeTestDocxFile(runtime.workspaceRoot, 'existing-approved.docx', [
          {
            type: 'paragraph',
            text: 'Existing approved target.'
          }
        ])
        await writeTestDocxFile(runtime.workspaceRoot, 'existing-denied.docx', [
          {
            type: 'paragraph',
            text: 'Existing denied target.'
          }
        ])

        const deniedBufferBefore = await fs.readFile(
          `${runtime.workspaceRoot}/existing-denied.docx`
        )

        const newSaveHarness = createDocxToolHarness(runtime)
        const overwriteHarness = createDocxToolHarness(runtime)
        const deniedHarness = createDocxToolHarness(runtime, {
          approvalPolicy: 'deny-all'
        })

        try {
          const newDoc = await createEditedDoc(
            newSaveHarness,
            'save-source.docx',
            'Saved into a new file.'
          )
          const newSave = await newSaveHarness.invoke<DocxSaveResult>('docx_save', {
            docId: newDoc.newDocId,
            outPath: 'saved/new-output.docx'
          })

          const overwriteDoc = await createEditedDoc(
            overwriteHarness,
            'save-source.docx',
            'Overwrite approved content.'
          )
          const overwriteSave = await overwriteHarness.invoke<DocxSaveResult>('docx_save', {
            docId: overwriteDoc.newDocId,
            outPath: 'existing-approved.docx',
            overwrite: true
          })

          const deniedDoc = await createEditedDoc(
            deniedHarness,
            'save-source.docx',
            'Overwrite denied content.'
          )
          const deniedSave = await deniedHarness.invoke<DocxFailureResult>('docx_save', {
            docId: deniedDoc.newDocId,
            outPath: 'existing-denied.docx',
            overwrite: true
          })
          const deniedBufferAfter = await fs.readFile(
            `${runtime.workspaceRoot}/existing-denied.docx`
          )

          return {
            newSave,
            overwriteSave,
            deniedSave,
            deniedBufferBefore,
            deniedBufferAfter,
            events: runtime.eventCollector.snapshot()
          }
        } finally {
          await Promise.all([
            newSaveHarness.release(),
            overwriteHarness.release(),
            deniedHarness.release()
          ])
        }
      },
      assert: async (result, runtime) => {
        const approvalEvents = filterEventsByType(result.events, 'approval_required')

        runtime.assertThat(
          result.newSave.operation === 'created' &&
            result.overwriteSave.operation === 'updated' &&
            approvalEvents.some((event) => event.command.includes('existing-approved.docx')),
          {
            name: 'save-new-path-and-approved-overwrite-succeed',
            message: '保存到新路径应直接 created；覆盖已有文件时应触发审批并在通过后 updated。',
            data: {
              newSave: result.newSave,
              overwriteSave: result.overwriteSave,
              approvals: approvalEvents.map((event) => event.command)
            }
          }
        )

        runtime.assertThat(
          result.deniedSave.ok === false &&
            result.deniedSave.code === 'approval_denied' &&
            result.deniedBufferBefore.equals(result.deniedBufferAfter),
          {
            name: 'overwrite-denial-keeps-original-file-unchanged',
            message: '审批拒绝后，磁盘上原文件不应被改写。',
            data: {
              deniedSave: result.deniedSave
            }
          }
        )
      }
    })

    const captured = await readCapturedRunLog({
      scope: 'ai/tool/docx',
      caseId: 'docx-save-overwrite-approval',
      runId
    })
    const copiedArtifactNames = await Promise.all(
      captured.artifacts.items.map(async (item) => path.basename(item.path))
    )
    const copiedArtifactSizes = await Promise.all(
      captured.artifacts.items.map(async (item) => {
        const stat = await fs.stat(path.join(captured.logDir, item.path))
        return stat.size
      })
    )

    expect(captured.meta.stats.artifacts).toBe(2)
    expect(captured.artifacts.items).toHaveLength(2)
    expect(copiedArtifactNames.some((name) => name.endsWith('new-output.docx'))).toBe(true)
    expect(copiedArtifactNames.some((name) => name.endsWith('existing-approved.docx'))).toBe(true)
    expect(copiedArtifactSizes.every((size) => size > 0)).toBe(true)
  })
})
