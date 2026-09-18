# Showcase 样例采集计划

## 1. 定位

Showcase 是官网样例采集任务，不是产品回归、E2E 回归或发布门禁。它只通过 `pnpm test:showcase` 显式执行，不被 `pnpm test:e2e:*`、Workbench 回归命令或发布命令发现。

采集使用真实 Electron UI、真实 AI 和真实文件处理链路，目的是产出可审核的截图、样例文件和用量记录；采集失败不改变产品回归范围。

## 2. 目录与命令

采集文件位于：

```text
tests/showcase/
  <case>.showcase.test.ts
  createSeeds.ts
  shared.ts
```

运行全部采集任务：

```bash
pnpm test:showcase
```

只运行指定任务：

```bash
pnpm test:showcase -- --case <caseId>
```

运行日志写入 `tests/logs/showcase/collection/<caseId>/`，官网导出文件写入 `tests/logs/showcase/export/<caseId>/`。

## 3. 共同约束

- 每个任务必须创建隔离临时工作区，结束后清理。
- 必须通过真实 Settings / Workbench UI 配置模型、创建伙伴和发送请求；不使用 fake AI、fake 工具结果或直接写入产品状态。
- 新建样例可以把结果复制为 fixture；编辑样例必须复用已有过关 fixture，不能临时新建文件凑截图。
- 每个任务记录截图、样例文件、模型、耗时和实际用量。
- Showcase 不参与日常 E2E、正式包 E2E 或发布回归的默认发现；需要正式回归的产品能力必须另有 `tests/case/**` 回归 case。

## 4. 采集任务

### `docx-weekly-report`

- What：根据站会纪要、客户风险和财务草稿生成管理层 Word 周报。
- How：真实 AI 写入 `云枢智服-9月第2周经营周报.docx`，截审核态和预览态。
- Oracle：Word 可解析并包含进展、风险、下周计划；至少有一张审核图和一张预览图，并记录用量。

### `docx-weekly-report-edit`

- What：修改已有周报，采集审核态绿增红删。
- How：必须使用过关 Word fixture，发送风险排序和负责人补充请求，截 `.docx-content`。
- Oracle：产生真实 Word 修改记录和非零修改；至少有一张审核图，并记录用量。

### `excel-budget`

- What：从空工作区生成部门明细和汇总表组成的 9 月费用预算。
- How：真实 AI 写入 `云枢智服-9月费用预算.xlsx`，按工作表截审核态和预览态。
- Oracle：xlsx 可解析且至少两张表；至少有一张审核图和一张预览图，并记录用量。

### `excel-budget-edit`

- What：修改已有费用预算，采集审核态红绿框。
- How：必须使用过关 Excel fixture，压低品牌推广金额并补充已发生列，截数据区域。
- Oracle：文件包含已发生列和目标金额，存在非零修改，并记录用量。

### `ppt-management-briefing-review`

- What：从空工作区生成管理层经营简报，采集新增页面审核态。
- How：真实 AI 创建 16:9 PPT，按缩略图截 `pptDiffAfter`。
- Oracle：PPTX 写回且至少有一张审核图，并记录用量。

### `ppt-management-briefing-edit`

- What：修改已有经营复盘，采集修改前后对照。
- How：必须使用过关 PPT fixture，修改封面和未达标 KPI，截审核态整块 diff。
- Oracle：出现修改前后画布和至少一张审核图，并记录用量。

### `xinghe-service-contract`

- What：引用星河服务合同 PDF，回答尾款支付时间，采集原文页和回答。
- How：只读引用 PDF，不改原件；渲染合同页并截最终回答。
- Oracle：回答包含终验/验收后十个工作日；原件 bytes 不变；至少有两张原文图和一张回答图。

### `xinghe-kb-reply`

- What：根据本地星河资料回复交付承诺和验收口径。
- How：准备星河资料和清和干扰资料，完成真实索引后不使用 `@` 文件名直接提问；截资料页和最终回答。
- Oracle：使用本地知识库工具，不调用浏览器或网页搜索；回答包含 95% 承诺及验收 / P1 / 7 天依据。

### `court-typical-cases`

- What：用内置浏览器检索最高人民法院建设工程典型案例。
- How：真实 AI 驱动内置浏览器，采集空白检索、已填词、结果三帧及最终回答。
- Oracle：调用 `browser_use`；三类浏览器帧完整；回答涉及工程款、结算、违约或典型案例。

### `chailv-tax-deduction`

- What：搜索企业员工国内差旅住宿和交通税前扣除口径。
- How：不指定网站，真实 AI 使用网页搜索，截带来源的最终回答。
- Oracle：调用 `web_search`；回答包含住宿或交通、税前扣除和来源依据。
