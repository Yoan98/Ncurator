# 自动更新测试说明

自动更新分为三层测试。

## 1. 快速测试

运行单元测试和模拟 E2E：

```bash
pnpm test:update
```

也可以分开运行：

```bash
pnpm test:update:unit
pnpm test:update:e2e
```

单元测试验证主进程的更新状态、错误处理和安装调用。模拟 E2E 验证应用更新页面，不会下载真实更新包。

## 2. 真实升级测试

只有明确需要验证真实自动更新时才运行：

```bash
pnpm test:update:real
```

当前脚本支持 macOS，默认执行 `0.1.0 → 0.1.1`。脚本会：

1. 使用当前代码打包一个版本号为 `0.1.0` 的测试 App。
2. 写入与正式构建相同的 Generic 更新地址。
3. 使用独立的用户数据和缓存启动测试 App。
4. 从正式 R2 更新源检查并下载 `0.1.1`。
5. 调用重启安装。
6. 检查 App 版本是否变成 `0.1.1`。
7. 检查测试用户数据是否保留。
8. 删除临时 App，保留测试报告。

不会修改正在运行的正式 App，也不会使用正式用户数据。

可以指定版本。也可以传入已经打包好的旧版 App：

```bash
pnpm test:update:real -- \
  --source-app dist/mac-arm64/Ncurator.app \
  --source-version 0.1.0 \
  --expected-version 0.1.1
```

需要单独诊断 GitHub Release 文件时，可以启动本地元数据代理：

```bash
pnpm test:update:real -- --github-release-tag v0.1.1
```

这个参数只用于区分“更新安装逻辑”和“正式 R2 更新源”问题，不能代替正式更新源测试。

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

当前 macOS 正式包没有 Developer ID 签名。应用会关闭 macOS 自动更新，并在设置页直接显示原因。配置签名后，应重新执行真实升级测试，只有安装替换成功才算完整通过。
