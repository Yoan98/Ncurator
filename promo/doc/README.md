# 馆长宣传视频工程

这个目录用于制作可以直接发布到抖音和小红书的馆长竖屏视频。HyperFrames 负责时间线、字幕、动效、转场和渲染，FFmpeg 负责最终视频与音频编码。

## 固定规则

- 对外名称只使用“馆长”
- 成片固定为 `1080x1920`、`9:16`、`30fps`
- 每期只交付一个 `renders/final.mp4`
- 中文字幕直接烧录进视频
- 不制作 clean 版、独立字幕、封面或广告结尾
- 不出现官网、二维码、下载、关注或私信提示
- 视频停在真实产品结果或有价值的信息上

## 目录

```text
promo/
├── doc/                       # 人工维护的统一文档
├── brand/                     # 产品能力和禁用文案
├── library/
│   ├── audio/                 # 音源目录与授权清单
│   └── voice/                 # 固定人声和发音规则
├── templates/                 # HyperFrames 竖屏模板
├── episodes/                  # 每一期视频工程
└── scripts/                   # 新建、采集、旁白、检查和渲染脚本
```

模板和每一期目录中的 `DESIGN.md` 是 HyperFrames 运行时必须读取的软链接，统一指向 `promo/doc/DESIGN.md`，视觉规范只有这一份。

## 工作流

1. 根据用户主题生成本期 `brief.md`、`narration.txt` 和 `shot-list.md`。
2. 运行 `pnpm promo:new -- "主题" "英文短名"` 新建一期。
3. 采集真实产品画面并放入本期 `assets/captured/`。
4. 使用本地 Qwen3-TTS 生成整段中文旁白，并根据真实音频时长生成字幕时间。
5. 选择一首授权明确的音乐，并把实际使用的音源登记到库存。
6. 编排 HyperFrames 画面并执行完整检查。
7. 渲染唯一成片 `renders/final.mp4`。

## 命令

```bash
pnpm promo:new -- "本期主题" "episode-slug"
pnpm promo:capture -- 001-episode app-frame
pnpm promo:voice:setup
pnpm promo:voice -- 001-episode
pnpm promo:voice:check -- 001-episode
pnpm promo:check -- 001-episode
pnpm promo:preview -- 001-episode
pnpm promo:render -- 001-episode
```

省略视频目录时，脚本默认使用编号最大的一期。

## 音源库存

只保存实际用过或已经确认可用的音乐和音效，不批量囤积。真实音频文件放在 `library/audio/files/`，该目录不提交 Git。

每个音源加入 `library/audio/catalog.json` 时必须记录：

- 标题、作者和来源页面
- 授权类型与授权证据路径
- 是否允许商用、是否要求署名
- 下载日期、文件校验值、时长、情绪和 BPM

默认只使用允许商用且不要求署名的音乐。没有合适的免费音源时，再考虑本地生成。

## 人声

### 唯一正式配音方案

馆长所有宣传视频只使用本地 Qwen3-TTS。第一期成片使用的就是下面这套方案，后续视频必须保持一致：

- 固定人声 ID：`qwen3-guan-zhang-relaxed-male-v1`
- 模型：`mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit`
- 声音描述：成熟、松弛、可信的中文男声，像有经验的朋友自然交流
- 生成方式：整段文案一次生成，不能逐句拼接
- 随机种子与采样参数：固定在 `profile.json`，保证同一文案重复生成时声音和时长稳定
- 语速：原始语音的 `1.08` 倍
- 后处理：`48kHz`、单声道、`PCM 16-bit`，响度 `-17 LUFS`，峰值 `-1 dBTP`
- 产品名称：统一读作“馆长”
- 禁用词：`NCurator`、`大聪明`、`没头脑`

唯一配置源是 `promo/library/voice/profile.json`。模型、声音描述、语速和后处理参数都从这里读取，生成脚本中不能再维护另一套默认值。

### 强制规则

- 正式旁白只能通过 `pnpm promo:voice -- <视频目录>` 生成。
- Edge、macOS `say`、Kokoro 和其他系统语音禁止作为备用方案。
- Qwen 环境缺失或模型下载失败时，必须停止制作并修复环境，不能自动降级。
- 不能手工覆盖 `assets/audio/narration.wav`。
- 每次生成都会同时写入 `narration.meta.json`，记录人声 ID、模型、风格、语速、文案哈希和音频哈希。
- `promo:check`、`promo:preview` 和 `promo:render` 会强制校验该凭证；音频被替换、文案变更后未重生成、人声配置不一致、字幕时长不一致或 HTML 音轨时长未同步时都会直接失败。

### 首次安装与缓存

`pnpm promo:voice` 会自动检查本地运行环境。首次使用会通过 `uv` 创建 Python 3.11 环境、安装 `promo/library/voice/requirements.txt` 中锁定的依赖，并下载约 2GB 的 8bit 模型。之后直接复用缓存。

也可以提前运行：

```bash
pnpm promo:voice:setup
```

默认位置：

- Python 环境：`~/.cache/ncurator-promo/tts/venv`
- 模型缓存：`~/.cache/huggingface/hub`

如需使用别的虚拟环境，可设置 `PROMO_TTS_VENV`。如需禁止自动安装，可设置 `PROMO_TTS_AUTO_SETUP=0`；此时环境不可用会直接报错，仍然不能换成系统语音。

### 每期正确顺序

1. 写完 `narration.txt`。
2. 运行 `pnpm promo:voice -- <视频目录>`。
3. 按新生成的 `transcript.json` 调整场景和字幕时间。
4. 运行 `pnpm promo:voice:check -- <视频目录>` 确认固定人声与音频哈希一致。
5. 再运行 `promo:check` 和 `promo:render`。

字幕直接使用原始文案，不用语音识别改写文字。

## Git 规则

视频源文件可以提交 Git。原始录屏、生成音频、下载音乐和最终 MP4 不提交 Git，它们都可以通过脚本或来源清单重新获得。
