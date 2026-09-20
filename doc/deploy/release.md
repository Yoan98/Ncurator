# 桌面端发布流程

当前正式发布只发腾讯云 COS，一次发布完成后不再把同一 Tag 上传到 Cloudflare R2。R2 仅供未来海外版显式使用 `RELEASE_STORAGE_TARGET=r2`。当前发布平台为 Windows x64 和 macOS arm64，平台 Tag 分别使用 `windows-vX.Y.Z` 与 `mac-vX.Y.Z`，版本号独立递增。

## 0. 执行约定（助手 / 发版机）

用户已明确要求发布时，助手应在发版机上按本文流程**自主执行到发布完成**（`release:start` → prepare → 正式包 E2E → COS publish 与公开验证），不要把 typecheck、测试架构、候选包构建、定向回归选择、上传失败重试等工程问题停下来逐项询问。

仅在下列**产品级**事项需要用户介入时再中断询问：

- 版本号、发布范围或是否上线尚不明确
- 需要取舍的产品行为 / 文案 / 兼容性决策
- 签名证书、密钥、COS/CDN 控制台权限等只有用户能提供或批准的事项
- 正式包 E2E 暴露出需要产品拍板的缺陷（修代码重打 vs 带已知风险上线等）

用户说「按发布文档发布」即视为批准设置 `NCURATOR_ALLOW_LIVE_PUBLISH=publish-to-production` 完成本次 COS 上线；默认仍只发 COS，不主动同步 R2。

## 1. 发布流程

发布按以下顺序进行：

1. 在干净的 `main` 上检查版本、环境和发布前置条件。
2. 创建并推送平台 annotated Tag。
3. 从 Tag 导出干净代码，构建并审计候选包。
4. 对比当前 Tag 与上一已发布同平台版本，评估改动影响并确定正式包回归范围。
5. 在实际安装的候选包上完成确定范围内的正式包 E2E。
6. 记录构建信息、回归结果和剩余风险。
7. 发布测试通过的同一份候选包到 COS，验证公开下载和更新通道。
8. 清理本地临时工作区和过期候选包。

候选包测试或公开验证失败时，不得放宽构建、审计、哈希和公开通道校验。

### 1.1 发布准备与 Tag

必须在干净且与 `origin/main` 完全一致的 `main` 上开始。新版本必须高于该平台当前仍存在的最高 Tag。发版机须具备 live `.env`，包括 `AI_LIVE_KEY_*`；默认 provider 为 `dashscope`。

`release:start` 会依次完成：

1. 校验 `released-migrations.json` 中已锁定 migration 的版本、名称、文件名和 SHA-256。
2. 并行执行 `typecheck:node`、`typecheck:web`，并准备网页抓取 sidecar。
3. 使用 6 个 worker 执行 Unit、update backend 和非 live AI backend（其中由 `requiresBackendPptBrowser` 识别的 PPT 浏览器用例 `pptBrowserFiles` 固定 1 个 worker 串行）。
4. 必跑 Workbench e2e `prefix-cache-retain-live`，验证同一伙伴经真实 UI 短续接、文本读工具历史、跨 run 前缀缓存和 `toolsHash`；没有 live key 必须失败，不能跳过。
5. 全部通过后，把当前连续 migration 纳入发布锁，与 `package.json` 版本一并提交，创建 annotated Tag，并原子推送 `main` 和 Tag。

第一个平台执行 `release:start` 时锁定本次新增 migration；另一平台使用同一份已锁源码。已锁 migration 不能合并、重排或修改，只能新增更高版本。

```bash
pnpm release:start -- --platform windows --version X.Y.Z
pnpm release:start -- --platform mac --version X.Y.Z
```

可用 `--notes <text>` 附加发布说明。

Windows 候选包须在本地 Windows x64 构建；macOS 只创建 Tag，候选包须在 Apple Silicon Mac 上构建。macOS 构建前需先在本机配置更新签名：`pnpm release:signing:setup`（依赖 `CSC_LINK` / `CSC_KEY_PASSWORD`）。平台环境与构建审计见 [`design.md`](./design.md)。

### 1.2 未上线 Tag 中止

Tag 已推送但尚未成为公开通道 `releases/latest` 中的 live 版本时，可以删除并重打同版本：

```bash
export NCURATOR_ALLOW_ABORT_TAG=abort-unpublished-tag
pnpm release:abort -- --tag windows-vX.Y.Z
# 或 mac-vX.Y.Z
```

`release:abort` 拒绝删除已 live 或本地状态为 `published` 的 Tag，同时删除远端和本地 annotated Tag 及该 Tag 的本地候选目录。`main` 上已经产生的 prepare 提交会保留。已上线版本有问题时必须发布更高版本，不能 abort live Tag。

## 2. 候选包与正式包回归

### 2.1 候选包

prepare 从 Tag 创建独立工作区，执行 `pnpm install --frozen-lockfile`、正式构建、安装包审计和 bundle 固化。不复用当前源码、旧 `node_modules` 或旧 `dist`，也不上传对象存储。

候选包目录为 `~/.ncurator/release-candidates/<tag>/<platform>/`，状态按以下顺序流转：

```text
prepared → ready → published
             └→ rejected
```

正式包 E2E 通过后候选包变为 `ready`；测试失败变为 `rejected`；公开发布并验证成功后变为 `published`。候选包、bundle 和对象存储布局见 [`design.md`](./design.md)。

### 2.2 影响评估

先对比当前 Tag 与上一已发布同平台 Tag：

```bash
git diff <previous-platform-tag>..<current-platform-tag>
```

评估版本实际改动涉及的产品能力、数据升级、平台构建、安装更新和跨模块风险，然后从正式包 E2E 回归用例中确定范围：

- 影响边界可以可靠收敛时，只执行受影响能力对应的用例。
- 影响范围较广，或无法可靠判断是否遗漏时，执行全部发版回归用例。
- 修改了 SQLite schema 时，至少包含 `sidebar-app-update`、`database-version-update-required`，并使用上一公开 schema 的可审查 fixture 验证原地升级。
- 评估结论必须记录版本、影响范围、实际执行的用例、结果和剩余风险。

正式包 E2E 只消费已构建的 `release-bundle-*.json`：执行前复验 Tag、commit、fragment 和哈希，安装 EXE/DMG 后测试安装态程序，不重新构建。未指定过滤参数时，发版命令执行全部发版回归用例；指定 `--domain`、`--suite`、`--group` 或 `--case` 时执行定向范围。过滤参数只允许用于 `--test-only`。

正式包 E2E 不改变候选包品牌，测试安装只落到本机隔离目录：

- Windows 静默安装到 `%LOCALAPPDATA%\NCurator-E2E`。同一 `appId` 下 NSIS 可能覆盖本机已安装的正式包；测试结束后关闭 E2E 进程，删除指向测试目录的快捷方式、卸载项和安装目录。
- macOS 使用 `ditto` 复制到 `~/Applications/NCurator-E2E/<platform>/`，并将副本改名为「馆长 E2E.app」。不触碰正式的「馆长.app」；测试结束后删除 `~/Applications/NCurator-E2E`。

只执行选定的正式包 E2E，真实 AI / 服务用例也按选定范围执行。源码 E2E、backend、Unit 和独立 AI 测试不能替代正式包 E2E。

### 2.3 问题处理

临时环境问题可以在同一候选包上复测。修改了产品、打包或测试代码时：

- 未上线：执行 `release:abort`，在修复后的 `main` 上用同一版本重新 `release:start` 和 prepare。
- 已上线：必须创建更高版本的新 Tag 和候选包。

同一次发布中，如果修复不影响已经通过的用例，不必重跑这些用例；但必须重新评估修改的影响范围，定向测试需要回归的。

## 3. 发布与公开验证

publish 只读取已经测试通过的候选包，不重新构建。默认发布到 COS，验证国内公开下载、更新 metadata、公开 manifest、文件大小、sha512 和 URL 成功后才算完成。对象键、CDN Cache-Control 和公开 URL 见 [`design.md`](./design.md)。

真实发布默认锁定。用户已按第 0 节批准本次上线后，在当前终端设置：

```bash
export NCURATOR_ALLOW_LIVE_PUBLISH=publish-to-production
```

未设置时，`--publish-only`、上传和 finalize 必须在网络写入前失败。普通构建和候选包测试不需要该变量。

国内 COS 发布完成后，不要再对同一 Tag 设置 `RELEASE_STORAGE_TARGET=r2` 执行第二次上传或 finalize。

## 4. 中断与恢复

- Tag 已创建但 prepare 中断：同 Tag 重跑 `--prepare-only`；如果源码已改变且版本尚未上线，先 abort 再用同版本重打。
- 候选包已生成但测试中断：对同一候选包重跑 `--test-only`。
- 上传或 finalize 中断：对同一候选包恢复 publish，或执行 `release:storage:finalize`。
- 未上线整轮作废：abort 后用同一版本重打，不要另起版本号。
- 已发布版本有问题：发布更高版本；回退下载通道不会让已安装客户端自动降级。
- 同一 Tag 的对象已存在但哈希不同：禁止覆盖；未上线时执行 abort 后用同一版本重打。

## 5. 命令参考

### 候选包

```bash
pnpm release:win -- --tag windows-vX.Y.Z --prepare-only
pnpm release:win -- --tag windows-vX.Y.Z --test-only [回归过滤参数]
pnpm release:win -- --tag windows-vX.Y.Z --publish-only

pnpm release:mac -- --tag mac-vX.Y.Z --prepare-only
pnpm release:mac -- --tag mac-vX.Y.Z --test-only [回归过滤参数]
pnpm release:mac -- --tag mac-vX.Y.Z --publish-only
```

独立验证已构建候选包：

```bash
pnpm test:e2e:package -- --bundle <release-bundle.json>
pnpm test:e2e:package -- --bundle <release-bundle.json> --domain workbench
pnpm test:e2e:package -- --bundle <release-bundle.json> --case <caseId>
```

上述命令用于手动验证已构建候选包；正式发布回归必须通过 `release:win` 或 `release:mac` 的 `--test-only` 执行。

### 发布中断恢复

上传已经完成但 finalize 中断时，确认当前 Tag 尚未被其他发布流程处理，再执行：

```bash
pnpm release:storage:finalize -- --tag <windows-vX.Y.Z|mac-vX.Y.Z>
```

该命令会校验 COS 上的 fragment 和安装包，写入公开更新 metadata / manifest，并清理旧对象。它不是正常发布入口，也不能用于已经发布完成的 Tag。
