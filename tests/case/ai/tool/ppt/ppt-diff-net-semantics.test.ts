import fs from 'node:fs/promises'
import path from 'node:path'
import { getSlides, getSlideText, loadPresentation } from 'pptx-kit'
import { describe, it } from 'vitest'
import { createPptToolRuntime } from '../../../../../src/main/services/ai/human/tools/ppt/runtime'
import type { PptDiffManifest } from '../../../../../src/main/services/ai/human/tools/ppt/types'
import type { JsonObject } from '../../../../../src/shared/types'
import { createPptToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

const slideHtml = (title: string, body = ''): string => `
  <section data-ppt-slide style="position:relative;width:1920px;height:1080px;background:#FFFFFF">
    <h1 data-ppt-element="text" style="position:absolute;left:140px;top:100px;width:1500px;height:110px;color:#17324D;font-size:72px">${title}</h1>
    <p data-ppt-element="text" style="position:absolute;left:140px;top:300px;width:1500px;height:100px;color:#334155;font-size:36px">${body}</p>
  </section>`

const elementDeckHtml = `
  <section data-ppt-slide style="position:relative;width:1920px;height:1080px;background:#FFFFFF">
    <p data-ppt-element="text" style="position:absolute;left:100px;top:80px;width:420px;height:70px;color:#111827;font-size:28px">Layer Original</p>
    <p data-ppt-element="text" style="position:absolute;left:100px;top:180px;width:420px;height:70px;color:#111827;font-size:28px">Text Original</p>
    <p data-ppt-element="text" style="position:absolute;left:100px;top:280px;width:420px;height:70px;color:#111827;font-size:28px">Style Original</p>
    <p data-ppt-element="text" style="position:absolute;left:100px;top:380px;width:420px;height:70px;color:#111827;font-size:28px">Move Original</p>
    <p data-ppt-element="text" style="position:absolute;left:100px;top:480px;width:420px;height:70px;color:#111827;font-size:28px">Resize Original</p>
    <p data-ppt-element="text" style="position:absolute;left:100px;top:580px;width:420px;height:70px;color:#111827;font-size:28px">Delete Original</p>
    <p data-ppt-element="text" style="position:absolute;left:100px;top:680px;width:420px;height:70px;color:#111827;font-size:28px">Restore Original</p>
    <span data-pptx-latex="E=mc^2" style="position:absolute;left:900px;top:180px;width:600px;height:180px"></span>
  </section>`

const seedDeck = async (
  workspaceRootPath: string,
  sourcePath: string,
  htmlSlides: string[]
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
  await runtime.edit({
    sourcePath,
    actions: htmlSlides.map((html) => ({ type: 'insert_slide', html }))
  })
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
          slideHtml('Chain A'),
          slideHtml('Delete A'),
          slideHtml('Keep'),
          slideHtml('Delete Middle'),
          slideHtml('Move Me')
        ])
        await seedDeck(runtime.workspaceRoot, 'element-net.pptx', [elementDeckHtml])
        await seedDeck(runtime.workspaceRoot, 'zero-net.pptx', [
          slideHtml('Zero A'),
          slideHtml('Zero Middle'),
          slideHtml('Zero Tail')
        ])
        await seedDeck(runtime.workspaceRoot, 'notes-net.pptx', [
          slideHtml('Notes Final'),
          slideHtml('Notes Restore')
        ])

        const harness = createPptToolHarness(runtime)
        const slideOutline = await harness.invoke<JsonObject>('ppt_read_outline', {
          sourcePath: 'slide-net.pptx',
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
          sourcePath: 'slide-net.pptx',
          actions: [
            { type: 'replace_text', slideIds: [chainId], query: 'Chain A', replace: 'Chain B' }
          ]
        })
        await harness.invoke('ppt_edit', {
          sourcePath: 'slide-net.pptx',
          actions: [
            { type: 'replace_text', slideIds: [chainId], query: 'Chain B', replace: 'Chain C' }
          ]
        })
        await harness.invoke('ppt_edit', {
          sourcePath: 'slide-net.pptx',
          actions: [
            { type: 'replace_text', slideIds: [deleteId], query: 'Delete A', replace: 'Delete B' },
            { type: 'delete_slides', slideIds: [deleteId] }
          ]
        })
        const inserted = await harness.invoke<JsonObject>('ppt_edit', {
          sourcePath: 'slide-net.pptx',
          actions: [
            {
              type: 'insert_slide',

              location: { slideId: chainId, position: 'after' },
              html: slideHtml('New Draft')
            }
          ]
        })
        const insertedId = (inserted.postWriteReadback as { slides: Array<{ slideId: string }> })
          .slides[0]!.slideId
        await harness.invoke('ppt_edit', {
          sourcePath: 'slide-net.pptx',
          actions: [
            {
              type: 'replace_text',
              slideIds: [insertedId],
              query: 'New Draft',
              replace: 'New Final'
            }
          ]
        })
        const temporary = await harness.invoke<JsonObject>('ppt_edit', {
          sourcePath: 'slide-net.pptx',
          actions: [
            {
              type: 'insert_slide',

              location: { slideId: insertedId, position: 'after' },
              html: slideHtml('Temporary Slide')
            }
          ]
        })
        const temporaryId = (temporary.postWriteReadback as { slides: Array<{ slideId: string }> })
          .slides[0]!.slideId
        await harness.invoke('ppt_edit', {
          sourcePath: 'slide-net.pptx',
          actions: [
            { type: 'delete_slides', slideIds: [temporaryId, deleteMiddleId] },
            {
              type: 'move_slide',
              slideId: moveId,
              location: { slideId: keepId, position: 'before' }
            }
          ]
        })

        const elementRead = await harness.invoke<JsonObject>('ppt_read_slides', {
          sourcePath: 'element-net.pptx',
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
          sourcePath: 'element-net.pptx',
          actions: [
            {
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
                    bounds: { x: 900, y: 500, width: 500, height: 80 }
                  }
                },
                {
                  type: 'add_element',
                  element: {
                    type: 'text',
                    text: 'Temporary Element',
                    bounds: { x: 900, y: 650, width: 500, height: 80 }
                  }
                }
              ]
            },
            { type: 'set_notes', slideId: elementSlide.slideId, text: 'Temporary Notes' }
          ]
        })
        const elementAfterFirst = await harness.invoke<JsonObject>('ppt_read_slides', {
          sourcePath: 'element-net.pptx',
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
          sourcePath: 'element-net.pptx',
          actions: [
            {
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
            },
            { type: 'set_notes', slideId: elementSlide.slideId, text: '' }
          ]
        })

        const zeroOutline = await harness.invoke<JsonObject>('ppt_read_outline', {
          sourcePath: 'zero-net.pptx',
          ranges: [{ type: 'percent', fromPercent: 0, toPercent: 100 }]
        })
        const zeroSlides = zeroOutline.slides as Array<{ slideId: string; text: string }>
        const zeroId = zeroSlides.find((slide) => slide.text.trim() === 'Zero A')!.slideId
        const zeroMiddleId = zeroSlides.find(
          (slide) => slide.text.trim() === 'Zero Middle'
        )!.slideId
        const zeroTailId = zeroSlides.find((slide) => slide.text.trim() === 'Zero Tail')!.slideId
        await harness.invoke('ppt_edit', {
          sourcePath: 'zero-net.pptx',
          actions: [
            { type: 'replace_text', slideIds: [zeroId], query: 'Zero A', replace: 'Zero B' },
            { type: 'replace_text', slideIds: [zeroId], query: 'Zero B', replace: 'Zero A' },
            {
              type: 'move_slide',
              slideId: zeroTailId,

              location: { slideId: zeroMiddleId, position: 'before' }
            },
            {
              type: 'move_slide',
              slideId: zeroTailId,

              location: { slideId: zeroMiddleId, position: 'after' }
            }
          ]
        })
        const zeroTemporary = await harness.invoke<JsonObject>('ppt_edit', {
          sourcePath: 'zero-net.pptx',
          actions: [
            {
              type: 'insert_slide',

              location: { slideId: zeroId, position: 'after' },
              html: slideHtml('Zero Temporary')
            }
          ]
        })
        const zeroTemporaryId = (
          zeroTemporary.postWriteReadback as { slides: Array<{ slideId: string }> }
        ).slides[0]!.slideId
        await harness.invoke('ppt_edit', {
          sourcePath: 'zero-net.pptx',
          actions: [{ type: 'delete_slides', slideIds: [zeroTemporaryId] }]
        })

        const notesOutline = await harness.invoke<JsonObject>('ppt_read_outline', {
          sourcePath: 'notes-net.pptx',
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
          sourcePath: 'notes-net.pptx',
          actions: [
            { type: 'set_notes', slideId: notesFinalId, text: 'Final speaker notes' },
            { type: 'set_notes', slideId: notesRestoreId, text: 'Temporary speaker notes' }
          ]
        })
        await harness.invoke('ppt_edit', {
          sourcePath: 'notes-net.pptx',
          actions: [{ type: 'set_notes', slideId: notesRestoreId, text: '' }]
        })

        const records = await harness.runtime.commitAll()
        const recordByName = new Map(records.map((record) => [record.fileName, record]))
        const slideRecord = recordByName.get('slide-net.pptx')!
        const elementRecord = recordByName.get('element-net.pptx')!
        const notesRecord = recordByName.get('notes-net.pptx')!
        const slideManifest = await readManifest(slideRecord.previewPath!)
        const elementManifest = await readManifest(elementRecord.previewPath!)
        const notesManifest = await readManifest(notesRecord.previewPath!)
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
          slideManifest,
          elementManifest,
          notesManifest,
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
            JSON.stringify(['element-net.pptx', 'notes-net.pptx', 'slide-net.pptx']) &&
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
      }
    })
  }, 120_000)
})
