# 馆长宣传视频工程

这个目录用于制作馆长竖屏视频。HyperFrames 负责时间线和渲染，FFmpeg 负责音视频编码。

## 目标

- 新电脑拉取 Git 和 Git LFS 后，可以直接拿到原始发布成片。
- 不重新调用 AI、生成旁白或采集画面，也能预览和重新渲染。
- 数据库、模型密钥、浏览器缓存和临时文件永远不进 Git。

## 固定规则

- 对外名称只使用“馆长”。
- 成片固定为 `1080x1920`、`9:16`、`30fps`。
- 正式成片只有 `renders/final.mp4`。
- 中文字幕直接烧录进视频。
- 不出现官网、二维码、下载、关注或私信提示。

## 每期目录

```text
001-episode/
├── episode.json                 # 素材、渲染源文件和 SHA-256 清单
├── index.html                   # HyperFrames 时间线
├── narration.txt
├── transcript.json
├── assets/
│   ├── audio/                   # 正式旁白和音乐
│   └── captured/
│       ├── source/              # 原始录屏
│       ├── clips/               # 成片实际使用的视频片段
│       └── stills/              # 成片实际使用的截图
├── renders/
│   ├── final.mp4                 # Git LFS 保存的正式原片
│   └── final.json                # 成片 SHA-256 和视频参数
└── .work/                       # 临时数据，全部忽略
```

## 工作流

```bash
pnpm promo:new -- "本期主题" "episode-slug"
pnpm promo:capture -- 001-episode app-frame
pnpm promo:voice -- 001-episode
pnpm promo:manifest -- 001-episode
pnpm promo:verify -- 001-episode
pnpm promo:check -- 001-episode
pnpm promo:preview -- 001-episode
pnpm promo:render -- 001-episode
pnpm promo:publish -- 001-episode
```

`promo:render` 只生成 `.work/render/candidate.mp4`，不会覆盖原片。确认后用 `promo:publish` 提升为 `renders/final.mp4`。

`promo:verify` 会检查：

- 页面引用的素材是否存在。
- 素材和渲染源文件的 SHA-256 是否匹配。
- 音视频是否由 Git LFS 管理。
- 成片的分辨率、帧率和时长是否正确。
- 是否夹带 SQLite、LevelDB、浏览器配置或本机绝对路径。

## Git 和 Git LFS

正式截图用普通 Git。WAV、MP4、WebM、MOV 和字体用 Git LFS。

新电脑首次使用：

```bash
git lfs install
git lfs pull
pnpm install --frozen-lockfile
pnpm promo:verify --all
```

## 安全边界

不得提交以下内容：

- `app.sqlite`、LevelDB、Local Storage、Session Storage。
- API Key、模型账号信息。
- 用户真实工作区和用户文档。
- `.work/` 中的任何文件。

采集脚本会把临时模型配置放到 `.work/capture/user-data/`，完成后删除。Git LFS 不是加密存储，不能用来保存密钥。

## 音源和人声

可用音源登记在 `library/audio/catalog.json`，真实音频文件进 Git LFS。每期实际使用的版本仍保存在本期 `assets/audio/music.wav`。

馆长旁白使用固定的本地 Qwen3-TTS 配置。正式 `narration.wav` 必须进 Git LFS，新电脑重新渲染时不需要再生成旁白。
