# Tool Design

工具契约与结果投递设计约束。涉及 `src/main/services/ai/human/tools/**` 的 schema、modelResult、投递逻辑时必读。

活例子按需生成（`pnpm doc:ai-tool-prompt-audit`，输出 `doc/ai-tool-prompt-audit.md`，不入库）；human 消息上下文见 `human-harness.md`；测试约束见 `doc/test-plan/ai-test.md`。

---

## 1. 设计原则

AI 通过工具操作本地环境。工具应像「手」：模型指定**位置（锚点）**和**意图（动作）**，工具执行并返回**下一步决策所需的最小可靠反馈**。工具契约（schema + 结果形态）是模型唯一能依赖的语义来源。

1. **锚点，非重建** — 读写通过稳定引用（nodeId、路径、行号等）定位；不要求模型一次生成深层结构树。
2. **读写分离、职责单一** — 发现用 read，变更用 write；同一领域少量工具 + `operation` 区分，不为小能力膨胀工具数。
3. **Schema 即契约** — 参数扁平、语义必填、字段带 describe；校验失败返回可修复错误，不静默改写。模型偶发把嵌套 object/array 再编码成 JSON 字符串时，brain 在 schema 校验前经统一的 `normalizeToolCallArgs` 展开（全工具单一入口），不改变业务校验语义。
4. **结果双通道** — 结构化结果是真相；面向模型的文本是投影，不承担 ID / 锚点解析职责。工具级成败只放在 `ToolCallResult.ok`（由返回 payload 是否含 `error` 推导）；工具 `return` 的领域 payload **不得**再带 `ok` / `success`。
5. **原子与可预期** — 一次调用一个 operation；成功或整次失败；同类输入语义稳定。
6. **描述声明边界，不教流程** — skill / tool 描述只说明能做什么、不能做什么；组合策略由模型自主决定。
7. **工具简单可理解** — 作者语言贴近模型对领域的心智模型，所用即所想。
8. **写回只给新锚点，验证靠再读** — 写工具只返回继续写所需的 id；对错由后续 read 确认，不返回变更清单或整页 readback。
9. **非必要字段不要设计** — 结构化 output 不回显入参已有字段（如 `sourcePath`）；只保留模型继续决策所需的最小字段。

---

## 2. 描述分层

| 层 | 写什么 | 不写什么 |
| --- | --- | --- |
| `skill.description` | 该 skill 覆盖的能力域 | 工具调用顺序、跨工具编排 |
| `tool promptSpec.description` | 单工具能力边界与限制 | 字段表、JSON 结构、跨工具下一步、先 A 后 B |
| `inputSchema` 字段 `.describe()` | 参数语义、单位、缺省、格式、数量上限 | — |
| `toolSchemas` / `outputTypes.ts` 输出 TS 类型 | 结构化结果字段语义（内部真相） | 不在 `promptSpec` 重复；不暴露给模型 |

模型可见契约 = `promptSpec` + `inputSchema`（经 LangChain bindTools 暴露）。内部 TS 输出类型供执行层与契约测试，不经 prompt 暴露。

---

## 3. HumanToolSpec 结构

```text
Skill（builtin / external）
  └─ Tool（HumanToolSpec）
       ├─ inputSchema                  参数校验 + 模型可见输入契约
       ├─ toolSchemas / outputTypes    结构化真相（TS + 契约测试）
       ├─ promptSpec                   暴露给模型的最小契约
       └─ modelResult                  投影为模型可读文本，再走统一投递管道
```

```typescript
HumanToolSpec = {
  name,                    // RuntimeToolName
  familyId,                // AiToolFamilyId
  skillIds[],              // 归属 skill
  inputSchema,             // zod
  promptSpec,              // { name, description }
  resolveExecutionMeta,    // mutability / resourceKey（审批、并发）
  modelResult: {
    renderSuccess,
    renderError?           // 缺省走通用错误渲染
  }
}
```

**registry 完整性**：`ALL_TOOL_SPECS` 须覆盖全部 `RuntimeToolName`；编译期 `MissingToolSpecName extends never` 断言。每个工具必须提供 `modelResult.renderSuccess`。

**family 组织**：docx / pdf / ppt / excel / text-file / kb / web / terminal / image-generation / agent-control 等；`getToolSpec(name, platform?)` 为唯一查表入口（terminal_run 可按平台变体）。

---

## 4. 参数规范化

### 4.1 normalizeToolCallArgs

brain 在 hand 前、schema 校验前，对**全部** tool call 统一调用：

- 递归展开「被 JSON 字符串化的 object/array」（最多 3 层 unwrap）；
- 普通 prose、路径、非容器标量**不改写**；
- 开放括号不完整的 fragment 不强行 jsonrepair。

### 4.2 节点自有校验

| 工具 | brain schema 校验 | 校验方 |
|------|-------------------|--------|
| `learn_skill` | **跳过** | `learning` 节点 |
| `update_plan` | **跳过** | `plan` 节点 |
| 其余 | `inputSchema.safeParse` | brain → 失败写 ToolMessage 反馈 |

跳过 schema 的工具仍走 `normalizeToolCallArgs`。

---

## 5. 统一结果投递

工具执行 → 结构化 `ToolCallResult` → `modelResult.render*` → `renderedText` → **整段文本**统一判断：

| 条件 | 行为 |
|------|------|
| > 51,200 UTF-8 bytes **或** > 2,000 行 | `ok: false`，提示缩小范围 |
| 否则 > 32,000 字符 | 全文落盘 workspace tool-result 目录，返回 head/tail 预览 + 路径 + `text_file_read` 指引 |
| 否则 | 整段直出 ToolMessage |

实现：`buildModelToolResultDelivery`（`shared/modelToolResult.ts`）。
预览常量：`HEAD=6000` chars，`TAIL=2000` chars。

### 5.1 生产者有界读取（非 delivery 管道）

以下限制在**工具执行层**，不属于上述三档阈值：

| 类型 | 默认上限 |
|------|----------|
| 搜索类 match | 10 条 |
| `text_file_read` | `startLine` / `lineCount` 分页 |
| docx / ppt / pdf search | 各域 constants |

Terminal：`terminal_read` 输出上限与 inline 字符预算挂钩（见 terminal 工具 spec）。

---

## 6. 渲染格式族

每个工具保留独立 `renderSuccess`，内部复用 `renderFamilies/` 共享块：

| 族 | 典型工具 | 格式要点 |
| --- | --- | --- |
| **A** 纯 prose | 各类 edit / mutation | 单行确认，如文件已更新 |
| **B** XML envelope | `text_file_read`、`pdf_read_pages`、`read_image` | `<file path="…">` + 行号或正文 |
| **C** 终端流 + marker | `terminal_run`、`terminal_read` | 输出正文 + `[status: …]` 等方括号标记 |
| **D** 分组纯文本 | search / list / outline；`web_search`（search） | 标题 + 分组列表；SERP 用 rank / title / url / snippet |
| **E** Markdown/Web | `web_search`（fetch）、`browser_use`（extract） | 不可信内容前缀 + Markdown 正文 |

`browser_use` 其它动作（navigate / list_tabs / observe / act / screenshot）走 prose 列表渲染：一律回传 `tabId`（list_tabs 除外）；observe 候选透传 `actionId/method/description/arguments/selector`；act 仅接受 `actionId` 并确定性回放 Stagehand Action。

领域专用（`docx_read_nodes`、`excel_read`、`ppt_read_slides` 等）复用 **D** 分组布局，保留领域字段。

### 6.1 控制类工具

| 工具 | 渲染要点 |
|------|----------|
| `learn_skill` | loaded / duplicate / unknown / evicted 摘要 |
| `update_plan` | 计划项列表 `[status] title` |
| `read_image` | 路径列表 + 尺寸；`images[]` 进 log 供多模态（human-harness 第 3.5 节） |

### 6.2 写工具输出

写成功多为 **A** 或 `{}`（excel 写回当前无系统锚点）；**不**返回 diff 全文——模型应再 read 验证。

### 6.3 Terminal 契约

- `status`: `running | succeeded | failed | cancelled`
- `terminal_run` 返回 `terminalId`；`terminal_read` 不回传 id（用 session 上下文）

---

## 7. 执行与 hand 节点

```text
hand 收到 call batch
  → resolveExecutionMeta（mutability / resourceKey）
  → 审批门禁（mutating + 策略）
  → 执行 tool runtime
  → buildModelToolResultDelivery
  → append ToolMessage + log tool
  → read_image 等：append 多模态 HumanMessage
  → context_budget
```

- **mutating** 工具可触发批量审批；拒绝写失败 `tool`，不执行。
- 工具失败：`renderError` 或通用错误 → `ok: false` ToolMessage。
- 图片 ref 写入 log `tool.images[]`，不进 ToolMessage 正文。

---

## 8. 与测试 / 生成文档的关系

| 文档 / 测试 | 职责 |
|-------------|------|
| 本文 | 设计原则与管道约束 |
| `doc/ai-tool-prompt-audit.md` | 各工具 input/output/渲染活例子（按需生成，不入库） |
| `doc/test-plan/ai-test.md` | tool / human 回归范围与 Oracle |
| `tests/case/unit/ai/*-tool-contract.test.ts` | 按 family 轻量契约（schema + renderSuccess 存在性） |
| `tests/case/ai/tool/**` | 领域工具行为与 terminal 契约 |

新增工具检查清单：

1. 注册进 `ALL_TOOL_SPECS` 且 `renderSuccess` 已实现；
2. `inputSchema` 字段 describe 完整；
3. `promptSpec.description` 不教流程；
4. 必要时补充 family 契约测试与 audit 文档条目。

---

## 附录：关键代码索引

| Concern | 路径 |
|---------|------|
| Registry | `src/main/services/ai/human/tools/registry.ts` |
| 类型 | `src/main/services/ai/human/tools/types.ts` |
| 投递管道 | `src/main/services/ai/human/shared/modelToolResult.ts` |
| 阈值 / 落盘 | `src/main/services/ai/human/shared/toolResultPersistence.ts` |
| 参数展开 | `src/main/services/ai/human/shared/toolArgsNormalize.ts` |
| 渲染族 | `src/main/services/ai/human/shared/modelToolResultRenderers.ts`、`renderFamilies/` |
| hand 执行 | `src/main/services/ai/human/node/handNode/index.ts` |
