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

## 能力

| 能力            | 说明                                                                 |
| --------------- | -------------------------------------------------------------------- |
| 📄 办公文件处理 | 读取、创建和编辑 DOCX、PPTX、XLSX 与纯文本文件，支持 PDF 阅读        |
| 🧠 本地知识库   | 支持大量文件索引处理，检索内容并引用来源                             |
| 🔍 网页搜索     | 搜索网络信息、读取网页内容，并可操作内置浏览器                       |
| 💻 本地终端     | 执行本地命令和脚本，完成数据处理与任务自动化                         |
| ✍️ 改动审核     | 查看修改记录，审核改动差异，回退支持的文件改动                       |
| 🔗 WPS 联动     | 点击 AI 改动处，在 WPS 中打开文档并定位；AI 修改或回退后自动刷新文档 |
| ⏰ 定时任务     | 按计划执行任务，复用伙伴的资料与模型配置                             |

WPS 联动需启用加载项，改动定位需将 WPS 设为默认打开方式，详见[使用说明](https://www.guanzhangai.cn/zh/manual#wps-integration)。

功能演示和真实任务案例见[官网](https://www.guanzhangai.cn/zh)。

## 快速开始

1. 下载并安装 Windows 或 macOS 版本。
2. 选择可用模型，或配置自己的服务地址与 API Key。
3. 创建伙伴、添加工作目录，开始交代任务。使用知识库时，先下载向量模型并建立索引。

## Roadmap

当前进展与后续计划，欢迎一起讨论和参与：

| 方向              | 说明                                                                                     | 状态      |
| ----------------- | ---------------------------------------------------------------------------------------- | --------- |
| 🔤 知识库英文支持 | 知识库支持英文向量与索引                                                                 | ⏳ 计划中 |
| 🧩 Skill 集成     | 接入和管理用户自定义、第三方 Skill，由 [@AntonyLang](https://github.com/AntonyLang) 完成 | ✅ 已完成 |
| 📥 Skill 一键导入 | 一键将 WorkBuddy、豆包工作的 Skills 导入馆长                                             | ⏳ 计划中 |
| 🔌 扩展生态       | 接入企业微信、邮箱等平台，扩展办公协作能力                                               | ⏳ 计划中 |
| 📱 手机网页互通   | 通过手机浏览器连接电脑，远程使用馆长处理任务                                             | ⏳ 计划中 |
| 🧭 浏览器数据导入 | 导入用户浏览器数据，优先支持书签与历史记录                                               | ⏳ 计划中 |
| 🖼️ 多模态知识库   | 支持图片、音频的解析、索引、检索与来源引用                                               | ⏳ 计划中 |
| 🧠 伙伴记忆       | 建立长期记忆                                                                             | ⏳ 计划中 |

## 参与项目

### 联系方式

- QQ 群：**891209383**
- X：[@Yoan_Huang](https://x.com/Yoan_Huang)

### 反馈与贡献

- 问题、需求与提问：[Issues](https://github.com/Yoan98/Ncurator/issues)
- 代码、测试与文档贡献：[贡献指南](./CONTRIBUTING.md)

### 开发环境

建议使用 Node.js 22、pnpm 9.12.2、Python 3.12。

## 浏览器插件

独立维护的收藏夹查看与链接复制工具：[源码仓库](https://github.com/Yoan98/Ncurator-Extension) · [Chrome](https://chromewebstore.google.com/detail/ncurator-knowledge-base-a/jdlfflbeekclkgcckcfombmfojmcdeio?hl=zh-CN) · [Microsoft Edge](https://microsoftedge.microsoft.com/addons/detail/hkdfdbpkmkpooopbkdghecbaipeoijpj)。

## 许可证

采用 [AGPL-3.0-only](./LICENSE)，允许遵守许可证的商业使用。第三方组件保留各自许可证。

## 友链

- [LinuxDo 社区](https://linux.do/)

## 常见问题

### Mac 安装问题

macOS 安装后提示“已损坏”或无法打开，请查看[Mac 安装问题解决指南](https://www.guanzhangai.cn/zh/manual#mac-download)。

## 贡献者

感谢所有为馆长贡献代码、文档、测试和反馈的朋友！以下展示仓库的代码贡献者，点击可查看完整列表。

[![贡献者](https://contrib.rocks/image?repo=yoan98/ncurator)](https://github.com/Yoan98/Ncurator/graphs/contributors)
