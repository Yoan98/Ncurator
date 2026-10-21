<p align="center">
  <img src="./assets/brand/ncurator-logo.svg" alt="馆长" width="96" />
</p>

<h1 align="center">馆长</h1>

<p align="center"><strong>打造最好用的处理本地办公文件的 AI 助手</strong></p>

<p align="center">
  <strong>简体中文</strong> · <a href="./README.en.md">English</a>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue" alt="License: AGPL-3.0-only" /></a>
  <img src="https://img.shields.io/badge/Windows-x64-0078D4" alt="Windows x64" />
  <img src="https://img.shields.io/badge/macOS-Apple%20silicon-333333" alt="macOS Apple silicon" />
</p>

<p align="center">
  <a href="https://www.guanzhangai.cn/zh">官网与演示</a> ·
  <a href="https://www.guanzhangai.cn/zh/manual">使用手册</a> ·
  <a href="https://github.com/Yoan98/Ncurator/releases">GitHub Releases</a> ·
  <a href="https://x.com/Yoan_Huang">作者 X</a> ·
  <a href="#参与项目">QQ 群</a>
</p>

<p align="center">
  <a href="https://www.guanzhangai.cn/api/download/windows-x64"><strong>下载 Windows</strong></a> ·
  <a href="https://www.guanzhangai.cn/api/download/mac-arm64"><strong>下载 macOS（Apple 芯片）</strong></a>
</p>

## 架构设计

<p align="center">
  <img src="./assets/readme/architecture.zh.png" alt="任务交给大模型，由其自主调用文件、网络和终端能力，最终交付后由人审核阅读" width="1100" />
</p>

国内、国际发行包都内置简体中文和 English，可在通用设置选择语言与官方服务线路。国内安装名为「馆长」，固定从 COS 更新；国际安装名为「NCurator」，固定从 R2 更新。切换服务线路不改变更新渠道。

## 能力

| 能力            | 说明                                               |
| --------------- | -------------------------------------------------- |
| 📄 办公文件处理 | 读取、创建和编辑 DOCX、PPTX、XLSX 与普通text文件； |
| 🧠 本地知识库   | 支持大量文件索引处理，检索内容并引用来源           |
| 🌐 网页与浏览器 | 网络搜索、操作内置浏览器                           |
| ✍️ 改动审核     | 查看修改记录，审核改动差异，回退支持的文件改动     |
| ⏰ 定时任务     | 按计划执行任务，复用伙伴的资料与模型配置           |

功能演示和真实任务案例见[官网](https://www.guanzhangai.cn/zh)。

## 快速开始

1. 下载并安装 Windows 或 macOS 版本。
2. 选择可用模型，或配置自己的服务地址与 API Key。
3. 创建伙伴、添加工作目录，开始交代任务。使用知识库时，先下载向量模型并建立索引。

## Roadmap

欢迎一起讨论和参与以下计划：

| 方向              | 计划                                       |
| ----------------- | ------------------------------------------ |
| 🔤 知识库英文支持 | 知识库支持英文向量与索引                   |
| 🧩 Skill 集成     | 接入和管理用户自定义、第三方 Skill         |
| 🧭 浏览器数据导入 | 导入用户浏览器数据，优先支持书签与历史记录 |
| 🖼️ 多模态知识库   | 支持图片、音频的解析、索引、检索与来源引用 |
| 🧠 伙伴记忆       | 建立长期记忆                               |

## 参与项目

**QQ 群：891209383**。对后续迭代有兴趣，欢迎一起讨论需求、交流想法，参与开发、测试。

关注 [X：@Yoan_Huang](https://x.com/Yoan_Huang) 获取项目进展。问题与建议请提交 [Issues](https://github.com/Yoan98/Ncurator/issues)，提交 PR 前请阅读[贡献指南](./CONTRIBUTING.md)。

## 从源码运行

建议使用 Node.js 22、pnpm 9.12.2、Python 3.12。

```bash
git clone https://github.com/Yoan98/Ncurator.git
cd Ncurator
pnpm install --frozen-lockfile
pnpm dev
```

环境准备、构建与验证见[贡献指南](./CONTRIBUTING.md#开发与验证)，系统设计见[架构文档](./doc/architecture.md)。

## 浏览器插件

独立维护的收藏夹查看与链接复制工具：[源码仓库](https://github.com/Yoan98/Ncurator-Extension) · [Chrome](https://chromewebstore.google.com/detail/ncurator-knowledge-base-a/jdlfflbeekclkgcckcfombmfojmcdeio?hl=zh-CN) · [Microsoft Edge](https://microsoftedge.microsoft.com/addons/detail/hkdfdbpkmkpooopbkdghecbaipeoijpj)。

## 许可证

采用 [AGPL-3.0-only](./LICENSE)，允许遵守许可证的商业使用。第三方组件保留各自许可证。

## 友链

- [LinuxDo 社区](https://linux.do/)
