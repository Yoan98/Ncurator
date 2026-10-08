# Tool Design

工具契约与结果投递设计约束。涉及 `src/main/services/ai/human/**` 的 tool schema、modelResult 与 hand 投递逻辑时必读。

活例子按需生成（`pnpm doc:ai-tool-prompt-audit`，输出 `doc/ai-tool-prompt-audit.md`，不入库）；human 消息上下文见 `human-harness.md`；测试约束见 `doc/test-plan/ai-test.md`。

---

## 1. 设计原则

AI 通过工具操作本地环境。工具应像「手」：模型指定**位置（锚点）**和**意图（动作）**，工具执行并返回**下一步决策所需的最小可靠反馈**。工具契约（schema + 结果形态）是模型唯一能依赖的语义来源。

1. **锚点，非重建** — 读写通过稳定引用（nodeId、路径、行号等）定位；不要求模型一次生成深层结构树。
2. **读写分离、职责单一** — 发现用 read，变更用 write；同一领域少量工具 + `operation` 区分，不为小能力膨胀工具数。
3. **Schema 即契约** — 参数扁平、语义必填、字段带 describe；校验失败返回可修复错误，不做语义猜测。模型偶发把嵌套 object/array 再编码成 JSON 字符串时，brain 在 schema 校验前经统一的 `normalizeToolCallArgs` 展开（全工具单一入口），不改变业务校验语义。
4. **结果双通道** — 结构化结果是真相；面向模型的文本是投影，不承担 ID / 锚点解析职责。工具级成败只放在 `ToolCallResult.ok`（由返回 payload 是否含 `error` 推导）；工具 `return` 的领域 payload **不得**再带 `ok` / `success`。
5. **原子与可预期** — 一次调用一个 operation；成功或整次失败；同类输入语义稳定。
6. **描述声明边界，不教流程** — skill / tool 描述只说明能做什么、不能做什么；组合策略由模型自主决定。
7. **工具简单可理解** — 作者语言贴近模型对领域的心智模型，所用即所想。
8. **写回只给新锚点，验证靠再读** — 写工具只返回继续写所需的 id；对错由后续 read 确认，不返回变更清单或整页 readback。
9. **非必要字段不要设计** — 结构化 output 不回显入参已有字段（如 `sourcePath`）；只保留模型继续决策所需的最小字段。

---

## 2. 描述分层

| 层                                            | 写什么                               | 不写什么                                   |
| --------------------------------------------- | ------------------------------------ | ------------------------------------------ |
| `skill.description`                           | 该 skill 覆盖的能力域                | 工具调用顺序、跨工具编排                   |
| `tool promptSpec.description`                 | 单工具能力边界与限制                 | 字段表、JSON 结构、跨工具下一步、先 A 后 B |
| `inputSchema` 字段 `.describe()`              | 参数语义、单位、缺省、格式、数量上限 | —                                          |
| `toolSchemas` / `outputTypes.ts` 输出 TS 类型 | 结构化结果字段语义（内部真相）       | 不在 `promptSpec` 重复；不暴露给模型       |

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

brain 在 schema 校验失败后允许做一次受 schema 约束的基础类型修复：只有 issue 明确指出目标字段期望
`boolean`，且实际值是字符串 `true` / `false`（允许首尾空格和大小写差异）时，才转换为真正的
boolean 并重新校验。修复成功后按正常工具调用执行，不产生校验错误反馈；其他字符串、数字和语义值不做猜测，
仍按原 schema 错误处理。修复规则集中在共享参数层，工具不单独实现类型兜底。

### 4.2 节点自有校验

| 工具          | brain schema 校验       | 校验方                          |
| ------------- | ----------------------- | ------------------------------- |
| `learn_skill` | **跳过**                | `learning` 节点                 |
| `update_plan` | **跳过**                | `plan` 节点                     |
| 其余          | `inputSchema.safeParse` | brain → 失败写 ToolMessage 反馈 |

跳过 schema 的工具仍走 `normalizeToolCallArgs`。

---

## 5. 统一结果投递

工具执行 → 结构化 `ToolCallResult` → `modelResult.render*` → `renderedText` → **整段文本**统一判断：

| 条件                                   | 行为                                                                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| > 51,200 UTF-8 bytes **或** > 2,000 行 | `ok: false`，提示缩小范围                                                                                              |
| 否则 > 32,000 字符                     | 全文落盘 `userData/partners/{id}/runtime/toolresult/<runId>/` 目录，返回 head/tail 预览 + 路径 + `text_file_read` 指引 |
| 否则                                   | 整段直出 ToolMessage                                                                                                   |

实现：`buildModelToolResultDelivery`（`shared/modelToolResult.ts`）。
预览常量：`HEAD=6000` chars，`TAIL=2000` chars。

### 5.1 生产者有界读取（非 delivery 管道）

以下限制在**工具执行层**，不属于上述三档阈值：

| 类型                    | 默认上限                       |
| ----------------------- | ------------------------------ |
| 搜索类 match            | 10 条                          |
| `text_file_read`        | `startLine` / `lineCount` 分页 |
| docx / ppt / pdf search | 各域 constants                 |

Terminal：`terminal_read` 输出上限与 inline 字符预算挂钩（见 terminal 工具 spec）。

---

## 6. 渲染格式族

每个工具保留独立 `renderSuccess`，内部复用 `renderFamilies/` 共享块：

| 族                    | 典型工具                                         | 格式要点                                              |
| --------------------- | ------------------------------------------------ | ----------------------------------------------------- |
| **A** 纯 prose        | 各类 edit / mutation                             | 单行确认，如文件已更新                                |
| **B** XML envelope    | `text_file_read`、`pdf_read_pages`、`read_image` | `<file path="…">` + 行号或正文                        |
| **C** 终端流 + marker | `terminal_run`、`terminal_read`                  | 输出正文 + `[status: …]` 等方括号标记                 |
| **D** 分组纯文本      | search / list / outline；`web_search`（search）  | 标题 + 分组列表；SERP 用 rank / title / url / snippet |
| **E** Markdown/Web    | `web_search`（fetch）、`browser_use`（extract）  | 不可信内容前缀 + Markdown 正文                        |

### 6.1 控制类工具

| 工具                | 渲染要点                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `learn_skill`       | 由 `learning` 节点直接写 ToolMessage（loaded / duplicate / unknown / evicted 摘要），不走 `buildModelToolResultDelivery` |
| `update_plan`       | 由 `plan` 节点直接写 ToolMessage（计划项列表 `[status] title`），不走 `buildModelToolResultDelivery`                     |
| `read_image`        | 路径列表 + 尺寸；`images[]` 进 log 供多模态（human-harness 第 3.5 节）                                                   |
| `ask_user_question` | 只询问会改变执行结果的信息；每次调用包含 1 至 3 个问题，选项具体互斥，用户始终可选择“其他，请填写”；                     |

### 6.2 写工具输出

写成功多为 **A** 或 `{}`（excel 写回不返回系统锚点）；**不**返回 diff 全文——模型应再 read 验证。

### 6.3 PPT 表格写入

PPT 表格创建及 `update_table` 支持 `columnWidths`、`rowHeights`、`fontSize`、`fontFamily`。尺寸单位为 pt，数组数量必须匹配网格，总和必须匹配表格边界。创建明确写入默认 18pt；布局更新可单独调用，文字更新保留字体。新增或更新表格在保存前按实际 SVG 字形检查溢出，失败提示调整空间、字号或文字；工具不自动缩字或扩大表格。

### 6.4 Terminal 契约

- `status`: `running | succeeded | failed | cancelled`
- `terminal_run` 返回 `terminalId`；`terminal_read` 不回传 id（用 session 上下文）

---

## 7. 执行与 hand 节点

```text
hand 收到 call batch
  → terminal_run 副作用规则判断（未命中则默认通过）
  → 命中项由本次主模型做一次结构化 AI 审核（传入用户原话、用户默认工作区目录、平台、终端默认启动目录和命令）
  → AI 未自动通过的项进入人工批量审批（整批执行前）
  → 执行 tool runtime
  → buildModelToolResultDelivery
  → append ToolMessage + log tool
  → 同一 assistant 的全部 tool 结果齐全后：append 多模态 HumanMessage
  → context_budget
```

- 工具失败：`renderError` 或通用错误 → `ok: false` ToolMessage。
- 图片 ref 写入 log `tool.images[]`，不进 ToolMessage 正文。

---

### 一次性派发与资源范围

`delegate_to_subagent` 属于内置 `agent-control`，输入 `tasks` 非空，数量不设上限，每项包含最多八字符的 `name` 和 `task`（子任务描述）。工具内部通过父运行 FIFO 队列调用公共 AiRunService，执行并发由 `SUBAGENT_EXECUTION_CONCURRENCY` 控制（默认 2），超出排队，排队时不创建完整运行实例；输出只包含任务状态、精简结果、依据与产物路径，继续走现有 modelResult / 大小守卫。

主子运行工具策略与执行链相同；子运行额外禁用再次派发、用户提问、定时任务管理。学习工具后策略仍生效；人工审批交回主伙伴。

浏览器以执行范围隔离标签、发现和 CDP 客户端。CDP 桥使用 Chromium 的真实 Target ID，保持与主 Frame 的身份一致；后台创建不影响用户展示状态，后台标签保存基于伙伴最新界面状态，避免旧快照覆盖选择与折叠。控制释放后标签保留给主伙伴；先释放后台视图，光标视觉清理跳过空白页面并限制等待时间，不阻塞任务收口。sidecar 搜索和抓取统一 FIFO 串行，排队可取消且不计入提交后的执行超时；取消已提交请求不提前释放位置或杀死共享进程。sidecar 进程重新连接时复位隔离页面标记，供客户端重新定位。

受控文件记录从写入时使用 ownerRunId，相同路径复用记录和首次基线；Office 工作态覆盖读取到提交的排他范围。工具执行仅保存确认工作版本，主 run 真正收尾统一生成自包含审核；续接共用 ownerRunId。终态完成记录保存后清理工作快照，保留原始对象与审核。子交付只汇总参与的文件，主交付汇总整个主 run。

## 8. 与测试 / 生成文档的关系

| 文档 / 测试                                  | 职责                                                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 本文                                         | 设计原则与管道约束                                                                                    |
| `doc/ai-tool-prompt-audit.md`                | 各工具 input/output/渲染活例子（按需生成，不入库）                                                    |
| `doc/test-plan/ai-test.md`                   | tool / human 回归范围与 Oracle                                                                        |
| `tests/case/unit/ai/*-tool-contract.test.ts` | 已有 family 的轻量契约（schema + renderSuccess 存在性；覆盖 docx / pdf / ppt / text-file / terminal） |
| `tests/case/ai/tool/**`                      | 领域工具行为与 terminal 契约                                                                          |

新增工具检查清单：

1. 注册进 `ALL_TOOL_SPECS` 且 `renderSuccess` 已实现；
2. `inputSchema` 字段 describe 完整；
3. `promptSpec.description` 不教流程；
4. 必要时补充 family 契约测试与 audit 文档条目。

---

## 附录：关键代码索引

| Concern     | 路径                                                                               |
| ----------- | ---------------------------------------------------------------------------------- |
| Registry    | `src/main/services/ai/human/tools/registry.ts`                                     |
| 类型        | `src/main/services/ai/human/tools/types.ts`                                        |
| 投递管道    | `src/main/services/ai/human/shared/modelToolResult.ts`                             |
| 阈值 / 落盘 | `src/main/services/ai/human/shared/toolResultPersistence.ts`                       |
| 参数展开    | `src/main/services/ai/human/shared/toolArgsNormalize.ts`                           |
| 渲染族      | `src/main/services/ai/human/shared/modelToolResultRenderers.ts`、`renderFamilies/` |
| hand 执行   | `src/main/services/ai/human/node/handNode/index.ts`                                |
