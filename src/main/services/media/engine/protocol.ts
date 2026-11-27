import { z } from 'zod/v4'

export const sceneManifestSchema = z
  .object({
    entry: z.string().min(1).default('scene.mjs'),
    canvas: z
      .object({
        width: z.number().int().min(2).max(8192),
        height: z.number().int().min(2).max(8192),
        fps: z.number().positive().max(120).default(30)
      })
      .strict(),
    durationSeconds: z.number().positive(),
    resources: z.record(z.string(), z.string()).default({}),
    seed: z.number().int().default(1)
  })
  .strict()
  .refine((value) => value.canvas.width * value.canvas.height <= 33_554_432, {
    message: 'Scene canvas exceeds 33554432 pixels'
  })

export type SceneManifest = z.infer<typeof sceneManifestSchema>

export const DRAWING_ENGINE_PROTOCOL = `内置绘画引擎（版本 1）：
- 在指定 source 目录维护 scene.json、scene.mjs 和 assets/；不需要安装依赖。
- scene.json：{"entry":"scene.mjs","canvas":{"width":1280,"height":720,"fps":30},"durationSeconds":4,"resources":{},"seed":1}。
- 静态 SVG 作品也可将 entry 指向本目录的 .svg；动态场景使用 JS。
- scene.mjs 导出 async initialize(context)、async renderAt(seconds)、async dispose()。
- context={container,canvas:{width,height,fps},durationSeconds,resources,seed}；在 container 内创建 Canvas、SVG 或 DOM。每次 renderAt 必须从绝对时间计算完整画面，允许任意顺序定位，不能依赖上次调用、真实时间或非确定随机数。
- 可 import {clamp,lerp,progress,smooth,randomAt,roundedRect,text,wrapText,mask,loadImage,loadVideo,seekVideo,mediaFit,particleMorph} from '@ncurator/drawing'。
- loadImage(url)、loadVideo(url)、seekVideo(video,seconds) 返回 Promise，必须等待资源与视频定位；context.resources 是可访问 URL。默认文字字体使用内置 NcuratorSceneSans（含中文）；也可将有权使用的字体放入 assets 并等待 document.fonts.ready。
- roundedRect(ctx,x,y,w,h,r)、text(ctx,value,x,y,{font?,color?,align?})、wrapText(ctx,value,maxWidth)；mask(ctx,drawMask,drawContent)；mediaFit(sourceWidth,sourceHeight,targetWidth,targetHeight,mode='contain') 返回 {x,y,width,height}；particleMorph(from,to,t) 插值点数组。
- 用本次用户诉求中的启动命令执行：frames --scene <scene.json> --times 0,1,2 --out <检查目录>；也可 frames --media <视频> --times <秒列表> --out <目录>。
- render --scene <scene.json> --out <成品路径> [--at <图片取帧秒数>]。扩展名支持 png/jpg/jpeg/webp/mp4/webm，WebM 保留透明，MP4 为不透明；动画不包含自动音频。
- 必须通过看图工具查看实际检查帧，检查布局、文字、动作和修改保留情况；修改后再次渲染和检查。保留源码及必要资源，不修改参考旧版本，不在运行时下载引擎或浏览器。`

export const DRAWING_SYSTEM_PREFIX = `绘画职责：根据本次要求和参考素材制作或修改图片、动画。使用现有文件工具维护作品源码，通过终端运行内置绘画引擎。修改时保留未要求改变的内容，查看实际检查帧并修正后交付；无法完成时说明问题并保留源码。\n\n${DRAWING_ENGINE_PROTOCOL}\n\n`
