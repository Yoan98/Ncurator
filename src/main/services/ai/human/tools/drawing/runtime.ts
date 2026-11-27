import { randomUUID, createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod/v4'
import { app } from 'electron'
import type { AiRunContext } from '../../../types'
import { getPartnerAssetsRootDir } from '../../../../assets/WorkspaceAssetService'
import { ElectronDrawingHost } from '../../../../media/engine/ElectronDrawingHost'
import { mediaBinaries, runMediaProcess, hashMediaFile } from '../../../../media/MediaProcess'
import { resolveSafeTextFilePath } from '../textFile/textFileUtils'
import type { DrawingInput } from './toolSchemas'
import { acquireMediaRender } from '../../../../media/RenderQueue'
import { readMediaOrigin } from '../../../../media/MediaOrigin'
import { sceneManifestSchema } from '../../../../media/engine/protocol'

const originSchema = z.object({
  outputPath: z.string(),
  sourcePath: z.string(),
  sha256: z.string()
})

export const findDrawingSource = async (reference: string): Promise<string | undefined> => {
  if (
    path.basename(reference) === 'scene.json' &&
    (reference.includes(`${path.sep}.ncurator-media${path.sep}`) ||
      path.basename(path.dirname(path.dirname(reference))).startsWith('drawing-'))
  )
    return reference
  const hash = await hashMediaFile(reference)
  const direct = await readMediaOrigin(reference)
  if (direct?.outputPath === reference && direct.sha256 === hash && direct.sourcePath)
    return direct.sourcePath
  const root = path.join(path.dirname(reference), '.ncurator-media')
  for (const entry of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue
    const origin = await fs
      .readFile(path.join(root, entry.name, 'origin.json'), 'utf8')
      .then((text) => originSchema.safeParse(JSON.parse(text)).data)
      .catch(() => undefined)
    if (origin && origin.sha256 === hash) return origin.sourcePath
  }
  return undefined
}

export const createDrawing = async (
  ctx: AiRunContext,
  args: DrawingInput,
  toolCallId: string
): Promise<{ sourcePath: string }> => {
  const release = await acquireMediaRender(ctx.abortSignal)
  try {
    ctx.checkCancelled()
    return await executeDrawing(ctx, args, toolCallId)
  } finally {
    release()
  }
}

const executeDrawing = async (
  ctx: AiRunContext,
  args: DrawingInput,
  toolCallId: string
): Promise<{ sourcePath: string }> => {
  if (!path.isAbsolute(args.outputPath) || args.references?.some((file) => !path.isAbsolute(file)))
    throw new Error('Media paths must be absolute')
  const output = await resolveSafeTextFilePath({ sourcePath: args.outputPath, allowMissing: true })
  if (
    await fs.access(output).then(
      () => true,
      () => false
    )
  )
    throw new Error('目标文件已经存在，请使用新版本路径')
  for (const reference of args.references || []) await fs.access(reference)
  const assetId = randomUUID()
  const taskRoot = path.join(getPartnerAssetsRootDir(ctx.partnerId), `drawing-${assetId}`)
  const source = path.join(taskRoot, 'source')
  const checks = path.join(taskRoot, 'checks')
  const temporaryOutput = path.join(taskRoot, `output.part${path.extname(output)}`)
  const saved = path.join(path.dirname(output), '.ncurator-media', assetId)
  const sourcePath = path.join(saved, 'source', 'scene.json')
  await fs.mkdir(source, { recursive: true })
  await fs.mkdir(checks, { recursive: true })
  const host = new ElectronDrawingHost()
  let sourcePublished = false
  try {
    const originals = (await Promise.all((args.references || []).map(findDrawingSource))).filter(
      (value): value is string => Boolean(value)
    )
    if (originals[0])
      await fs.cp(path.dirname(originals[0]), source, { recursive: true, force: false })
    const environment = { ...(await host.open()), ELECTRON_RUN_AS_NODE: '1' }
    const cli = path.join(app.getAppPath(), 'out', 'main', 'drawingCli.js')
    const quote = (value: string): string =>
      `'${value.replaceAll("'", ctx.platform === 'windows' ? "''" : "'\\''")}'`
    const command =
      ctx.platform === 'windows'
        ? `& ${quote(process.execPath)} ${quote(cli)}`
        : `${quote(process.execPath)} ${quote(cli)}`
    const instruction = [
      args.prompt,
      `参考素材：${JSON.stringify(args.references || [])}`,
      `参考作品来源：${JSON.stringify(originals)}`,
      `本次源码工作目录：${source}`,
      `检查帧目录：${checks}`,
      `本次成品输出：${temporaryOutput}`,
      `引擎启动命令：${command}`,
      '目录和运行环境已经准备好。只在本次源码目录修改作品；必要素材复制到 assets。先检查实际画面，再使用引擎生成指定成品；不要自行发布到用户成品路径。'
    ].join('\n\n')
    await fs.writeFile(
      path.join(taskRoot, 'task.json'),
      JSON.stringify({ assetId, outputPath: output, source, checks, status: 'running' }, null, 2)
    )
    const children = await ctx.delegateToSubagent([{ name: '绘画', instruction }], toolCallId, {
      profile: 'drawing',
      environment
    })
    ctx.checkCancelled()
    if (children[0]?.status !== 'completed')
      throw new Error(children[0]?.result || '绘画子任务没有完成')
    await fs.access(path.join(source, 'scene.json'))
    const probe = JSON.parse(
      await runMediaProcess(
        mediaBinaries().ffprobe,
        [
          '-v',
          'error',
          '-show_entries',
          'stream=codec_type,width,height:format=duration',
          '-of',
          'json',
          temporaryOutput
        ],
        ctx.abortSignal
      )
    ) as { streams?: { codec_type: string; width?: number; height?: number }[] }
    if (
      !probe.streams?.some(
        (stream) => stream.codec_type === 'video' && stream.width && stream.height
      )
    )
      throw new Error('生成结果无法解码')
    await retainSceneResources(source)
    const outputBytes = await fs.readFile(temporaryOutput)
    await fs.mkdir(saved, { recursive: true })
    await fs.cp(source, path.join(saved, 'source'), {
      recursive: true,
      errorOnExist: true,
      force: false
    })
    await fs.writeFile(
      path.join(saved, 'origin.json'),
      JSON.stringify(
        {
          version: 1,
          assetId,
          outputPath: output,
          sourcePath,
          sha256: createHash('sha256').update(outputBytes).digest('hex'),
          references: args.references || []
        },
        null,
        2
      ),
      { flag: 'wx' }
    )
    sourcePublished = true
    ctx.checkCancelled()
    await ctx.writeFileChange({
      sourcePath: output,
      buffer: outputBytes,
      capability: /\.(mp4|webm)$/iu.test(output) ? 'video' : 'image',
      created: true,
      mediaOrigin: { sourcePath }
    })
    await fs.rm(taskRoot, { recursive: true, force: true }).catch(() => {})
    return { sourcePath }
  } catch (error) {
    if (sourcePublished) await fs.rm(saved, { recursive: true, force: true })
    await fs.writeFile(
      path.join(taskRoot, 'task.json'),
      JSON.stringify(
        {
          assetId,
          outputPath: output,
          source,
          checks,
          status: ctx.abortSignal?.aborted ? 'cancelled' : 'failed',
          error: error instanceof Error ? error.message : String(error)
        },
        null,
        2
      )
    )
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n源码与诊断：${taskRoot}`
    )
  } finally {
    host.close()
  }
}

/** Scene resources must survive cleanup and copying a prior version into a new task. */
const retainSceneResources = async (source: string): Promise<void> => {
  const manifestPath = path.join(source, 'scene.json')
  const manifest = sceneManifestSchema.parse(JSON.parse(await fs.readFile(manifestPath, 'utf8')))
  const root = await fs.realpath(source)
  for (const [key, resource] of Object.entries(manifest.resources)) {
    const file = await fs.realpath(path.resolve(root, resource))
    if (!(await fs.stat(file)).isFile()) throw new Error('Scene resource must be a regular file')
    if (file.startsWith(root + path.sep))
      manifest.resources[key] = path.relative(root, file).split(path.sep).join('/')
    else {
      const name = createHash('sha256').update(key).digest('hex').slice(0, 16) + path.extname(file)
      const target = path.join(root, 'assets', 'retained', name)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.copyFile(file, target)
      manifest.resources[key] = path.relative(root, target).split(path.sep).join('/')
    }
  }
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2))
}
