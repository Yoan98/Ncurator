import { buildDrawingTaskInput } from '../../prompts/drawing'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type { AiRunContext } from '../../../types'
import { ElectronDrawingHost } from '../../../../media/engine/ElectronDrawingHost'
import { mediaBinaries, runMediaProcess } from '../../../../media/MediaProcess'
import { acquireMediaRender } from '../../../../media/RenderQueue'
import {
  getFileChangeDirectory,
  saveFileChangeSnapshot
} from '../../../fileChanges/FileChangeSnapshots'
import type { DrawingRenderResult } from '../../../../media/engine/protocol'
import type { DrawingInput } from './toolSchemas'

// Reuse one launcher per application runtime.
const commandEnvironment = async (): Promise<Record<string, string>> => {
  const bin = path.join(app.getPath('userData'), 'runtime', 'bin')
  await fs.mkdir(bin, { recursive: true })
  const launcher = path.join(
    bin,
    process.platform === 'win32' ? 'ncurator-drawing.cmd' : 'ncurator-drawing'
  )
  const script =
    process.platform === 'win32'
      ? '@echo off\r\n"%NCURATOR_NODE%" "%NCURATOR_DRAWING_CLI%" %*\r\n'
      : '#!/bin/sh\nexec "$NCURATOR_NODE" "$NCURATOR_DRAWING_CLI" "$@"\n'
  if ((await fs.readFile(launcher, 'utf8').catch(() => '')) !== script)
    await fs.writeFile(launcher, script, { mode: 0o755 })
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') || 'PATH'
  return {
    [pathKey]: bin + path.delimiter + (process.env[pathKey] || ''),
    NCURATOR_NODE: process.execPath,
    NCURATOR_DRAWING_CLI: path.join(app.getAppPath(), 'out', 'main', 'drawingCli.js'),
    ELECTRON_RUN_AS_NODE: '1'
  }
}

const registerRenderedFile = async (
  ctx: AiRunContext,
  rendered: DrawingRenderResult
): Promise<void> => {
  if (!path.isAbsolute(rendered.outputPath) || !path.isAbsolute(rendered.scenePath))
    throw new Error('Drawing result paths must be absolute')
  await fs.access(rendered.scenePath)
  const info = JSON.parse(
    await runMediaProcess(
      mediaBinaries().ffprobe,
      [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_type,width,height',
        '-of',
        'json',
        rendered.outputPath
      ],
      ctx.abortSignal
    )
  ) as { streams?: { codec_type: string; width?: number; height?: number }[] }
  if (
    !info.streams?.some((stream) => stream.codec_type === 'video' && stream.width && stream.height)
  )
    throw new Error('生成结果无法解码')
  const bytes = await fs.readFile(rendered.outputPath)
  ctx.checkCancelled()
  const id = randomUUID()
  const snapshot = await saveFileChangeSnapshot(
    getFileChangeDirectory(ctx.partnerId, ctx.ownerRunId, id),
    `after${path.extname(rendered.outputPath)}`,
    bytes
  )
  const capability = /\.(mp4|webm)$/iu.test(rendered.outputPath) ? 'video' : 'image'
  const now = Date.now()
  await ctx.saveFileChangeRecord({
    id,
    partnerId: ctx.partnerId,
    runId: ctx.ownerRunId,
    status: 'applied',
    capability,
    path: rendered.outputPath,
    fileName: path.basename(rendered.outputPath),
    operation: 'created',
    source: `${capability}_tool`,
    afterPath: rendered.outputPath,
    afterSnapshotPath: snapshot.snapshotPath,
    afterObjectHash: snapshot.hash,
    afterChecksum: snapshot.hash,
    changeCount: 1,
    insertCount: 0,
    deleteCount: 0,
    createdAt: now,
    updatedAt: now
  })
}

export const createDrawing = async (
  ctx: AiRunContext,
  args: DrawingInput,
  toolCallId: string
): Promise<{ result: string }> => {
  const release = await acquireMediaRender(ctx.abortSignal)
  const host = new ElectronDrawingHost()
  let rendered: DrawingRenderResult | undefined
  try {
    ctx.checkCancelled()
    const environment = {
      ...(await commandEnvironment()),
      ...(await host.open((result) => {
        rendered = result
      }))
    }
    const children = await ctx.delegateToSubagent(
      [{ name: '绘画', instruction: buildDrawingTaskInput(args) }],
      toolCallId,
      { profile: 'drawing', environment }
    )
    ctx.checkCancelled()
    const child = children[0]
    if (child?.status !== 'completed') throw new Error(child?.result || '绘画子任务没有完成')
    if (!rendered)
      throw new Error(['绘画子任务未生成成品', child.result].filter(Boolean).join('\n'))
    const extension = path.extname(rendered.outputPath).slice(1).toLowerCase()
    if (extension !== args.format && !(args.format === 'jpeg' && extension === 'jpg'))
      throw new Error(`成品格式与要求的 ${args.format} 不一致：${rendered.outputPath}`)
    await registerRenderedFile(ctx, rendered)
    return { result: child.result || '' }
  } finally {
    host.close()
    release()
  }
}
