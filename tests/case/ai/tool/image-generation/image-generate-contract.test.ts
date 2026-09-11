import fs from 'node:fs/promises'
import path from 'node:path'
import { loadImage } from '@napi-rs/canvas'
import { describe, it } from 'vitest'
import { createImageGenerationToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

const createSvg = (fill: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24" viewBox="0 0 32 24"><rect width="32" height="24" fill="${fill}" /></svg>`

describe('ai tool image-generation backend', () => {
  it('image-generate-format-create-update-contract', async () => {
    await runBackendCase({
      caseId: 'image-generate-format-create-update-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['image-generation'],
      description: '验证 SVG 输入生成 PNG、JPEG、WebP，并自动记录创建、更新和文件产物。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const harness = createImageGenerationToolHarness(runtime)
        const pngResult = await harness.invoke<{ outputPath: string }>('image_generate', {
          outputPath: path.join(runtime.workspaceRoot, 'images', 'generated.png'),
          svg: createSvg('#3366ff')
        })
        await harness.invoke('image_generate', {
          outputPath: path.join(runtime.workspaceRoot, 'images', 'generated.jpg'),
          svg: createSvg('#00aa66')
        })
        await harness.invoke('image_generate', {
          outputPath: path.join(runtime.workspaceRoot, 'images', 'generated.webp'),
          svg: createSvg('#cc3366')
        })
        await harness.invoke('image_generate', {
          outputPath: path.join(runtime.workspaceRoot, 'images', 'generated.png'),
          svg: createSvg('#ffcc00')
        })

        const existingPath = path.join(runtime.workspaceRoot, 'images', 'existing.jpeg')
        await fs.writeFile(existingPath, Buffer.from('original-image'))
        await harness.invoke('image_generate', {
          outputPath: path.join(runtime.workspaceRoot, 'images', 'existing.jpeg'),
          svg: createSvg('#111111')
        })
        await harness.invoke('image_generate', {
          outputPath: path.join(runtime.workspaceRoot, 'images', 'existing.jpeg'),
          svg: createSvg('#eeeeee')
        })

        const png = await fs.readFile(path.join(runtime.workspaceRoot, 'images', 'generated.png'))
        const jpeg = await fs.readFile(path.join(runtime.workspaceRoot, 'images', 'generated.jpg'))
        const webp = await fs.readFile(path.join(runtime.workspaceRoot, 'images', 'generated.webp'))
        const [decodedPng, decodedJpeg, decodedWebp] = await Promise.all([
          loadImage(png),
          loadImage(jpeg),
          loadImage(webp)
        ])
        const records = await harness.ctx.listFileChangeRecords({ runId: runtime.runId })
        const generatedRecord = records.find((record) => record.fileName === 'generated.png')
        const existingRecord = records.find((record) => record.fileName === 'existing.jpeg')
        const artifacts = runtime.eventCollector
          .snapshot()
          .filter((event) => event.type === 'file_artifact' && event.capability === 'image')

        return {
          pngResult,
          pngSignature: png.subarray(0, 8).toString('hex'),
          jpegSignature: jpeg.subarray(0, 3).toString('hex'),
          webpSignature: webp.subarray(0, 12).toString('ascii'),
          decodedDimensions: [decodedPng, decodedJpeg, decodedWebp].map((image) => [
            image.width,
            image.height
          ]),
          recordCount: records.length,
          generatedOperation: generatedRecord?.operation,
          generatedChangeCount: generatedRecord?.changeCount,
          existingOperation: existingRecord?.operation,
          existingSource: existingRecord?.source,
          existingChangeCount: existingRecord?.changeCount,
          existingSnapshot: existingRecord?.beforeSnapshotPath
            ? (await fs.readFile(existingRecord.beforeSnapshotPath)).toString('utf8')
            : '',
          artifactCount: artifacts.length,
          generatedApplyIds: artifacts
            .filter((event) => event.fileName === 'generated.png')
            .map((event) => event.applyId),
          existingApplyIds: artifacts
            .filter((event) => event.fileName === 'existing.jpeg')
            .map((event) => event.applyId),
          activityStatuses: harness.activities.map((activity) => activity.status)
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.pngResult.outputPath ===
            path.join(runtime.workspaceRoot, 'images', 'generated.png') &&
            result.pngSignature === '89504e470d0a1a0a' &&
            result.jpegSignature === 'ffd8ff' &&
            result.webpSignature.startsWith('RIFF') &&
            result.webpSignature.endsWith('WEBP') &&
            result.decodedDimensions.every(([width, height]) => width === 32 && height === 24) &&
            result.recordCount === 4 &&
            result.generatedOperation === 'created' &&
            result.generatedChangeCount === 2 &&
            result.existingOperation === 'updated' &&
            result.existingSource === 'image_tool' &&
            result.existingChangeCount === 2 &&
            result.existingSnapshot === 'original-image' &&
            result.artifactCount === 6 &&
            result.generatedApplyIds.length === 2 &&
            new Set(result.generatedApplyIds).size === 1 &&
            result.existingApplyIds.length === 2 &&
            new Set(result.existingApplyIds).size === 1 &&
            result.activityStatuses.filter((status) => status === 'completed').length === 6,
          {
            name: 'image-generate-formats-and-file-records',
            message: '图片工具应生成真实图片，并为创建和更新保存稳定的修改记录与 Artifact。',
            data: result
          }
        )
      }
    })
  })

  it('image-generate-safety-and-boundary-contract', async () => {
    await runBackendCase({
      caseId: 'image-generate-safety-and-boundary-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['image-generation'],
      description: '验证危险 SVG、非法格式会失败，工作区外路径可写入但不产生回退记录。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const harness = createImageGenerationToolHarness(runtime)
        const preservedPath = path.join(runtime.workspaceRoot, 'images', 'preserved.png')
        const preservedBytes = Buffer.from('original-image-must-remain')
        await fs.mkdir(path.dirname(preservedPath), { recursive: true })
        await fs.writeFile(preservedPath, preservedBytes)
        const captureError = async (args: { outputPath: string; svg: string }): Promise<string> => {
          try {
            await harness.invoke('image_generate', args)
            return ''
          } catch (error) {
            return error instanceof Error ? error.message : String(error)
          }
        }
        const scriptError = await captureError({
          outputPath: path.join(runtime.workspaceRoot, 'images', 'script.png'),
          svg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>'
        })
        const externalError = await captureError({
          outputPath: path.join(runtime.workspaceRoot, 'images', 'external.png'),
          svg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><image href="https://example.com/a.png" /></svg>'
        })
        const cssExternalError = await captureError({
          outputPath: path.join(runtime.workspaceRoot, 'images', 'css-external.png'),
          svg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><style>rect { fill: url(https://example.com/fill.svg); }</style><rect width="10" height="10" /></svg>'
        })
        const cssImportError = await captureError({
          outputPath: path.join(runtime.workspaceRoot, 'images', 'css-import.png'),
          svg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><style>@import "https://example.com/style.css";</style></svg>'
        })
        const oversizedError = await captureError({
          outputPath: path.join(runtime.workspaceRoot, 'images', 'oversized.png'),
          svg: '<svg xmlns="http://www.w3.org/2000/svg" width="9000" height="10" />'
        })
        const outsidePath = path.join(path.dirname(runtime.workspaceRoot), 'outside.png')
        const outsideError = await captureError({
          outputPath: outsidePath,
          svg: createSvg('#123456')
        })
        const formatError = await captureError({
          outputPath: path.join(runtime.workspaceRoot, 'images', 'generated.gif'),
          svg: createSvg('#000000')
        })
        const malformedError = await captureError({
          outputPath: path.join(runtime.workspaceRoot, 'images', 'preserved.png'),
          svg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect></svg>'
        })
        const exists = async (filePath: string): Promise<boolean> =>
          await fs
            .access(filePath)
            .then(() => true)
            .catch(() => false)

        return {
          scriptError,
          externalError,
          cssExternalError,
          cssImportError,
          oversizedError,
          outsideError,
          formatError,
          malformedError,
          preservedUnchanged: (await fs.readFile(preservedPath)).equals(preservedBytes),
          scriptExists: await exists(path.join(runtime.workspaceRoot, 'images', 'script.png')),
          externalExists: await exists(path.join(runtime.workspaceRoot, 'images', 'external.png')),
          cssExternalExists: await exists(
            path.join(runtime.workspaceRoot, 'images', 'css-external.png')
          ),
          cssImportExists: await exists(
            path.join(runtime.workspaceRoot, 'images', 'css-import.png')
          ),
          oversizedExists: await exists(
            path.join(runtime.workspaceRoot, 'images', 'oversized.png')
          ),
          outsideExists: await exists(outsidePath),
          recordCount: (await harness.ctx.listFileChangeRecords({ runId: runtime.runId })).length,
          artifactCount: runtime.eventCollector
            .snapshot()
            .filter((event) => event.type === 'file_artifact' && event.capability === 'image')
            .length
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.scriptError.includes('被禁止的元素') &&
            result.externalError.includes('外部资源') &&
            result.cssExternalError.includes('外部资源') &&
            result.cssImportError.includes('CSS @import') &&
            result.oversizedError.includes('尺寸过大') &&
            result.outsideError.length === 0 &&
            result.formatError.length > 0 &&
            result.malformedError.includes('SVG 内容无效') &&
            result.preservedUnchanged &&
            !result.scriptExists &&
            !result.externalExists &&
            !result.cssExternalExists &&
            !result.cssImportExists &&
            !result.oversizedExists &&
            result.outsideExists &&
            result.recordCount === 0 &&
            result.artifactCount === 0,
          {
            name: 'image-generate-rejects-unsafe-input',
            message: '危险和不支持的图片生成请求必须失败；工作区外路径可写入但不产生回退记录。',
            data: result
          }
        )
      }
    })
  })
})
