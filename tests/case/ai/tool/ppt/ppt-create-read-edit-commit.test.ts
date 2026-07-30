import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import path from 'node:path'
import { getSlides, getSlideShapes, getSlideText, isChartShape, loadPresentation } from 'pptx-kit'
import { describe, it } from 'vitest'
import type { JsonObject } from '../../../../../src/shared/types'
import { createPptToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

const coverHtml = `<section data-ppt-slide style="position:relative;width:1920px;height:1080px;background:#F5F0E8">
  <div style="position:absolute;left:100px;top:90px;width:1720px;height:220px;background:#17324D;border-radius:28px"></div>
  <h1 style="position:absolute;left:170px;top:135px;width:1450px;height:120px;color:#FFFFFF;font-size:72px">2026 产品复盘</h1>
  <p style="position:absolute;left:170px;top:420px;width:1480px;height:120px;color:#25313C;font-size:38px">收入增长 18%，交付质量继续提升。</p>
</section>`

const detailHtml = `<section data-ppt-slide style="position:relative;width:1920px;height:1080px;background:#FFFFFF">
  <h2 style="position:absolute;left:140px;top:100px;width:1500px;height:110px;color:#17324D;font-size:72px">核心结论</h2>
  <p style="position:absolute;left:160px;top:300px;width:1450px;height:120px;color:#333333;font-size:36px">下一季度重点：缩短反馈周期。</p>
  <span data-pptx-latex="E=mc^2" style="position:absolute;left:160px;top:520px;width:600px;height:160px"></span>
  <div data-pptx-chart="column" data-pptx-categories='["Q1","Q2"]' data-pptx-series='[{"name":"收入","values":[12,18]}]' style="position:absolute;left:900px;top:500px;width:760px;height:420px"></div>
</section>`

const startVisionServer = async (): Promise<{ baseUrl: string; close: () => Promise<void> }> => {
  const sockets = new Set<Socket>()
  const server = createServer((request, response) => {
    request.resume()
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    response.end(
      JSON.stringify({
        id: 'chatcmpl-ppt-visuals',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'gpt-5',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify({
                supports_image_recognition: true,
                result: '第2页展示核心结论，并包含公式和收入柱状图。'
              })
            },
            finish_reason: 'stop'
          }
        ]
      })
    )
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}/v1`,
    close: async () => {
      sockets.forEach((socket) => socket.destroy())
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  }
}

describe('ai tool ppt backend', () => {
  it('ppt-create-read-edit-commit', async () => {
    await runBackendCase({
      caseId: 'ppt-create-read-edit-commit',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['ppt'],
      description: '验证 ppt_edit 批量创建、独立读取工具、写后回读、run 末一次写回和 diff。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const visionServer = await startVisionServer()
        const sourcePath = 'product-review.pptx'
        try {
          await runtime.seedLlmConfig({
            id: 'ai-live-config',
            name: 'PPT 视觉读取测试配置',
            providerKind: 'openai-compatible',
            base_url: visionServer.baseUrl,
            model_name: 'gpt-5',
            api_key: 'test-key'
          })
          const harness = createPptToolHarness(runtime, { modelName: 'gpt-5' })
          const created = await harness.invoke<JsonObject>('ppt_edit', {
            sourcePath,
            actions: [
              { type: 'insert_slide', html: coverHtml },
              { type: 'insert_slide', html: detailHtml }
            ]
          })
          const inserted = created
          const overview = await harness.invoke<JsonObject>('ppt_read_outline', {
            sourcePath,
            ranges: [{ type: 'percent', fromPercent: 0, toPercent: 100 }]
          })
          const firstSlideId = (overview.slides as Array<{ slideId: string }>)[0]!.slideId
          const readSlides = await harness.invoke<JsonObject>('ppt_read_slides', {
            sourcePath,
            ranges: [{ type: 'slide_ids', slideIds: [firstSlideId] }]
          })
          const failedDelete = await harness.invoke<JsonObject>('ppt_edit', {
            sourcePath,
            actions: [
              { type: 'replace_text', query: '2026 产品复盘', replace: '不应落盘的标题' },
              {
                type: 'delete_slides',
                slideIds: [firstSlideId, '/ppt/slides/missing.xml']
              }
            ]
          })
          const overviewAfterFailedDelete = await harness.invoke<JsonObject>('ppt_read_outline', {
            sourcePath,
            ranges: [{ type: 'slide_index', fromSlideIndex: 1, toSlideIndex: 2 }]
          })
          const replaced = await harness.invoke<JsonObject>('ppt_edit', {
            sourcePath,
            actions: [{ type: 'replace_text', query: '反馈周期', replace: '客户反馈周期' }]
          })
          const search = await harness.invoke<JsonObject>('ppt_search', {
            sourcePath,
            query: '客户反馈周期'
          })
          const visual = await harness.invoke<JsonObject>('ppt_read_visuals', {
            sourcePath,
            requests: [{ index: 2, instruction: '说明第 2 页视觉内容。' }]
          })
          const targetPath = path.join(runtime.workspaceRoot, sourcePath)
          const beforeCommitExists = await fs
            .access(targetPath)
            .then(() => true)
            .catch(() => false)
          const aiPersistedBytes = new Uint8Array(await fs.readFile(targetPath))
          const aiPersistedChecksum = createHash('sha256').update(aiPersistedBytes).digest('hex')
          await fs.writeFile(
            targetPath,
            Buffer.concat([Buffer.from(aiPersistedBytes), Buffer.from('external-user-change')])
          )
          const externallyChangedChecksum = createHash('sha256')
            .update(await fs.readFile(targetPath))
            .digest('hex')
          const records = await harness.runtime.commitAll()
          const repeatedCommitRecords = await harness.runtime.commitAll()
          const bytes = new Uint8Array(await fs.readFile(targetPath))
          const presentation = await loadPresentation(bytes)
          const texts = getSlides(presentation).map((slide) => getSlideText(slide))
          const hasChart = getSlides(presentation).some((slide) =>
            getSlideShapes(slide).some((shape) => isChartShape(shape))
          )
          const manifest = JSON.parse(await fs.readFile(records[0]!.previewPath!, 'utf8')) as {
            slides: Array<{ changed: boolean; after?: unknown; before?: unknown }>
          }
          return {
            created,
            inserted,
            overview,
            readSlides,
            failedDelete,
            overviewAfterFailedDelete,
            replaced,
            search,
            visual,
            beforeCommitExists,
            aiPersistedChecksum,
            externallyChangedChecksum,
            records,
            repeatedCommitRecords,
            slideCount: getSlides(presentation).length,
            texts,
            hasChart,
            manifest
          }
        } finally {
          await visionServer.close()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(result.beforeCommitExists === true, {
          name: 'ppt-edit-writes-real-file-immediately',
          message: 'ppt_edit 返回成功前必须已经写入真实 PPTX 文件。',
          data: { beforeCommitExists: result.beforeCommitExists }
        })
        runtime.assertThat(
          result.created.slideCount === 2 &&
            result.inserted.slideCount === 2 &&
            Boolean((result.created.postWriteReadback as JsonObject)?.slides) &&
            Boolean((result.inserted.postWriteReadback as JsonObject)?.slides) &&
            result.overview.slideCount === 2 &&
            Array.isArray(result.readSlides.slides) &&
            result.readSlides.slides.length === 1 &&
            result.failedDelete.ok === false &&
            result.overviewAfterFailedDelete.slideCount === 2 &&
            !JSON.stringify(result.overviewAfterFailedDelete).includes('不应落盘的标题') &&
            Array.isArray(result.search.matches) &&
            result.search.matches.length === 1 &&
            Array.isArray(result.visual.results) &&
            result.visual.results.length === 1 &&
            String(
              (result.visual.results as Array<{ index: number; text?: string }>)[0]?.text || ''
            ).includes('公式和收入柱状图'),
          {
            name: 'ppt-edit-persists-before-run-finalization',
            message: 'PPT 编辑成功后应立即写入正式文件，同时保持后续读取和 run 级差异生成能力。',
            data: result
          }
        )
        runtime.assertThat(
          result.records.length === 1 &&
            result.records[0]!.capability === 'ppt' &&
            result.records[0]!.operation === 'created' &&
            result.records[0]!.insertCount === 2 &&
            result.records[0]!.deleteCount === 0 &&
            result.records[0]!.afterChecksum === result.aiPersistedChecksum &&
            result.records[0]!.afterChecksum !== result.externallyChangedChecksum &&
            result.repeatedCommitRecords.length === 0 &&
            result.slideCount === 2 &&
            result.hasChart &&
            result.texts.some((text) => text.includes('客户反馈周期')) &&
            result.manifest.slides.length === 2 &&
            result.manifest.slides.every((slide) => slide.changed && slide.after && !slide.before),
          {
            name: 'ppt-run-commits-one-file-record-and-diff',
            message: 'run 结束后应只写回一次 PPT，并生成页面级加减数量与 diff manifest。',
            data: result
          }
        )
      }
    })
  }, 120_000)
})
