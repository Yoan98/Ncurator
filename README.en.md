<p align="center">
  <img src="./assets/brand/ncurator-logo.svg" alt="NCurator" width="96" />
</p>

<h1 align="center">NCurator</h1>

<p align="center"><strong>Building the most user-friendly AI assistant for working with local office documents</strong></p>

<p align="center">
  <a href="./README.md">简体中文</a> · <strong>English</strong>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue" alt="License: AGPL-3.0-only" /></a>
  <img src="https://img.shields.io/badge/Windows-x64-0078D4" alt="Windows x64" />
  <img src="https://img.shields.io/badge/macOS-Apple%20silicon-333333" alt="macOS Apple silicon" />
</p>

<p align="center">
  <a href="https://www.ncurator.com/en">Website & demos</a> ·
  <a href="https://www.ncurator.com/en/manual">Manual</a> ·
  <a href="https://github.com/Yoan98/Ncurator/releases">GitHub Releases</a> ·
  <a href="https://x.com/Yoan_Huang">Author on X</a> ·
  <a href="#get-involved">QQ group</a>
</p>

<p align="center">
  <a href="https://www.ncurator.com/api/download/windows-x64"><strong>Download for Windows</strong></a> ·
  <a href="https://www.ncurator.com/api/download/mac-arm64"><strong>Download for macOS (Apple silicon)</strong></a>
</p>

## Architecture Design

<p align="center">
  <img src="./assets/readme/architecture.en.png" alt="A task goes to a language model, which chooses file, web, and terminal tools, then delivers the result for human review" width="1100" />
</p>

Both distributions include Simplified Chinese and English interfaces. Choose a language and official service region in General settings. The domestic installer is named 馆长 and updates from COS; the international installer is named NCurator and updates from R2. Changing the service region does not change the update channel.

## Capabilities

| Capability              | What it does                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| 📄 Office documents     | Read, create, and edit DOCX, PPTX, XLSX, and plain text; read PDFs                                      |
| 🧠 Local knowledge base | Index local folders and web material, retrieve content, and cite sources                                |
| 🔍 Web search           | Search the web, read page content, and use the built-in browser                                         |
| 💻 Local terminal       | Run local commands and scripts for data processing and task automation                                  |
| ✍️ Change review        | Preview results, inspect changes, and revert supported file edits                                       |
| 🔗 WPS integration      | Click an AI change to open the document at that location in WPS; auto-refresh after AI edits or reverts |
| ⏰ Scheduled tasks      | Run tasks on a schedule using a partner's material and model configuration                              |

WPS integration requires its add-in to be enabled. To jump to a change, set WPS as the default app for that file type. See the [setup guide](https://www.ncurator.com/en/manual#wps-integration).

See the [website](https://www.ncurator.com/en) for demos and real task examples.

## Get started

1. Download and install the Windows or macOS app.
2. Choose an available model or configure your own endpoint and API key.
3. Create a partner, add a working folder, and give it a task. To use the knowledge base, download an embedding model and build an index first.

## Roadmap

Current progress and planned work. Join the discussion and help shape what comes next:

| Direction                    | Description                                                                                                   | Status       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------ |
| 🔤 English knowledge base    | English embedding models and indexing                                                                         | ⏳ Planned   |
| 🧩 Skill integration         | Connect and manage custom and third-party Skills. Implemented by [@AntonyLang](https://github.com/AntonyLang) | ✅ Completed |
| 📥 One-click Skill import    | Import Skills from WorkBuddy and Doubao Work (豆包工作) into NCurator in one click                            | ⏳ Planned   |
| 🔌 Integration ecosystem     | Connect WeCom, email services, and other workplace platforms                                                  | ⏳ Planned   |
| 📱 Mobile web access         | Connect to your computer from a phone browser to use NCurator remotely                                        | ⏳ Planned   |
| 🧭 Browser data import       | Import data from your browser, starting with bookmarks and history                                            | ⏳ Planned   |
| 🖼️ Multimodal knowledge base | Parse, index, and retrieve images and audio with source references                                            | ⏳ Planned   |
| 🧠 Partner memory            | Build long-term memory                                                                                        | ⏳ Planned   |

## Get involved

### Contact

- QQ group: **891209383** (Chinese)
- X: [@Yoan_Huang](https://x.com/Yoan_Huang)

### Feedback and contributions

- Bugs, feature requests, and questions: [Issues](https://github.com/Yoan98/Ncurator/issues)
- Code, tests, and documentation: [Contribution guide](./CONTRIBUTING.en.md)

### Development environment

Recommended: Node.js 22, pnpm 9.12.2, and Python 3.12.

## Browser extension

A separately maintained bookmark viewer and URL copying tool: [Source repository](https://github.com/Yoan98/Ncurator-Extension) · [Chrome](https://chromewebstore.google.com/detail/ncurator-knowledge-base-a/jdlfflbeekclkgcckcfombmfojmcdeio?hl=zh-CN) · [Microsoft Edge](https://microsoftedge.microsoft.com/addons/detail/hkdfdbpkmkpooopbkdghecbaipeoijpj).

## License

Licensed under [AGPL-3.0-only](./LICENSE). Commercial use is permitted subject to compliance with the license. Third-party components retain their own licenses.

## FAQ

### Mac installation issues

If macOS reports that the app is damaged or cannot be opened, see the [Mac installation troubleshooting guide](https://www.ncurator.com/en/manual#mac-download).

## Contributors

Thank you to everyone who contributes code, documentation, testing, and feedback to NCurator! The image below shows the repository's code contributors. Click it to see the full list.

[![Contributors](https://contrib.rocks/image?repo=Yoan98/Ncurator)](https://github.com/Yoan98/Ncurator/graphs/contributors)
