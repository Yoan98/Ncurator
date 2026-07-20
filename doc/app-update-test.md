# 自动更新测试说明

自动更新分为三层测试。模拟页面 E2E 用于验证界面状态和 IPC，不代替真实安装升级。

## 1. 快速测试

运行后端契约测试和模拟页面 E2E：

```bash
pnpm test:update
```

也可以分开运行：

```bash
pnpm test:update:backend
pnpm test:update:e2e
```

后端测试验证主进程更新状态、发布配置、R2 元数据和 release fragment。模拟 E2E 验证页面按钮、进度、错误提示和 IPC，不下载真实更新包，也不作为正式发布的阻塞门禁。

## 2. 真实升级测试

只有明确需要验证真实自动更新时才运行：

```bash
pnpm test:update:real -- \
  --source-version 0.1.16 \
  --expected-version 0.1.17
```

当前脚本只支持 macOS，并且必须显式传入旧版本和更高的目标版本。脚本会：

1. 使用当前代码打包一个版本号为 `source-version` 的测试 App，或复制 `source-app` 指定的已有 App。
2. 写入与正式构建相同的 Generic 更新地址。
3. 使用独立的用户数据和缓存启动测试 App。
4. 从正式 R2 更新源检查并下载 `expected-version`。
5. 调用重启安装。
6. 检查 App 版本是否变成 `expected-version`。
7. 检查测试用户数据是否保留。
8. 删除临时 App，保留测试报告。

不会修改正在运行的正式 App，也不会使用正式用户数据。

也可以传入已经打包好的旧版 App；该 App 的真实版本必须与 `source-version` 一致：

```bash
pnpm test:update:real -- \
  --source-app dist/mac-arm64/馆长.app \
  --source-version 0.1.16 \
  --expected-version 0.1.17
```

报告保存在：

```text
tests/logs/settings/update/real/<运行时间>/report.json
tests/logs/settings/update/real/<运行时间>/process.log
```

真实升级测试会下载完整更新包，耗时和流量都比较大，不应放入普通 PR 或日常测试。

## 3. 判定标准

只有同时满足以下条件，真实升级才算通过：

- 能发现指定的新版本。
- 更新包下载完成且校验通过。
- 调用重启安装后 App 被替换。
- App 版本变成目标版本。
- 测试用户数据仍然存在。

如果下载完成但 App 没有被替换，应优先检查 macOS 代码签名和 Squirrel.Mac 日志。

当前 macOS 正式包使用固定的 `Ncurator Update Signing` 签名，不是 Apple Developer ID，也不代表已经完成 Apple 公证。应用只有在签名 Authority、Bundle Identifier 和稳定 designated requirement 全部匹配时才启用 macOS 自动更新；ad-hoc、无签名或签名不匹配都会关闭更新并显示原因。更换签名或更新链路后必须重新执行真实升级测试，只有安装替换成功才算完整通过。
