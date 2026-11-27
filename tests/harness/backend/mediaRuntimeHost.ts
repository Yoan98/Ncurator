import { measureMotionFrame, checkMotionVersions } from './mediaVisualChecks'
import { app, BrowserWindow, nativeImage } from 'electron'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { CdpEndpointService } from '../../../src/main/services/browser/CdpEndpointService'
import {
  configureDrawingHost,
  ElectronDrawingHost
} from '../../../src/main/services/media/engine/ElectronDrawingHost'
import { mediaBinaries, runMediaProcess } from '../../../src/main/services/media/MediaProcess'
import { createRealAiHarness } from './realAiHarness'
import { createAiServiceTestRunner } from './aiServiceHarness'
import { EventCollector } from '../core/eventCollector'
import { buildBrainSystemPrompt } from '../../../src/main/services/ai/human/prompts/brain'
import { DRAWING_SYSTEM_PREFIX } from '../../../src/main/services/ai/human/prompts/drawing'
import { createDrawing } from '../../../src/main/services/ai/human/tools/drawing/runtime'
import { sceneManifestSchema } from '../../../src/main/services/media/engine/protocol'
import {
  executeVideoEdit,
  loadVideoRecipe
} from '../../../src/main/services/media/video/VideoEditingService'
import { recipeDuration } from '../../../src/main/services/media/video/recipe'
import type { AiRunEvent, VideoFeedbackNode } from '../../../src/shared/types'
import { UserSkillService } from '../../../src/main/services/skills/UserSkillService'
import { extractSkillZip } from '../../../src/main/services/skills/OfficialSkillService'
import type { MediaScenarioResult } from './mediaRuntimeRunner'
import { loadLiveLlmConfigFromEnv } from './llmConfig'

const [scenario, directory, resultPath, runId] = process.argv.slice(-4)
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const main = async (): Promise<void> => {
  await app.whenReady()
  app.setPath('userData', path.join(directory, 'user-data'))
  const keepAlive = new BrowserWindow({ show: false })
  const endpoint = new CdpEndpointService()
  configureDrawingHost(endpoint)
  const collector = new EventCollector()
  const live = scenario.includes('live') ? loadLiveLlmConfigFromEnv() : undefined
  const harness = await createRealAiHarness({
    definition: { harnessMode: live ? 'live' : 'tool-real', runtimeModelName: live?.model_name },
    runId,
    taskId: runId,
    workspaceRoot: directory,
    fixtureBindings: [],
    eventCollector: collector,
    recordEvent: () => {}
  })
  const runtime = harness.runtime
  const checks: Record<string, boolean> = {}
  const outputs: string[] = []
  const diagnostics: string[] = []
  const events: AiRunEvent[] = []
  if (live) await runtime.seedLlmConfig(live)
  const partnerId = 'media-runtime-partner'
  await runtime.partnerStore.savePartner({
    id: partnerId,
    name: '视频制作',
    avatar_shape: 'circle',
    avatar_color: 'blue',
    created_at: Date.now(),
    updated_at: Date.now(),
    last_viewed_at: Date.now(),
    pinned: false,
    pinned_at: null
  })
  const ctx = runtime.createAiRunContext({ partnerId, runId })
  const engine = path.join(directory, 'out/main/drawingCli.js')
  const host = new ElectronDrawingHost()
  try {
    const binaries = mediaBinaries()
    if (scenario === 'drawing-engine-contract') {
      const source = path.join(directory, 'custom project', 'scene')
      await fs.mkdir(path.join(source, 'assets'), { recursive: true })
      await fs.copyFile(
        path.join(directory, 'out/main/scene-sans.otf'),
        path.join(source, 'assets/custom.otf')
      )
      const picture = createCanvas(10, 10)
      picture.getContext('2d').fillRect(0, 0, 10, 10)
      await fs.writeFile(path.join(source, 'assets/picture.png'), picture.toBuffer('image/png'))
      await fs.writeFile(
        path.join(source, 'scene.json'),
        JSON.stringify({
          entry: 'scene.mjs',
          canvas: { width: 320, height: 180, fps: 10 },
          durationSeconds: 1,
          resources: { font: 'assets/custom.otf', picture: 'assets/picture.png' },
          seed: 1
        })
      )
      await fs.writeFile(
        path.join(source, 'scene.mjs'),
        `let canvas,ctx,picture;export async function initialize({container,resources}){const face=await new FontFace('CustomSceneFont','url('+resources.font+')').load();document.fonts.add(face);picture=new Image();picture.src=resources.picture;await picture.decode();canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;container.append(canvas);ctx=canvas.getContext('2d')}export async function renderAt(t){ctx.clearRect(0,0,320,180);ctx.fillStyle='#2f5f8f';ctx.fillRect(20+t*200,50,40,40);ctx.drawImage(picture,10,10);ctx.font='20px CustomSceneFont';ctx.fillText('馆长',20,150)}export async function dispose(){canvas.remove()}`
      )
      const environment = { ...process.env, ...(await host.open()), ELECTRON_RUN_AS_NODE: '1' }
      const cli = async (args: string[], signal?: AbortSignal) => {
        const started = Date.now()
        try {
          return await runMediaProcess(process.execPath, [engine, ...args], signal, environment)
        } finally {
          diagnostics.push(`${args[0]} ${args.at(-1)}: ${Date.now() - started}ms`)
        }
      }
      const frames = path.join(directory, 'checks')
      const frameResult = JSON.parse(
        await cli([
          'frames',
          '--scene',
          path.join(source, 'scene.json'),
          '--times',
          '0.8,0,0.8',
          '--out',
          frames
        ])
      ) as { frames: { timeSeconds: number; path: string }[] }
      checks.framePaths =
        frameResult.frames.length === 3 &&
        frameResult.frames.every(
          (item, index) =>
            item.path === path.join(frames, `${index}-${item.timeSeconds.toFixed(3)}.png`)
        )
      checks.fontAndPicture = true
      const a = await fs.readFile(path.join(frames, '0-0.800.png')),
        b = await fs.readFile(path.join(frames, '1-0.000.png')),
        c = await fs.readFile(path.join(frames, '2-0.800.png'))
      checks.deterministic = hash(a) === hash(c)
      checks.motion = hash(a) !== hash(b)
      checks.outRequired = true
      for (const operation of ['frames', 'render']) {
        checks.outRequired &&= await cli([
          operation,
          '--scene',
          path.join(source, 'scene.json'),
          ...(operation === 'frames' ? ['--times', '0'] : ['--format', 'png'])
        ]).then(
          () => false,
          (error: Error) => error.message.includes('--out')
        )
      }
      checks.sceneFramesNoOverwrite = await cli([
        'frames',
        '--scene',
        path.join(source, 'scene.json'),
        '--times',
        '0.3,0',
        '--out',
        frames
      ]).then(
        () => false,
        (error: Error) => error.message.includes('Output already exists')
      )
      checks.sceneFramesNoOverwrite &&=
        hash(b) === hash(await fs.readFile(path.join(frames, '1-0.000.png'))) &&
        !(await fs.access(path.join(frames, '0-0.300.png')).then(
          () => true,
          () => false
        ))
      await cli([
        'frames',
        '--scene',
        path.join(source, 'scene.json'),
        '--times',
        '0.2',
        '--out',
        frames
      ])
      checks.existingOutputDirectory = (await fs.stat(path.join(frames, '0-0.200.png'))).isFile()
      for (const extension of ['png', 'jpg', 'webp', 'mp4', 'webm']) {
        const output = path.join(directory, `drawing.${extension}`)
        const rendered = JSON.parse(
          await cli([
            'render',
            '--scene',
            path.join(source, 'scene.json'),
            '--format',
            extension === 'jpg' ? 'jpeg' : extension,
            '--out',
            output
          ])
        ) as { scenePath: string; outputPath: string }
        checks[`result-${extension}`] =
          rendered.scenePath === path.join(source, 'scene.json') && rendered.outputPath === output
        outputs.push(output)
        checks[`encoded-${extension}`] = (await fs.stat(output)).size > 100
      }
      const mediaFrames = path.join(directory, 'media-checks')
      await cli([
        'frames',
        '--media',
        path.join(directory, 'drawing.mp4'),
        '--times',
        '0.5,0.9',
        '--out',
        mediaFrames
      ])
      const protectedFrame = path.join(mediaFrames, '1-0.900.png')
      const protectedHash = hash(await fs.readFile(protectedFrame))
      checks.mediaFramesNoOverwrite = await cli([
        'frames',
        '--media',
        path.join(directory, 'drawing.mp4'),
        '--times',
        '0.4,0.9',
        '--out',
        mediaFrames
      ]).then(
        () => false,
        (error: Error) => error.message.includes('Output already exists')
      )
      checks.mediaFramesNoOverwrite &&=
        protectedHash === hash(await fs.readFile(protectedFrame)) &&
        !(await fs.access(path.join(mediaFrames, '0-0.400.png')).then(
          () => true,
          () => false
        ))
      const alpha = path.join(directory, 'alpha.png')
      await runMediaProcess(binaries.ffmpeg, [
        '-v',
        'error',
        '-c:v',
        'libvpx-vp9',
        '-i',
        path.join(directory, 'drawing.webm'),
        '-frames:v',
        '1',
        '-y',
        alpha
      ])
      const bitmap = nativeImage.createFromPath(alpha).toBitmap()
      checks.alpha = bitmap[3] === 0
      const before = hash(await fs.readFile(outputs[0]))
      await cli([
        'render',
        '--scene',
        path.join(source, 'scene.json'),
        '--format',
        'png',
        '--out',
        outputs[0]
      ]).then(
        () => {
          checks.noOverwrite = false
        },
        () => {
          checks.noOverwrite = true
        }
      )
      checks.noOverwrite &&= before === hash(await fs.readFile(outputs[0]))
      const system = buildBrainSystemPrompt({ ctx: { ...ctx, agentProfile: 'drawing' } })
      checks.systemPrefix =
        system.startsWith(DRAWING_SYSTEM_PREFIX) && system.split(DRAWING_SYSTEM_PREFIX).length === 2
      const manifest = JSON.parse(await fs.readFile(path.join(source, 'scene.json'), 'utf8'))
      manifest.durationSeconds = 30
      await fs.writeFile(path.join(source, 'scene.json'), JSON.stringify(manifest))
      const controller = new AbortController()
      const rendering = cli(
        [
          'render',
          '--scene',
          path.join(source, 'scene.json'),
          '--format',
          'mp4',
          '--out',
          path.join(directory, 'cancelled.mp4')
        ],
        controller.signal
      ).then(
        () => {
          checks.cancelled = false
        },
        () => {
          checks.cancelled = true
        }
      )
      for (let attempt = 0; attempt < 150; attempt++) {
        const partial = (await fs.readdir(directory)).find(
          (name) => name.startsWith('.') && name.endsWith('.part.mp4')
        )
        if (partial && (await fs.stat(path.join(directory, partial))).size > 0) {
          checks.cancelAfterEncodingStarted = true
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      controller.abort()
      await rendering
      host.close()
      await new Promise((resolve) => setTimeout(resolve, 150))
      checks.hostReleased = BrowserWindow.getAllWindows().length === 1
      checks.cancelled &&= !(await fs.access(path.join(directory, 'cancelled.mp4')).then(
        () => true,
        () => false
      ))

      manifest.durationSeconds = 1
      await fs.writeFile(path.join(source, 'scene.json'), JSON.stringify(manifest))
      const chosenOutput = path.join(directory, 'custom project', 'delivered.png')
      const taskResult = `成品（供预览、剪辑）：${chosenOutput}；场景入口（供继续编辑）：${path.join(source, 'scene.json')}`
      const drawn = await createDrawing(
        {
          ...ctx,
          delegateToSubagent: async (assignments, _id, internal) => {
            checks.taskInput =
              assignments[0].instruction.includes('输出格式：png') &&
              assignments[0].instruction.includes('供预览、剪辑') &&
              !assignments[0].instruction.includes('引擎启动命令')
            checks.oneDrawingPage = BrowserWindow.getAllWindows().length === 2
            const quote = (value: string) =>
              `'${value.replaceAll("'", process.platform === 'win32' ? "''" : "'\\''")}'`
            const command = `ncurator-drawing render --scene ${quote(path.join(source, 'scene.json'))} --format png --out ${quote(chosenOutput)}`
            await runMediaProcess(
              process.platform === 'win32' ? 'powershell.exe' : '/bin/sh',
              process.platform === 'win32' ? ['-NoProfile', '-Command', command] : ['-c', command],
              undefined,
              { ...process.env, ...internal?.environment }
            )
            return [
              {
                agentId: 'drawing-child',
                toolCallId: _id,
                childRunId: 'drawing-contract-child',
                name: '绘画',
                task: assignments[0].instruction,
                status: 'completed',
                result: taskResult
              }
            ]
          }
        },
        { prompt: '在已有场景中继续绘制，保留场景与素材。', format: 'png' },
        'drawing-contract'
      )
      checks.resultDelivery = drawn.result === taskResult
      checks.artifact = (await ctx.listFileChangeRecords()).some(
        (record) => record.path === chosenOutput && !!record.afterSnapshotPath
      )
      const assets = path.join(directory, 'user-data', 'partners', partnerId, 'runtime', 'assets')
      checks.noDrawingProject =
        !(await fs.readdir(assets).catch(() => [])).some((name) => name.startsWith('drawing-')) &&
        !(await fs.access(path.join(directory, 'custom project', '.ncurator-media')).then(
          () => true,
          () => false
        ))
      checks.sourceRetained = (await fs.stat(path.join(source, 'scene.mjs'))).size > 0
      checks.wrapperReleased = BrowserWindow.getAllWindows().length === 1
      outputs.push(chosenOutput, path.join(source, 'scene.json'))
    } else if (scenario === 'video-editing-contract') {
      const a = path.join(directory, 'source-a.mp4'),
        b = path.join(directory, 'source-b.mp4')
      const original = hash(await fs.readFile(a))
      const compose = await executeVideoEdit(ctx, 'clip', {
        operation: 'compose',
        clips: [
          { path: a, sourceRange: { startSeconds: 0.5, endSeconds: 2.5 } },
          { path: b, sourceRange: { startSeconds: 0, endSeconds: 1.5 } }
        ],
        outputPath: path.join(directory, 'compose.mp4')
      })
      const caption = await executeVideoEdit(ctx, 'visual', {
        operation: 'captions',
        action: 'add',
        inputPath: compose.editPath,
        style: { fontSize: 20, box: { x: 0.1, y: 0.7, width: 0.8, height: 0.2 } },
        entries: [
          { text: '出发', range: { startSeconds: 0, endSeconds: 2 } },
          { text: '到达', range: { startSeconds: 2, endSeconds: 3.5 } }
        ],
        outputPath: path.join(directory, 'caption.mp4')
      })
      const speed = await executeVideoEdit(ctx, 'clip', {
        operation: 'speed',
        inputPath: caption.editPath,
        startSeconds: 0,
        endSeconds: 2,
        rate: 2,
        outputPath: path.join(directory, 'speed.mp4')
      })
      const recipe = await loadVideoRecipe(speed.editPath)
      checks.duration = Math.abs(recipeDuration(recipe) - 2.5) < 0.001
      checks.captions =
        recipe.captions[0].range.endSeconds === 1 && recipe.captions[1].range.startSeconds === 1
      const audio = await executeVideoEdit(ctx, 'audio', {
        action: 'add',
        inputPath: speed.editPath,
        path: b,
        range: { startSeconds: 0, endSeconds: 2.5 },
        gainDb: -16,
        fadeInSeconds: 0.1,
        fadeOutSeconds: 0.1,
        envelope: [
          { atSeconds: 0, gainDb: -4 },
          { atSeconds: 2.5, gainDb: 0 }
        ],
        outputPath: path.join(directory, 'audio.mp4')
      })
      const final = path.join(directory, 'final.mp4')
      const exported = await executeVideoEdit(ctx, 'export', {
        inputPath: audio.editPath,
        outputPath: final,
        quality: 'final',
        size: { width: 320, height: 180 },
        fps: '10'
      })
      const beforeReplacement = await loadVideoRecipe(audio.editPath)
      const replacement = await executeVideoEdit(ctx, 'clip', {
        operation: 'replace',
        inputPath: audio.editPath,
        clipId: beforeReplacement.clips[0].id,
        path: b,
        outputPath: path.join(directory, 'replaced.mp4')
      })
      const replaced = await loadVideoRecipe(replacement.editPath)
      checks.replacePreservesEdit =
        replaced.clips[0].path === b &&
        JSON.stringify({ ...replaced.clips[0], path: a, still: undefined }) ===
          JSON.stringify({ ...beforeReplacement.clips[0], still: undefined }) &&
        JSON.stringify(replaced.captions) === JSON.stringify(beforeReplacement.captions) &&
        JSON.stringify(replaced.audio) === JSON.stringify(beforeReplacement.audio)
      const recolored = await executeVideoEdit(ctx, 'visual', {
        operation: 'captions',
        action: 'update',
        inputPath: caption.editPath,
        edits: [{ id: caption.createdIds![0], style: { color: '#ff8800' } }],
        outputPath: path.join(directory, 'recolored.mp4')
      })
      checks.captionStyleMerge =
        (await loadVideoRecipe(recolored.editPath)).captions[0].style?.color === '#ff8800' &&
        (await loadVideoRecipe(recolored.editPath)).captions[0].style?.fontSize === 20
      const copied = path.join(directory, 'copied-preview.mp4')
      await fs.copyFile(path.join(directory, 'speed.mp4'), copied)
      checks.copiedSource = (await loadVideoRecipe(copied)).clips[0].path === a
      const frozen = await executeVideoEdit(ctx, 'clip', {
        operation: 'freeze',
        inputPath: speed.editPath,
        atSeconds: 0.5,
        durationSeconds: 0.3,
        outputPath: path.join(directory, 'frozen.mp4')
      })
      const repeated = await executeVideoEdit(ctx, 'clip', {
        operation: 'repeat',
        inputPath: frozen.editPath,
        startSeconds: 0,
        endSeconds: 0.5,
        outputPath: path.join(directory, 'repeated.mp4')
      })
      checks.freezeAndRepeat =
        Math.abs(recipeDuration(await loadVideoRecipe(repeated.editPath)) - 3.3) < 0.001
      const cut = await executeVideoEdit(ctx, 'clip', {
        operation: 'cut',
        inputPath: repeated.editPath,
        mode: 'keep',
        ranges: [
          { startSeconds: 0, endSeconds: 0.3 },
          { startSeconds: 1, endSeconds: 2 }
        ],
        outputPath: path.join(directory, 'cut.mp4')
      })
      checks.cut = Math.abs(recipeDuration(await loadVideoRecipe(cut.editPath)) - 1.3) < 0.001
      const overlay = await executeVideoEdit(ctx, 'visual', {
        operation: 'overlay',
        action: 'add',
        inputPath: compose.editPath,
        range: { startSeconds: 0, endSeconds: 1 },
        content: { kind: 'text', text: '叠加', style: { fontSize: 18 } },
        box: { x: 0.1, y: 0.1, width: 0.5, height: 0.2 },
        outputPath: path.join(directory, 'overlay.mp4')
      })
      const layout = await executeVideoEdit(ctx, 'visual', {
        operation: 'layout',
        inputPath: overlay.editPath,
        range: { startSeconds: 0, endSeconds: 1 },
        crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
        placement: { x: 0, y: 0, width: 1, height: 1 },
        outputPath: path.join(directory, 'layout.mp4')
      })
      const transition = await executeVideoEdit(ctx, 'visual', {
        operation: 'transition',
        inputPath: layout.editPath,
        atSeconds: 2,
        type: 'fade',
        durationSeconds: 0.4,
        outputPath: path.join(directory, 'transition.mp4')
      })
      const linked = await executeVideoEdit(ctx, 'audio', {
        action: 'update',
        inputPath: audio.editPath,
        id: audio.createdIds![0],
        changes: { binding: 'content' },
        outputPath: path.join(directory, 'linked.mp4')
      })
      const linkedSpeed = await executeVideoEdit(ctx, 'clip', {
        operation: 'speed',
        inputPath: linked.editPath,
        startSeconds: 0,
        endSeconds: 1,
        rate: 2,
        outputPath: path.join(directory, 'linked-speed.mp4')
      })
      checks.audioAutomation =
        (await loadVideoRecipe(linkedSpeed.editPath)).audio[0].automation?.fade?.rate === 2
      checks.advancedScene = (await loadVideoRecipe(transition.editPath)).overlays.length === 1
      outputs.push(final, exported.editPath)
      checks.sourcePreserved = original === hash(await fs.readFile(a))
      const record = (
        await runtime.storageService.aiFileChange.listRecords({ partnerId, runId })
      ).items.find((record) => record.path === final)
      checks.snapshotSource =
        !!record?.afterSnapshotPath &&
        (await loadVideoRecipe(record.afterSnapshotPath)).clips[0].path === a
      checks.sourceBacked = (await loadVideoRecipe(exported.editPath)).clips.every((clip) =>
        [a, b].includes(clip.path)
      )
      const info = JSON.parse(
        await runMediaProcess(binaries.ffprobe, [
          '-v',
          'error',
          '-show_entries',
          'stream=codec_type,width,height:format=duration',
          '-of',
          'json',
          final
        ])
      ) as {
        streams: { codec_type: string; width?: number; height?: number }[]
        format: { duration: string }
      }
      checks.realEncoding =
        info.streams.some((s) => s.codec_type === 'audio') &&
        info.streams.some((s) => s.width === 320 && s.height === 180) &&
        Math.abs(Number(info.format.duration) - 2.5) < 0.12
    } else {
      const skills = new UserSkillService(
        runtime.storageService.partnerSkills,
        path.join(directory, 'skills')
      )
      if (scenario === 'human-video-edit-live') {
        const packagePath = process.env.AI_VIDEO_SKILL_PACKAGE,
          expected = process.env.AI_VIDEO_SKILL_SHA256
        if (!packagePath || !expected)
          throw new Error(
            'AI_VIDEO_SKILL_PACKAGE and AI_VIDEO_SKILL_SHA256 must identify an independently built official Skill package'
          )
        const bytes = await fs.readFile(packagePath)
        if (hash(bytes) !== expected) throw new Error('Pinned Skill package checksum mismatch')
        const stage = path.join(directory, 'skill-import')
        await fs.mkdir(stage)
        await extractSkillZip(bytes, stage)
        const preview = skills.prepareImport(stage)
        skills.commitImport({ ...preview, replaceName: null })
        skills.setEnabled(partnerId, [preview.name])
      }
      const rounds: ReturnType<typeof createAiServiceTestRunner>[] = []
      const run = async (input: string, nodes?: VideoFeedbackNode[], abortSignal?: AbortSignal) => {
        const runner = await createAiServiceTestRunner(runtime, {
          partnerId,
          runId: `${runId}-${rounds.length}`,
          userInput: input,
          userSkillService: skills,
          contentNodes: nodes,
          abortSignal,
          observeEvent: (event) => events.push(event)
        })
        rounds.push(Promise.resolve(runner))
        const result = await runner.run()
        diagnostics.push(result.status)
        await fs.writeFile(
          path.join(directory, `round-${rounds.length}-io.json`),
          JSON.stringify(runner.io, null, 2)
        )
        if (result.status !== 'completed' && !abortSignal?.aborted)
          throw new Error(`Media task round ${rounds.length} did not complete: ${result.status}`)
        return result
      }
      const first = path.join(directory, 'preview-v1.mp4'),
        second = path.join(directory, 'preview-v2.mp4'),
        final = path.join(directory, 'final.mp4')
      const sourceA = path.join(directory, 'source-a.mp4'),
        sourceB = path.join(directory, 'source-b.mp4')
      const before =
        scenario === 'human-video-edit-live' ? hash(await fs.readFile(sourceA)) : undefined
      if (scenario === 'human-video-edit-live')
        await run(
          `请把这两段彩色测试素材剪成小样：${sourceA} 取第0.5到2.5秒，加速到2倍，接上 ${sourceB} 的第0到1.5秒。保留原声，在两段分别加字幕“出发”和“到达”，各覆盖自己的整段。画面320×180，10帧每秒。不用讨论创意，照此执行，小样保存到 ${first}，保留可编辑内容。`
        )
      else
        await run(
          `请制作一段2秒、320×180、10帧每秒的简洁动画：白色背景，一个蓝色圆球从左边平滑移动到右边，结尾停住；黑色文字“出发”固定在顶部。保存到 ${first}，并保留可编辑来源。`
        )
      await fs.access(first)
      const environment = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
      const checksDir = path.join(directory, 'feedback-checks')
      await runMediaProcess(
        process.execPath,
        [engine, 'frames', '--media', first, '--times', '0.5', '--out', checksDir],
        undefined,
        environment
      )
      const screenshot = path.join(checksDir, '0-0.500.png'),
        screenshotBytes = await fs.readFile(screenshot)
      const node: VideoFeedbackNode = {
        kind: 'video_feedback',
        id: randomUUID(),
        filePath: first,
        version: hash(await fs.readFile(first)),
        timeSeconds: 0.5,
        screenshotPath: screenshot,
        screenshotSize: { width: 320, height: 180, sizeBytes: screenshotBytes.length },
        frameText:
          scenario === 'human-video-edit-live'
            ? '把第一段字幕改成橙色，其他字幕、剪法和声音保持。'
            : '把圆球改成橙色，其他位置、动作、时长和顶部文字保持。',
        annotations: []
      }
      await run(`按引用画面的意见修改 ${first}，保存新版本到 ${second}，不要覆盖旧版。`, [node])
      checks.versions = await fs.access(second).then(
        () => true,
        () => false
      )
      await run(
        `这个版本可以，采用 ${second}。${scenario === 'human-video-animation-live' ? `先完整播放这段2秒动画，再接素材 ${sourceB} 的前1秒，顺序为动画在前、素材在后。保留动画与原素材的可编辑内容，再正式导出` : '请正式导出'}到 ${final}，尺寸320×180、10帧每秒。`
      )
      await fs.access(final)
      outputs.push(first, second, final)
      checks.tools = events.some(
        (event) =>
          event.type === 'tool_call_started' &&
          event.toolName === (scenario === 'human-video-edit-live' ? 'video_clip_edit' : 'drawing')
      )
      checks.noSkill =
        scenario !== 'human-video-animation-live' ||
        (skills.list().length === 0 &&
          !events.some(
            (event) =>
              event.type === 'tool_call_result' &&
              event.toolName === 'load_skill' &&
              event.result?.ok
          ))
      const finalRecipe = await loadVideoRecipe(final)
      checks.sources = !!finalRecipe.clips.length
      if (scenario === 'human-video-animation-live') {
        checks.adoptedOrder =
          finalRecipe.clips[0]?.path === second &&
          finalRecipe.clips.at(-1)?.path === sourceB &&
          Math.abs(recipeDuration(finalRecipe) - 3) < 0.12
        const samples = []
        for (const [name, file] of [
          ['before', first],
          ['after', second]
        ] as const) {
          const folder = path.join(directory, `visual-${name}`)
          await runMediaProcess(
            process.execPath,
            [engine, 'frames', '--media', file, '--times', '0,0.1,0.5,1,1.5,1.9', '--out', folder],
            undefined,
            environment
          )
          const frames = []
          for (const entry of (await fs.readdir(folder)).sort()) {
            const image = await loadImage(await fs.readFile(path.join(folder, entry))),
              canvas = createCanvas(320, 180),
              context = canvas.getContext('2d')
            context.drawImage(image, 0, 0, 320, 180)
            const pixels = context.getImageData(0, 0, 320, 180).data
            frames.push(measureMotionFrame(pixels, 320, 180, name === 'before' ? 'blue' : 'orange'))
          }
          samples.push(frames)
        }
        Object.assign(checks, checkMotionVersions(samples[0], samples[1]))
        checks.oldVersionPreserved = hash(await fs.readFile(first)) === node.version
        const controller = new AbortController(),
          cancelledOutput = path.join(directory, 'star-motion.mp4'),
          cancelledProject = path.join(directory, 'star-project')
        let finished = false
        const cancelling = run(
          `再创作一段全新30秒动画，不能沿用上一段素材：白底，一颗红色五角星沿正弦曲线从左向右移动，镜头固定，320×180，10帧每秒，保存到 ${cancelledOutput}，可编辑源稿放在 ${cancelledProject}。`,
          undefined,
          controller.signal
        )
          .then(
            () => undefined,
            (error: Error) => error
          )
          .finally(() => {
            finished = true
          })
        let stopReady = false
        let cancellationError: Error | undefined
        let sourceFiles: string[] = []
        const findScenes = async (root: string): Promise<string[]> => {
          const found: string[] = []
          for (const entry of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
            const file = path.join(root, entry.name)
            if (entry.isDirectory()) found.push(...(await findScenes(file)))
            else if (entry.name === 'scene.json') found.push(file)
          }
          return found
        }
        try {
          for (let attempt = 0; attempt < 6000 && !finished; attempt++) {
            for (const file of await findScenes(cancelledProject)) {
              const manifest = await fs
                .readFile(file, 'utf8')
                .then((text) => sceneManifestSchema.parse(JSON.parse(text)))
                .catch(() => undefined)
              if (
                manifest &&
                (
                  await fs
                    .stat(path.join(path.dirname(file), manifest.entry))
                    .catch(() => undefined)
                )?.size
              ) {
                sourceFiles = [file, path.join(path.dirname(file), manifest.entry)]
                stopReady = true
                break
              }
            }
            if (stopReady) break
            await new Promise((resolve) => setTimeout(resolve, 100))
          }
        } finally {
          controller.abort()
          cancellationError = await cancelling
        }
        if (cancellationError) throw cancellationError
        checks.liveStop =
          stopReady &&
          (
            await Promise.all(
              sourceFiles.map((file) =>
                fs.access(file).then(
                  () => true,
                  () => false
                )
              )
            )
          ).every(Boolean) &&
          !(await fs.access(cancelledOutput).then(
            () => true,
            () => false
          )) &&
          BrowserWindow.getAllWindows().length === 1
      }
      if (scenario === 'human-video-edit-live') {
        checks.timeMap =
          Math.abs(recipeDuration(finalRecipe) - 2.5) < 0.12 &&
          finalRecipe.clips.some(
            (clip) => Math.abs(clip.sourceStart - 0.5) < 0.01 && Math.abs(clip.rate - 2) < 0.01
          )
        checks.captionSync =
          finalRecipe.captions.some(
            (cue) => cue.text === '出发' && Math.abs(cue.range.endSeconds - 1) < 0.12
          ) &&
          finalRecipe.captions.some(
            (cue) => cue.text === '到达' && Math.abs(cue.range.startSeconds - 1) < 0.12
          )
        checks.originalAudio = finalRecipe.clips.every((clip) => clip.includeAudio)
      }
      if (before) checks.sourcePreserved = before === hash(await fs.readFile(sourceA))
      const messages = await runtime.storageService.chatMessageLog.list(partnerId)
      await fs.writeFile(path.join(directory, 'messages.json'), JSON.stringify(messages, null, 2))
      diagnostics.push('视觉及听感需单独复核，技术断言不代替质量结论')
    }
    await fs.writeFile(
      resultPath,
      JSON.stringify(
        { checks, events, outputs, diagnostics } satisfies MediaScenarioResult,
        null,
        2
      )
    )
  } finally {
    host.close()
    await endpoint.dispose()
    await harness.dispose()
    keepAlive.destroy()
  }
}
void main()
  .then(() => app.quit())
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
