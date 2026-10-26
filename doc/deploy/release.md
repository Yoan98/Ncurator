# 桌面端发布流程

每个平台同一 Tag、commit 和依赖锁生成国内、国际两个候选包，共用一次应用资源构建。国内包发布腾讯云 COS，国际包发布 Cloudflare R2 和 GitHub Releases，不交叉镜像。国内自动更新固定 COS，国际固定 R2；服务线路设置不影响更新渠道。发布前只对国内包执行正式包 E2E，国际包引用匹配的国内回归证据。平台为 Windows x64 和 macOS arm64，Tag 继续使用 `windows-vX.Y.Z` 与 `mac-vX.Y.Z`，版本独立递增。

## 1. 发布流程

发布按以下顺序进行：

1. 在干净的 `main` 上检查版本、环境和发布前置条件。
2. 创建并推送平台 annotated Tag。
3. 从 Tag 导出干净代码，构建一次共用资源，分别打包并审计国内、国际候选包。
4. 对比当前 Tag 与上一已发布同平台版本，评估改动影响并确定正式包回归范围。
5. 只安装国内候选包完成确定范围内的正式包 E2E；英文和国际服务在同一国内包内切换验证。
6. 记录构建信息、回归结果和剩余风险。
7. 校验 GitHub 权限、Tag 和两种包的共用资源哈希，创建或恢复草稿，上传国际安装包及校验文件。
8. 国内包发布 COS、国际包发布 R2，分别验证对应公开下载和自动更新通道。
9. 公开 GitHub Release，匿名下载安装包并校验大小与 SHA-256。
10. 三个渠道全部验证成功后，标记发布完成并清理本地临时工作区和过期候选包。

候选包测试或公开验证失败时，不得放宽构建、审计、哈希和公开通道校验。

### 1.1 发布准备与 Tag

必须在干净且与 `origin/main` 完全一致的 `main` 上开始。公开发布前应已完成桌面端仓库迁移，`origin` 指向 `Yoan98/Ncurator`，后续 Tag 与构建均基于公开源码。新版本必须高于该平台当前仍存在的最高 Tag。发版机须具备 live `.env`，包括 `AI_LIVE_KEY_*`、COS 和 R2 的发布配置；默认 provider 为 `dashscope`。

`release:start` 会依次完成：

1. 校验 `released-migrations.json` 中已锁定 migration 的版本、名称、文件名和 SHA-256。
2. 并行执行 `typecheck:node`、`typecheck:web`，并准备网页抓取 sidecar。
3. 使用 6 个 worker 执行全部非 live backend（AI、Knowledge、Unit，包含 update backend；其中由 `requiresBackendPptBrowser` 识别的 PPT 浏览器用例 `pptBrowserFiles` 固定 1 个 worker 串行）。
4. 全部通过后，把当前连续 migration 纳入发布锁，与 `package.json` 版本一并提交，创建 annotated Tag，并原子推送 `main` 和 Tag。

第一个平台执行 `release:start` 时锁定本次新增 migration；另一平台使用同一份已锁源码。已锁 migration 不能合并、重排或修改，只能新增更高版本。

```bash
pnpm release:start --platform windows --version X.Y.Z
pnpm release:start --platform mac --version X.Y.Z
```

可用 `--notes <text>` 附加发布说明。

Windows 候选包须在本地 Windows x64 构建；macOS 只创建 Tag，候选包须在 Apple Silicon Mac 上构建。macOS 构建前需先在本机配置更新签名：`pnpm release:signing:setup`（依赖 `CSC_LINK` / `CSC_KEY_PASSWORD`）。平台环境与构建审计见 [`design.md`](./design.md)。

### 1.2 未上线 Tag 中止

Tag 已推送但尚未成为公开通道 `releases/latest` 中的 live 版本时，可以删除并重打同版本：

```bash
export NCURATOR_ALLOW_ABORT_TAG=abort-unpublished-tag
pnpm release:abort --tag windows-vX.Y.Z
# 或 mac-vX.Y.Z
```

`release:abort` 拒绝删除已 live 或本地状态为 `published` 的 Tag，同时删除该 Tag 的 GitHub 草稿、远端和本地 annotated Tag 及本地候选目录；若 GitHub Release 已公开则拒绝中止。`main` 上已经产生的 prepare 提交会保留。已上线版本有问题时必须发布更高版本，不能 abort live Tag。

## 2. 候选包与正式包回归

### 2.1 候选包

prepare 从 Tag 创建独立工作区，执行 `pnpm install --frozen-lockfile`、正式构建、安装包审计和 bundle 固化。不复用当前源码、旧 `node_modules` 或旧 `dist`，也不上传对象存储。

候选包目录为 `~/.ncurator/release-candidates/<tag>/<platform>/<distribution>/`（`domestic` / `international`），状态按以下顺序流转：

```text
prepared → ready → published
             └→ rejected
```

国内正式包 E2E 通过后国内候选包变为 `ready`，失败为 `rejected`。国际包发布资格由同平台、同 Tag、同 commit、同共用资源哈希的国内通过结果决定，记录为未独立执行 E2E 并保存国内 bundle 的 SHA-256 引用，不能伪记为国际回归通过。两个下载渠道与 GitHub 均验证后才标记发布完成。候选包、bundle 和对象存储布局见 [`design.md`](./design.md)。

### 2.2 影响评估

先对比当前 Tag 与上一已发布同平台 Tag：

```bash
git diff <previous-platform-tag>..<current-platform-tag>
```

评估版本实际改动涉及的产品能力、数据升级、平台构建、安装更新和跨模块风险，然后从正式包 E2E 回归用例中确定回归测试范围：

- 影响边界可以可靠收敛时，只执行受影响能力对应的用例。
- 影响范围较广，或无法可靠判断是否遗漏时，执行全部发版回归用例。
- 评估结论必须记录版本、影响范围、实际执行和沿用的用例、结果及剩余风险；沿用结果保留原始 commit、安装包 SHA-256 和日志来源。
- 同一次发布中，已通过且后续修复未波及的用例沿用原结果，包括缓存用例。复测只选择受影响或缺少有效通过证据的用例。禁止老是复测全部，必须评估影响范围！！！

正式包 E2E 只消费国内发行包已构建的 `release-bundle-*.json`：执行前复验 Tag、commit、fragment 和哈希，安装 EXE/DMG 后测试安装态程序，不重新构建。未指定过滤参数时，发版命令执行全部发版回归用例；指定 `--domain`、`--suite`、`--group` 或 `--case` 时执行定向范围。过滤参数只允许用于 `--test-only`。

缓存用例纳入本次回归范围时，使用安装后的国内候选包和真实模型，先于其余用例执行；失败处理见「中断与恢复」。

同一候选包的复测合并实际用例结果。发布前复验本次执行结果中的 Tag、commit、平台、安装包 SHA-256 及实际正式包通过证据；跨候选包沿用的结果保留在影响评估中，不改记为本次安装包执行。结果保存在候选目录，原始日志在清理临时测试源码前回存到仓库 `tests/logs/**`。

正式包 E2E 不改变候选包品牌，测试安装只落到本机隔离目录：

- Windows 静默安装到 `%LOCALAPPDATA%\NCurator-E2E`。同一 `appId` 下 NSIS 可能覆盖本机已安装的正式包；测试结束后关闭 E2E 进程，删除指向测试目录的快捷方式、卸载项和安装目录。
- macOS 使用 `ditto` 复制到 `~/Applications/NCurator-E2E/<platform>/`，并将副本改名为「馆长 E2E.app」。不触碰正式的「馆长.app」；测试结束后删除 `~/Applications/NCurator-E2E`。

正式包 E2E 和真实 AI / 服务用例按选定范围执行。源码 E2E、backend、Unit 和独立 AI 测试不能替代正式包 E2E。

### 2.3 问题处理

临时环境问题可以在同一候选包上复测。修改了产品、打包或测试代码时：

- 未上线：执行 `release:abort`，在修复后的 `main` 上用同一版本重新 `release:start` 和 prepare。
- 已上线：必须创建更高版本的新 Tag 和候选包。

## 3. 发布与公开验证

publish 读取已通过国内回归且共用资源一致的双候选包，不重新构建。先校验两种产物、COS／R2 配置及各自公开版本；随后准备国际包 GitHub 草稿，国内包上线 COS、国际包上线 R2，分别验证下载、更新 metadata、manifest、大小、sha512 和 URL，最后公开 GitHub Release。三个渠道全部通过才算完成。对象键、CDN Cache-Control 和公开 URL 见 [`design.md`](./design.md)。

真实发布默认锁定。用户已批准本次上线后，在当前终端设置：

```bash
export NCURATOR_ALLOW_LIVE_PUBLISH=publish-to-production
```

未设置时，`--publish-only`、上传和 finalize 必须在网络写入前失败。普通构建和候选包测试不需要该变量。

平台发布命令固定处理 COS 和 R2，不受 `RELEASE_STORAGE_TARGET` 的单目标选择影响；该变量仅用于底层上传 / finalize 的定向恢复。两套存储配置缺失或任一公开渠道已有更高版本时，在写入 GitHub 或存储前失败。

### 3.1 GitHub Releases 镜像

发版机安装 [GitHub CLI](https://cli.github.com/)，并配置具有 `Yoan98/Ncurator` 写权限的凭证。macOS 可用 `brew install gh`；Windows 在实际发版机安装 CLI。认证任选一种：

- 无交互发布：在发版机终端环境或被 Git 忽略的本地 `.env` 中设置 `GH_TOKEN`，平台发布脚本自动读取。新建 fine-grained PAT 时只选择 `Yoan98/Ncurator`，授予 `Contents: Read and write`；也可复用已有且具备发布权限的凭证。使用环境 Token 时无需运行 `gh auth login`；凭证有效期间不需要浏览器重复授权。
- CLI 登录：执行下列命令完成一次浏览器授权，凭证由 CLI 保存到系统凭证存储，后续直接复用。

```bash
gh auth login --hostname github.com --web --git-protocol ssh --skip-ssh-key
gh auth status --hostname github.com
```

`gh` 自身不读取项目 `.env`。仅在 `.env` 配置 Token 时，可用以下只读命令验证认证：

```bash
node --env-file=.env -e "require('node:child_process').execFileSync('gh', ['api', '--method', 'GET', 'repos/Yoan98/Ncurator', '--jq', '.permissions.push'], { stdio: 'inherit' })"
```

本地 `.env` 中的 Token 不提交到仓库；macOS / Linux 文件权限设为 `600`。正式包 E2E 子进程移除 `GH_TOKEN` / `GITHUB_TOKEN`。本地发布不读取 GitHub Actions Secrets。每个平台继续使用原有发布命令，COS、R2、GitHub 不另设正常发布开关或上传步骤。

`--publish-only` 按以下规则执行：

1. 复验国内已测试及国际资源一致的候选 bundle，并核对公开仓库的 annotated Tag 指向同一构建 commit。Tag 不存在、源码不一致、登录或权限不足时，在写入 COS / R2 前失败；脚本不会代建或推送 Tag。
2. 创建 GitHub 草稿，或继续使用同 Tag 的已有草稿。只上传对应平台的 EXE / DMG 和 `SHA256SUMS`；版本说明取 Tag 注释并附源码和官网更新日志入口。GitHub 使用真实国际包的 `NCurator-…` 英文文件名（见[品牌命名](../brand.md#下载名-vs-缓存名)），安装包字节保持一致；不上传更新文件、bundle、日志或签名材料。
3. 校验已有附件的大小和 SHA-256；缺少服务端 digest 的旧附件下载复验。中断后只补齐缺失附件，可清除草稿内上传失败留下的 `starter` 附件；内容不同则失败，不覆盖已有安装包。
4. 分别将国内包发布 COS、国际包发布 R2。每个渠道已经指向对应候选包时只复验；渠道尚未上线或尚未切换时继续该渠道上传 / finalize。支持对已标记 `published` 的双候选包补齐其对应缺失渠道，拒绝覆盖内容不同的文件或降级公开通道。
5. 将草稿公开，再通过匿名下载复验附件大小与 SHA-256；已公开且内容相同的 Release 只验证。三个渠道全部成功后候选包才标记 `published`。

Windows 与 macOS 保持独立 Tag 和 Release，不设置跨平台共用的 Latest 标记。GitHub 的 Source code 下载项是源码压缩包，用户安装应选择 EXE / DMG。

首次公开应从清理后的公开源码创建 Tag 和候选包，不推送含凭证、内部资料的私有历史。自动发布要求公开 Tag 与候选 commit 完全一致，不处理历史安装包与公开快照的 commit 映射；补发旧版本需另行核对源码对应关系。

操作依据：[CLI 登录](https://cli.github.com/manual/gh_auth_login)、[创建 Release](https://cli.github.com/manual/gh_release_create)、[上传附件](https://cli.github.com/manual/gh_release_upload)。

## 4. 中断与恢复

- Tag 已创建但 prepare 中断：同 Tag 重跑 `--prepare-only`；如果源码已改变且版本尚未上线，先 abort 再用同版本重打。
- 候选包已生成但测试中断：对同一候选包重跑 `--test-only`。
- 上传、COS / R2 finalize、GitHub 公开或下载验证中断：修复原因后，对同一候选包重跑原平台的 `--publish-only`；复验已完成的渠道，补齐未完成渠道，不重新构建、不覆盖已公开附件。任一渠道失败时保留候选包、测试证据和 logs，不能宣称整次发布完成；`release:storage:finalize` 仅恢复选定存储，不完成其他渠道。
- 未上线整轮作废：abort 后用同一版本重打，不要另起版本号。
- 已发布版本有问题：发布更高版本；回退下载通道不会让已安装客户端自动降级。
- 同一 Tag 的对象已存在但哈希不同：禁止覆盖；未上线时执行 abort 后用同一版本重打。
- 缓存门槛失败必须停止，向用户说明失败事实、原因和日志，由用户决定是否修正或复测；不得自动重试、调整断言或继续发布。其他问题只有涉及产品决策时才询问用户，其余可自行修复并推进。

## 5. 命令参考

### 候选包

```bash
pnpm release:win --tag windows-vX.Y.Z --prepare-only
pnpm release:win --tag windows-vX.Y.Z --test-only [回归过滤参数]
pnpm release:win --tag windows-vX.Y.Z --publish-only

pnpm release:mac --tag mac-vX.Y.Z --prepare-only
pnpm release:mac --tag mac-vX.Y.Z --test-only [回归过滤参数]
pnpm release:mac --tag mac-vX.Y.Z --publish-only
```

独立验证已构建候选包：

```bash
pnpm test:e2e:package --bundle <release-bundle.json>
pnpm test:e2e:package --bundle <release-bundle.json> --domain workbench
pnpm test:e2e:package --bundle <release-bundle.json> --case <caseId>
```

上述命令用于手动验证已构建候选包；正式发布回归必须通过 `release:win` 或 `release:mac` 的 `--test-only` 执行。

### 发布中断恢复

上传已经完成但 finalize 中断时，确认当前 Tag 尚未被其他发布流程处理，再执行：

```bash
# 默认恢复 COS；恢复 R2 时先设置 RELEASE_STORAGE_TARGET=r2
pnpm release:storage:finalize --tag <windows-vX.Y.Z|mac-vX.Y.Z>
```

该命令会校验选定存储上的 fragment 和安装包，拒绝降级公开通道，写入该渠道的更新 metadata / manifest，并清理该平台旧对象。它不是正常发布入口；整次发布的恢复仍应使用平台 `--publish-only`，让三个渠道全部复验。
