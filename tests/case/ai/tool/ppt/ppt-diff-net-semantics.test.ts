import fs from 'node:fs/promises'
import path from 'node:path'
import { getSlides, getSlideText, loadPresentation } from 'pptx-kit'
import { describe, it } from 'vitest'
import { createPptToolRuntime } from '../../../../../src/main/services/ai/human/tools/ppt/runtime'
import type { PptDiffManifest } from '../../../../../src/main/services/ai/human/tools/ppt/types'
import type { JsonObject } from '../../../../../src/shared/types'
import { createPptToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

type SlideSpec = {
  background?: string
  notes?: string
  elements: Array<Record<string, unknown>>
}

const labeledText = (text: string, y: number) => ({
  type: 'text' as const,
  text,
  bounds: { x: 100, y, width: 420, height: 50 },
  style: { color: '#111827', fontSize: 14 }
})

const slideSpec = (title: string, body = ''): SlideSpec => ({
  background: '#FFFFFF',
  elements: [
    {
      type: 'text',
      text: title,
      bounds: { x: 140, y: 100, width: 780, height: 110 },
      style: { color: '#17324D', fontSize: 36 }
    },
    ...(body
      ? [
          {
            type: 'text' as const,
            text: body,
            bounds: { x: 140, y: 300, width: 780, height: 100 },
            style: { color: '#334155', fontSize: 18 }
          }
        ]
      : [])
  ]
})

const elementDeck: SlideSpec = {
  background: '#FFFFFF',
  elements: [
    labeledText('Layer Original', 40),
    labeledText('Text Original', 100),
    labeledText('Style Original', 160),
    labeledText('Move Original', 220),
    labeledText('Resize Original', 280),
    labeledText('Delete Original', 340),
    labeledText('Restore Original', 400),
    {
      type: 'formula',
      latex: 'E=mc^2',
      bounds: { x: 540, y: 80, width: 380, height: 120 }
    }
  ]
}

const seedDeck = async (
  workspaceRootPath: string,
  sourcePath: string,
  slides: SlideSpec[]
): Promise<void> => {
  const runtime = createPptToolRuntime({
    ctx: { saveFileChangeRecord: async () => undefined } as never,
    cache: {} as never,
    runId: `seed-${sourcePath}`,
    sessionId: 'ppt-diff-seed',
    taskId: 'ppt-diff-seed',
    workspaceRootPath,
    emitActivity: () => undefined
  })
  const fullPath = path.join(workspaceRootPath, sourcePath)
  for (const spec of slides) {
    await runtime.edit({ sourcePath: fullPath, type: 'insert_slide', ...spec })
  }
}

const readManifest = async (previewPath: string): Promise<PptDiffManifest> =>
  JSON.parse(await fs.readFile(previewPath, 'utf8')) as PptDiffManifest

describe('ai tool ppt net diff backend', () => {
  it('ppt-diff-slide-and-element-net-semantics', async () => {
    await runBackendCase({
      caseId: 'ppt-diff-slide-and-element-net-semantics',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['ppt'],
      description: '验证 PPT 页面与元素都按运行初始状态和最终状态生成净 Diff。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await seedDeck(runtime.workspaceRoot, 'slide-net.pptx', [
          slideSpec('Chain A'),
          slideSpec('Delete A'),
          slideSpec('Keep'),
          slideSpec('Delete Middle'),
          slideSpec('Move Me')
        ])
        await seedDeck(runtime.workspaceRoot, 'element-net.pptx', [elementDeck])
        await seedDeck(runtime.workspaceRoot, 'zero-net.pptx', [
          slideSpec('Zero A'),
          slideSpec('Zero Middle'),
          slideSpec('Zero Tail')
        ])
        await seedDeck(runtime.workspaceRoot, 'notes-net.pptx', [
          slideSpec('Notes Final'),
          slideSpec('Notes Restore')
        ])
        await seedDeck(runtime.workspaceRoot, 'replace-net.pptx', [
          slideSpec('Replace Before', 'Keep body')
        ])

        const harness = createPptToolHarness(runtime)
        const slideOutline = await harness.invoke<JsonObject>('ppt_read_outline', {
          sourcePath: path.join(runtime.workspaceRoot, 'slide-net.pptx'),
          ranges: [{ type: 'percent', fromPercent: 0, toPercent: 100 }]
        })
        const slideIds = new Map(
          (slideOutline.slides as Array<{ slideId: string; title?: string; text: string }>).map(
            (slide) => [slide.text.trim(), slide.slideId]
          )
        )
        const chainId = slideIds.get('Chain A')!
        const deleteId = slideIds.get('Delete A')!
        const keepId = slideIds.get('Keep')!
        const deleteMiddleId = slideIds.get('Delete Middle')!
        const moveId = slideIds.get('Move Me')!

        await harness.invoke('ppt_edit', {
          sourcePath: path.join(runtime.workspaceRoot, 'slide-net.pptx'),
          type: 'replace_text',
          slideIds: [chainId],
          query: 'Chain A',
          replace: 'Chain B'
        })
        await harness.invoke('ppt_edit', {
          sourcePath: path.join(runtime.workspaceRoot, 'slide-net.pptx'),
          type: 'replace_text',
          slideIds: [chainId],
          query: 'Chain B',
          replace: 'Chain C'
        })
        await harness.invoke('ppt_edit', {
          sourcePath: path.join(runtime.workspaceRoot, 'slide-net.pptx'),
          type: 'replace_text',
          slideIds: [deleteId],
          query: 'Delete A',
          replace: 'Delete B'
        })
        await harness.invoke('ppt_edit', {
          sourcePath: path.join(runtime.workspaceRoot, 'slide-net.pptx'),
          type: 'delete_slides',
          slideIds: [deleteId]
        })
        const inserted = await harness.invoke<JsonObject>('ppt_edit', {
          sourcePath: path.join(runtime.workspaceRoot, 'slide-net.pptx'),
          type: 'insert_slide',
          location: { slideId: chainId, position: 'after' },
          ...slideSpec('New Draft')
        })
        const insertedId = String(inserted.slideId)
        await harness.invoke('ppt_edit', {
          sourcePath: path.join(runtime.workspaceRoot, 'slide-net.pptx'),
          type: 'replace_text',
          slideIds: [insertedId],
          query: 'New Draft',
          replace: 'New Final'
        })
        const temporary = await harness.invoke<JsonObject>('ppt_edit', {
          sourcePath: path.join(runtime.workspaceRoot, 'slide-net.pptx'),
          type: 'insert_slide',
          location: { slideId: insertedId, position: 'after' },
          ...slideSpec('Temporary Slide')
        })
        const temporaryId = String(temporary.slideId)
        await harness.invoke('ppt_edit', {
          sourcePath: path.join(runtime.workspaceRoot, 'slide-net.pptx'),
          type: 'delete_slides',
          slideIds: [temporaryId, deleteMiddleId]
        })
        await harness.invoke('ppt_edit', {
          sourcePath: path.join(runtime.workspaceRoot, 'slide-net.pptx'),
          type: 'move_slide',
          slideId: moveId,
          location: { slideId: keepId, position: 'before' }
        })

        const elementRead = await harness.invoke<JsonObject>('ppt_read_slides', {
          sourcePath: path.join(runtime.workspaceRoot, 'element-net.pptx'),
          ranges: [{ type: 'slide_index', fromSlideIndex: 1, toSlideIndex: 1 }]
        })
        const elementSlide = (
          elementRead.slides as Array<{
            slideId: string
            elements: Array<{
              elementId: string
              text?: string
              type: string
              bounds?: { x: number; y: number; width: number; height: number }
            }>
          }>
        )[0]!
        const byText = (text: string) =>
          elementSlide.elements.find((element) => element.text === text)!
        const formula = elementSlide.elements.find((element) => element.type === 'formula')!
        const moveBounds = byText('Move Original').bounds!
        const resizeBounds = byText('Resize Original').bounds!

        await harness.invoke('ppt_edit', {
          sourcePath: path.join(runtime.workspaceRoot, 'element-net.pptx'),
          type: 'edit_elements',
          slideId: elementSlide.slideId,
          operations: [
            {
              type: 'set_text',
              elementId: byText('Text Original').elementId,
              text: 'Text Final'
            },
            {
              type: 'set_style',
              elementId: byText('Style Original').elementId,
              style: { color: '#D14343', underline: true }
            },
            {
              type: 'set_bounds',
              elementId: byText('Move Original').elementId,
              bounds: { ...moveBounds, x: moveBounds.x + 80 }
            },
            {
              type: 'set_bounds',
              elementId: byText('Resize Original').elementId,
              bounds: { ...resizeBounds, width: resizeBounds.width + 120 }
            },
            {
              type: 'set_z_order',
              elementId: byText('Layer Original').elementId,
              placement: 'front'
            },
            { type: 'delete_element', elementId: byText('Delete Original').elementId },
            {
              type: 'set_text',
              elementId: byText('Restore Original').elementId,
              text: 'Restore Temporary'
            },
            { type: 'update_formula', elementId: formula.elementId, latex: 'a^2+b^2=c^2' },
            {
              type: 'add_element',
              element: {
                type: 'text',
                text: 'Added Draft',
                bounds: { x: 520, y: 420, width: 400, height: 60 }
              }
            },
            {
              type: 'add_element',
              element: {
                type: 'text',
                text: 'Temporary Element',
                bounds: { x: 520, y: 470, width: 400, height: 60 }
              }
            }
          ]
        })
        await harness.invoke('ppt_edit', {
          sourcePath: path.join(runtime.workspaceRoot, 'element-net.pptx'),
          type: 'set_notes',
          slideId: elementSlide.slideId,
          text: 'Temporary Notes'
        })
        const elementAfterFirst = await harness.invoke<JsonObject>('ppt_read_slides', {
          sourcePath: path.join(runtime.workspaceRoot, 'element-net.pptx'),
          ranges: [{ type: 'slide_ids', slideIds: [elementSlide.slideId] }]
        })
        const updatedElements = (
          elementAfterFirst.slides as Array<{
            elements: Array<{ elementId: string; text?: string; type: string }>
          }>
        )[0]!.elements
        const updatedFormula = updatedElements.find((element) => element.type === 'formula')!
        const added = updatedElements.find((element) => element.text === 'Added Draft')!
        const temporaryElement = updatedElements.find(
          (element) => element.text === 'Temporary Element'
        )!
        await harness.invoke('ppt_edit', {
          sourcePath: path.join(runtime.workspaceRoot, 'element-net.pptx'),
          type: 'edit_elements',
          slideId: elementSlide.slideId,
          operations: [
            {
              type: 'set_text',
              elementId: byText('Restore Original').elementId,
              text: 'Restore Original'
            },
            { type: 'update_formula', elementId: updatedFormula.elementId, latex: 'E=mc^2' },
            { type: 'set_text', elementId: added.elementId, text: 'Added Final' },
            { type: 'delete_element', elementId: temporaryElement.elementId }
          ]
        })
        await harness.invoke('ppt_edit', {
          sourcePath: path.join(runtime.workspaceRoot, 'element-net.pptx'),
          type: 'set_notes',
          slideId: elementSlide.slideId,
          text: ''
        })

        const zeroOutline = await harness.invoke<JsonObject>('ppt_read_outline', {
          sourcePath: path.join(runtime.workspaceRoot, 'zero-net.pptx'),
          ranges: [{ type: 'percent', fromPercent: 0, toPercent: 100 }]
        })
        const zeroSlides = zeroOutline.slides as Array<{ slideId: string; text: string }>
        const zeroId = zeroSlides.find((slide) => slide.text.trim() === 'Zero A')!.slideId
        const zeroMiddleId = zeroSlides.find(
          (slide) => slide.text.trim() === 'Zero Middle'
        )!.slideId
        const zeroTailId = zeroSlides.find((slide) => slide.text.trim() === 'Zero Tail')!.slideId
        await harness.invoke('ppt_edit', {
          sourcePath: path.join(runtime.workspaceRoot, 'zero-net.pptx'),
          type: 'replace_text',
          slideIds: [zeroId],
          query: 'Zero A',
          replace: 'Zero B'
        })
        await harness.invoke('ppt_edit', {
          sourcePath: path.join(runtime.workspaceRoot, 'zero-net.pptx'),
          type: 'replace_text',
          slideIds: [zeroId],
          query: 'Zero B',
          replace: 'Zero A'
        })
        await harness.invoke('ppt_edit', {
          sourcePath: path.join(runtime.workspaceRoot, 'zero-net.pptx'),
          type: 'move_slide',
          slideId: zeroTailId,
          location: { slideId: zeroMiddleId, position: 'before' }
        })
        await harness.invoke('ppt_edit', {
          sourcePath: path.join(runtime.workspaceRoot, 'zero-net.pptx'),
          type: 'move_slide',
          slideId: zeroTailId,
          location: { slideId: zeroMiddleId, position: 'after' }
        })
        const zeroTemporary = await harness.invoke<JsonObject>('ppt_edit', {
          sourcePath: path.join(runtime.workspaceRoot, 'zero-net.pptx'),
          type: 'insert_slide',
          location: { slideId: zeroId, position: 'after' },
          ...slideSpec('Zero Temporary')
        })
        const zeroTemporaryId = String(zeroTemporary.slideId)
        await harness.invoke('ppt_edit', {
          sourcePath: path.join(runtime.workspaceRoot, 'zero-net.pptx'),
          type: 'delete_slides',
          slideIds: [zeroTemporaryId]
        })

        const notesOutline = await harness.invoke<JsonObject>('ppt_read_outline', {
          sourcePath: path.join(runtime.workspaceRoot, 'notes-net.pptx'),
          ranges: [{ type: 'percent', fromPercent: 0, toPercent: 100 }]
        })
        const notesSlides = notesOutline.slides as Array<{ slideId: string; text: string }>
        const notesFinalId = notesSlides.find(
          (slide) => slide.text.trim() === 'Notes Final'
        )!.slideId
        const notesRestoreId = notesSlides.find(
          (slide) => slide.text.trim() === 'Notes Restore'
        )!.slideId
        await harness.invoke('ppt_edit', {
          sourcePath: path.join(runtime.workspaceRoot, 'notes-net.pptx'),
          type: 'set_notes',
          slideId: notesFinalId,
          text: 'Final speaker notes'
        })
        await harness.invoke('ppt_edit', {
          sourcePath: path.join(runtime.workspaceRoot, 'notes-net.pptx'),
          type: 'set_notes',
          slideId: notesRestoreId,
          text: 'Temporary speaker notes'
        })
        await harness.invoke('ppt_edit', {
          sourcePath: path.join(runtime.workspaceRoot, 'notes-net.pptx'),
          type: 'set_notes',
          slideId: notesRestoreId,
          text: ''
        })

        const replaceOutline = await harness.invoke<JsonObject>('ppt_read_outline', {
          sourcePath: path.join(runtime.workspaceRoot, 'replace-net.pptx'),
          ranges: [{ type: 'percent', fromPercent: 0, toPercent: 100 }]
        })
        const replaceSlideId = (replaceOutline.slides as Array<{ slideId: string }>)[0]!.slideId
        await harness.invoke('ppt_edit', {
          sourcePath: path.join(runtime.workspaceRoot, 'replace-net.pptx'),
          type: 'replace_slide',
          slideId: replaceSlideId,
          background: '#FFFFFF',
          elements: [
            {
              type: 'text',
              text: 'Replace After A',
              bounds: { x: 140, y: 80, width: 780, height: 90 },
              style: { fontSize: 28 }
            },
            {
              type: 'text',
              text: 'Replace After B',
              bounds: { x: 140, y: 220, width: 780, height: 90 },
              style: { fontSize: 20 }
            },
            {
              type: 'text',
              text: 'Replace After C',
              bounds: { x: 140, y: 360, width: 780, height: 90 },
              style: { fontSize: 20 }
            }
          ]
        })

        const records = await harness.runtime.commitAll()
        const recordByName = new Map(records.map((record) => [record.fileName, record]))
        const slideRecord = recordByName.get('slide-net.pptx')!
        const elementRecord = recordByName.get('element-net.pptx')!
        const notesRecord = recordByName.get('notes-net.pptx')!
        const replaceRecord = recordByName.get('replace-net.pptx')!
        const slideManifest = await readManifest(slideRecord.previewPath!)
        const elementManifest = await readManifest(elementRecord.previewPath!)
        const notesManifest = await readManifest(notesRecord.previewPath!)
        const replaceManifest = await readManifest(replaceRecord.previewPath!)
        const slideFrameTexts = await Promise.all(
          slideManifest.slides.flatMap((slide) =>
            [slide.before?.svg, slide.after?.svg]
              .filter((filePath): filePath is string => Boolean(filePath))
              .map((filePath) => fs.readFile(filePath, 'utf8'))
          )
        )
        const finalSlidePresentation = await loadPresentation(
          new Uint8Array(await fs.readFile(path.join(runtime.workspaceRoot, 'slide-net.pptx')))
        )
        return {
          recordNames: records.map((record) => record.fileName).sort(),
          slideRecord,
          elementRecord,
          notesRecord,
          replaceRecord,
          slideManifest,
          elementManifest,
          notesManifest,
          replaceManifest,
          slideFrameText: slideFrameTexts.join('\n'),
          finalSlideTexts: getSlides(finalSlidePresentation).map((slide) => getSlideText(slide))
        }
      },
      assert: async (result, runtime) => {
        const slideById = new Map(
          result.slideManifest.slides.map((slide) => [slide.slideId, slide])
        )
        const changedSlides = result.slideManifest.slides.filter((slide) => slide.changed)
        const unchangedSlides = result.slideManifest.slides.filter((slide) => !slide.changed)
        const elementSlide = result.elementManifest.slides.find((slide) => slide.changed)!
        runtime.assertThat(
          JSON.stringify(result.recordNames) ===
            JSON.stringify(['element-net.pptx', 'notes-net.pptx', 'replace-net.pptx', 'slide-net.pptx']) &&
            result.slideManifest.version === 4 &&
            result.slideManifest.positiveCount === 3 &&
            result.slideManifest.negativeCount === 2 &&
            result.slideRecord.insertCount === 3 &&
            result.slideRecord.deleteCount === 2 &&
            result.slideRecord.changeCount === 5 &&
            changedSlides.length === 5 &&
            unchangedSlides.length === 1 &&
            unchangedSlides[0]?.changes.length === 0 &&
            [...slideById.values()].filter((slide) => slide.changes.includes('moved')).length ===
              1 &&
            result.slideFrameText.includes('Chain A') &&
            result.slideFrameText.includes('Chain C') &&
            !result.slideFrameText.includes('Chain B') &&
            result.slideFrameText.includes('Delete A') &&
            !result.slideFrameText.includes('Delete B') &&
            result.slideFrameText.includes('New Final') &&
            !result.slideFrameText.includes('New Draft') &&
            !result.slideFrameText.includes('Temporary Slide') &&
            JSON.stringify(result.finalSlideTexts.map((text) => text.trim())) ===
              JSON.stringify(['Chain C', 'New Final', 'Move Me', 'Keep']),
          {
            name: 'ppt-slide-net-diff-collapses-intermediate-and-structural-noise',
            message: 'PPT 页面 Diff 应只保留最终净变化，插入删除造成的页码偏移不得标记移动。',
            data: result
          }
        )
        runtime.assertThat(
          result.elementManifest.version === 4 &&
            result.elementManifest.positiveCount === 6 &&
            result.elementManifest.negativeCount === 1 &&
            result.elementRecord.insertCount === 6 &&
            result.elementRecord.deleteCount === 1 &&
            result.elementRecord.changeCount === 7 &&
            JSON.stringify(elementSlide.changes) === JSON.stringify(['modified']) &&
            elementSlide.elementChanges.filter((change) => change.kind === 'modified').length ===
              5 &&
            elementSlide.elementChanges.filter((change) => change.kind === 'added').length === 1 &&
            elementSlide.elementChanges.filter((change) => change.kind === 'deleted').length === 1,
          {
            name: 'ppt-element-net-diff-counts-final-add-modify-move-and-delete',
            message: 'PPT 元素加减数量必须来自 baseline 与最终状态，同一元素多次修改只计一次。',
            data: result.elementManifest
          }
        )
        runtime.assertThat(
          result.notesManifest.version === 4 &&
            result.notesManifest.positiveCount === 1 &&
            result.notesManifest.negativeCount === 0 &&
            result.notesRecord.insertCount === 1 &&
            result.notesRecord.deleteCount === 0 &&
            result.notesRecord.changeCount === 1 &&
            result.notesManifest.slides.filter((slide) => slide.changed).length === 1 &&
            result.notesManifest.slides.filter((slide) => !slide.changed).length === 1,
          {
            name: 'ppt-page-notes-net-diff-collapses-restored-notes',
            message: 'PPT 页面备注应按最终净变化计数，恢复原备注的页面不得留下修改。',
            data: result.notesManifest
          }
        )
        const replacedSlide = result.replaceManifest.slides.find((slide) => slide.changed)!
        runtime.assertThat(
          result.replaceManifest.version === 4 &&
            result.replaceRecord.insertCount === 3 &&
            result.replaceRecord.deleteCount === 2 &&
            result.replaceRecord.changeCount === 5 &&
            JSON.stringify(replacedSlide.changes) === JSON.stringify(['modified']) &&
            replacedSlide.elementChanges.filter((change) => change.kind === 'deleted').length ===
              2 &&
            replacedSlide.elementChanges.filter((change) => change.kind === 'added').length === 3 &&
            replacedSlide.elementChanges.every((change) => change.kind !== 'modified'),
          {
            name: 'ppt-replace-slide-counts-old-deleted-and-new-added',
            message: 'replace_slide 应保留同一 slideId，并按旧元素全删、新元素全加计数。',
            data: result.replaceManifest
          }
        )
      }
    })
  }, 120_000)
})
