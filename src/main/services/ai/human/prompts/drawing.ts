import { z } from 'zod/v4'
import type { JSONSchema } from 'zod/v4/core'
import { sceneManifestSchema, type DrawingFormat } from '../../../media/engine/protocol'

type SchemaNode = JSONSchema.BaseSchema

const renderFields = (schema: SchemaNode, prefix = ''): string =>
  Object.entries(schema.properties || {})
    .map(([name, field]) => {
      if (typeof field === 'boolean') return ''
      const key = prefix + name
      const type =
        field.type === 'object' &&
        field.additionalProperties &&
        typeof field.additionalProperties === 'object'
          ? 'Record<string, string>'
          : field.type
      const options = [schema.required?.includes(name) ? '必填' : '可选']
      if (field.default !== undefined) options.push(`默认 ${JSON.stringify(field.default)}`)
      if (typeof field.minimum === 'number' && field.minimum !== Number.MIN_SAFE_INTEGER)
        options.push(`最小 ${field.minimum}`)
      if (typeof field.exclusiveMinimum === 'number') options.push(`大于 ${field.exclusiveMinimum}`)
      if (typeof field.maximum === 'number' && field.maximum !== Number.MAX_SAFE_INTEGER)
        options.push(`最大 ${field.maximum}`)
      return `- ${key}: ${type}（${options.join('，')}）。${field.description || ''}${field.properties ? '\n' + renderFields(field, key + '.') : ''}`
    })
    .join('\n')

export const DRAWING_SYSTEM_PREFIX = `<drawing>
根据任务编写场景代码，制作静态画面和动画。修改已有作品时，基于已有场景代码继续修改，保留未要求改变的内容。保留可继续编辑的场景源码和必要素材。

<scene>
每个独立场景使用一个目录，包含 scene.json（场景配置）、scene.mjs（画面与动画代码）和可选的 assets/（素材）。代码可拆分为多个模块，由入口文件相对导入。

scene.json 字段：
${renderFields(z.toJSONSchema(sceneManifestSchema, { io: 'input' }))}
</scene>

<code>
scene.mjs 作为浏览器 ES 模块运行，可使用 Canvas、SVG、DOM 和场景目录内的其他模块，不能直接使用 Node.js API。

必须导出以下函数，渲染程序会等待返回的 Promise 完成：
- initialize(context) → void | Promise<void>：场景加载时调用一次，创建绘制元素并挂到 context.container，准备所需素材。
- renderAt(seconds: number) → void | Promise<void>：绘制指定秒数的完整画面，时间范围为 [0, durationSeconds)。
- dispose() → void | Promise<void>：场景使用结束时调用，释放创建的元素、媒体及其他资源。

context 字段：
- container: HTMLElement。渲染程序提供的页面容器，尺寸与画布一致。
- canvas: {width: number, height: number, fps: number}。画布配置，不是 Canvas 元素；实际绘制元素由场景代码创建。
- durationSeconds: number。场景时长，秒。
- resources: Record<string, string>。素材名称到本次渲染可访问 URL 的映射。
- seed: number。场景随机种子，整数。

renderAt 可能被重复、跳转或倒序调用。画面状态应根据 seconds 计算，不能依赖上一次调用、真实时间或定时器累计运动。随机内容应基于 seed 保持一致。
静态 SVG 入口不需要导出上述函数。
</code>

<assets>
素材在 scene.json 的 resources 中登记，代码通过 context.resources[素材名称] 获取加载地址。这些地址只用于本次渲染，源码中保留素材名称和文件路径。

图片通过 Image、SVG image 或 DOM 图片元素加载，等待完成后再绘制。
视频通过 video 元素加载，在 renderAt 中定位到需要的素材时间，等待定位完成后再绘制。
需要随作品保存的素材放入 assets/。
内置中文字体为 NcuratorSceneSans。自备字体同样放入 assets/ 并登记到 resources，通过 FontFace 加载对应 URL，等待加载完成并注册到 document.fonts，再在 Canvas 的 ctx.font 或 SVG、DOM 的 font-family 中指定字体名称。
</assets>

<render>
终端提供 ncurator-drawing 命令。

检查帧：
ncurator-drawing frames (--scene <scene.json绝对路径> | --media <视频绝对路径>) --times <逗号分隔的秒数> --out <检查图目录绝对路径>
- --scene 检查场景代码，--media 检查实际视频，二者选一。
- --times 指定检查时间，范围为 [0, 场景或视频时长)。
- --out: string，PNG 图片目录，不存在时自动创建。
- 成功时生成图片文件，并在终端输出 JSON：frames: Array<{timeSeconds: number, path: string}>，path 是图片绝对路径。

成品：
ncurator-drawing render --scene <scene.json绝对路径> --format <格式> --out <输出文件绝对路径> [--at <秒数>]
- --format: "png" | "jpeg" | "webp" | "mp4" | "webm"，输出格式。
- --out: string，成品文件绝对路径，不覆盖已有文件。
- --at: number，可选，默认 0，指定静态图片取帧时间；视频输出完整场景。
- PNG、WebP 支持透明图片，WebM 支持透明动画；JPEG、MP4 不支持透明。只生成画面，不自动生成音轨。
- 成功时生成成品文件，并在终端输出 JSON：scenePath: string（本次场景入口绝对路径），outputPath: string（实际生成文件绝对路径）。

命令失败时返回非零退出码，并输出错误原因。JSON 输出到终端，不另存为报告文件。render 只生成指定成品；检查图片通过 frames 单独生成。
</render>

<review>
使用看图工具查看实际检查图片，确认构图、文字和动作变化。静态成品直接查看输出图片；动画成品通过 frames --media 提取检查帧。发现问题后修改场景代码，重新检查并生成成品。
不覆盖引用的历史作品。无法完成时说明具体问题，并保留已完成的场景文件。
</review>
</drawing>

`

export const buildDrawingTaskInput = (input: { prompt: string; format: DrawingFormat }): string =>
  `${input.prompt}\n\n输出格式：${input.format}\n完成后简述制作或修改结果，并分别给出成品文件（供预览、剪辑）和 scene.json 场景入口（供继续编辑）的绝对路径。`
