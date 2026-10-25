# Tool Design

## 1. 设计原则

AI 通过工具操作本地环境。工具应像「手」：模型指定**位置（锚点）**和**意图（动作）**，工具执行并返回**下一步决策所需的最小可靠反馈**。工具契约（schema + 结果形态）是模型唯一能依赖的语义来源。

1. **锚点，非重建** — 读写通过稳定引用（nodeId、路径、行号等）定位；不要求模型一次生成深层结构树。
2. **读写分离、职责单一** — 发现用 read，变更用 write；同一领域少量工具 + `operation` 区分，不为小能力膨胀工具数。
3. **Schema 即契约** — 参数扁平、语义必填、字段带 describe；校验失败返回可修复错误，不做语义猜测。模型偶发把嵌套 object/array 再编码成 JSON 字符串时，brain 在 schema 校验前经统一的 `normalizeToolCallArgs` 展开（全工具单一入口），不改变业务校验语义。
4. **结果双通道** — 结构化结果是真相；面向模型的文本是投影，不承担 ID / 锚点解析职责。工具级成败只放在 `ToolCallResult.ok`（由返回 payload 是否含 `error` 推导）；工具 `return` 的领域 payload **不得**再带 `ok` / `success`。
5. **原子与可预期** — 一次调用一个 operation；成功或整次失败；同类输入语义稳定。
6. **描述声明边界，不教流程** — toolset / tool 描述只说明能做什么、不能做什么；组合策略由模型自主决定。
7. **工具简单可理解** — 作者语言贴近模型对领域的心智模型，所用即所想。
8. **写回只给新锚点，验证靠再读** — 写工具只返回继续写所需的 id；对错由后续 read 确认，不返回变更清单或整页 readback。
9. **非必要字段不要设计** — 结构化 output 不回显入参已有字段（如 `sourcePath`）；只保留模型继续决策所需的最小字段。

---

## 2. 描述分层

| 层                                            | 写什么                               | 不写什么                                   |
| --------------------------------------------- | ------------------------------------ | ------------------------------------------ |
| `toolset.description` | 该工具包覆盖的能力域 | 工具调用顺序、跨工具编排 |
| Skill 的 `name` / `description` | 用户说明适用场景，供按需发现 | 不自动注册工具或扩大权限 |
| `tool promptSpec.description`                 | 单工具能力边界与限制                 | 字段表、JSON 结构、跨工具下一步、先 A 后 B |
| `inputSchema` 字段 `.describe()`              | 参数语义、单位、缺省、格式、数量上限 | —                                          |
| `toolSchemas` / `outputTypes.ts` 输出 TS 类型 | 结构化结果字段语义（内部真相）       | 不在 `promptSpec` 重复；不暴露给模型       |

模型可见契约 = `promptSpec` + `inputSchema`（经 LangChain bindTools 暴露）。内部 TS 输出类型供执行层与契约测试，不经 prompt 暴露。

用户共享 Skill 是说明文件资产，不是 `HumanToolSpec` 或注册工具包。`load_toolset({ toolsetNames: string[] })` 按稳定名称启用预注册工具包，`load_skill({ skillNames: string[] })` 按唯一名称加载当前有效绑定的说明。两个入口均使用各自 System 目录提供的名称；工具包名称沿用 `docx-read` 等注册键，与内部工具包 ID 同值，不另建映射，也不使用 UI 显示名。内部 ID 用于缓存、状态和恢复，工具预算和 FIFO 淘汰仅针对工具包。用户说明不能新增工具、自动执行脚本、加载依赖或扩大权限。技能目录仅展示名称与简介，已加载正文使用带 name / resourceBase 元数据的独立 skill 块，统一排在 System 末尾的工具组之后。加载反馈持久化名称 / 状态；正文和资源基址仅投递到每轮重建的当前说明区，不重复写入历史 tool 消息，避免压缩或恢复复活失效指令。当前绑定重校验、64 KiB 正文总预算、恢复和缓存取舍见 [Human Harness](human-harness.md#72-load_toolset-流程)。

---

## 3. HumanToolSpec 结构

```text
Toolset（builtin / external）
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
  toolsetIds[],              // 归属工具包
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

单工具完整输入、输出与渲染例子由契约源码维护，使用 `pnpm doc:ai-tool-prompt-audit` 按需生成对照，生成产物不入库。

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
| `load_toolset` / `load_skill` | `inputSchema.safeParse`（strict） | brain；节点分别解析工具组名称与技能名称 |
| `update_plan` | **跳过**                | `plan` 节点                     |
| 其余          | `inputSchema.safeParse` | brain → 失败写 ToolMessage 反馈 |

跳过 schema 的工具仍走 `normalizeToolCallArgs`。

---

## 5. 统一结果投递

工具执行 → 结构化 `ToolCallResult` → `modelResult.render*` → `renderedText`；成功结果的**整段文本**按以下规则处理，失败结果经错误渲染后直接投递：

| 条件                                   | 行为                                                                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| > 51,200 UTF-8 bytes **或** > 2,000 行 | `ok: false`，提示缩小范围                                                                                              |
| 否则 > 32,000 字符                     | 全文落盘 `userData/partners/{id}/runtime/toolresult/<runId>/` 目录，返回 head/tail 预览 + 路径 + `text_file_read` 指引 |
| 否则                                   | 整段直出 ToolMessage                                                                                                   |

实现：`buildModelToolResultDelivery`（`shared/modelToolResult.ts`）。
预览常量：`HEAD=6000` chars，`TAIL=2000` chars。

### 5.1 生产者有界读取

搜索、列表和文件读取在工具执行层限制结果范围，通过分页或数量上限控制单次返回；参数和缺省值由各工具 schema 维护。生产者有界读取与上述 delivery 大小守卫分别生效。

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
| `load_toolset` | 由 `toolset_loading` 节点直接写 ToolMessage（loaded / duplicate / unknown / evicted 摘要），不走 `buildModelToolResultDelivery` |
| `load_skill` | 由 `skill_loading` 节点反馈名称 / 状态，当前正文由 System 说明区提供，不写入历史 tool 消息 |
| `update_plan`       | 由 `plan` 节点直接写 ToolMessage（计划项列表 `[status] title`），不走 `buildModelToolResultDelivery`                     |
| `read_image`        | 路径列表 + 尺寸；`images[]` 进 log 供多模态（human-harness 第 3.5 节）                                                   |
| `ask_user_question` | 用户协作结果使用问题／选项 ID 与用户文字，不依赖显示编号                                                                 |

### 6.2 写工具输出

写成功使用简短确认或继续操作所需的新锚点，不返回 diff 全文；模型通过 read 验证。

## 7. 执行与 hand 节点

```text
hand 收到 call batch
  → terminal_run 副作用规则判断（未命中则默认通过）
  → 命中项由本次主模型做一次结构化 AI 审核（传入本次任务、用户默认工作区目录、平台、终端默认启动目录和 commandId + command）
  → AI 未自动通过的项进入人工批量审批（整批执行前）
  → 执行 tool runtime
  → buildModelToolResultDelivery
  → append ToolMessage + log tool
  → 同一 assistant 的全部 tool 结果齐全后：append 多模态 HumanMessage
  → dispatch 继续消费调用队列
  → 队列清空后进入 context_budget
```

- 工具失败：`renderError` 或通用错误 → `ok: false` ToolMessage。
- 图片 ref 写入 log `tool.images[]`，不进 ToolMessage 正文。

---

### 7.1 子任务与审批

主子共用工具链和审核，子任务的能力限制在执行层持续生效，不因学习技能而解除。人工决定返回原执行位置，待审操作在允许前不执行。子会话的派发、续接与生命周期见 [Human Harness](human-harness.md#17-子会话与派发)。

子任务交付走公共 modelResult 和大小守卫；各工具参数由 schema 维护。

### 7.2 执行资源范围

- 浏览器标签发现与操作限定当前执行范围，以真实 Target ID 定位；控制释放后标签归主伙伴。导航、检查响应取消，恢复与清理有时限，避免后续调用无限排队。
- sidecar 搜索与抓取共用 FIFO 串行队列；排队可取消且不计入执行超时。已提交请求取消后仍占位到完成或超时，不关闭共享进程。
- 受控文件按 ownerRunId 归属主运行，Office 工作态持排他租约。版本、备份与审核的保留清理见 [存储设计](../storage/design.md#5-生命周期与一致性)。

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
