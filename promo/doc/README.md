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
4. 使用 macOS 本地普通话男声按句生成旁白，并直接按真实音频时长生成准确字幕时间。
5. 选择一首授权明确的音乐，并把实际使用的音源登记到库存。
6. 编排 HyperFrames 画面并执行完整检查。
7. 渲染唯一成片 `renders/final.mp4`。

## 命令

```bash
pnpm promo:new -- "本期主题" "episode-slug"
pnpm promo:capture -- 001-episode app-frame
pnpm promo:voice -- 001-episode
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

馆长默认使用 macOS 本地中文 TTS，不需要真人录音和在线接口。

- 声音：温和可靠的年轻男声
- 音色：`Reed (中文（中国大陆）)`
- 语速：`190` 词/分钟
- 产品名称：统一读作“馆长”
- 禁用词：`NCurator`、`大聪明`、`没头脑`

旁白按句生成，每句使用真实音频时长写入 `transcript.json`，避免语音识别造成错字。Kokoro 只作为以后确实需要更换音色时的备用方案。

## Git 规则

视频源文件可以提交 Git。原始录屏、生成音频、下载音乐和最终 MP4 不提交 Git，它们都可以通过脚本或来源清单重新获得。
