# NCurator-Desktop AI 完整样例

本文不描述理想方案，而是按当前代码实现，模拟两条真实可发生的 run：

- 样例 A：复杂路径，覆盖 `director_context_human`、`director_plan`、`director_plan_exec`、`director_synthesis_human`
- 样例 B：默认路径，覆盖 `director_direct_human_exec`

本文里的字段名、节点名、交付模式、状态转移与代码保持一致；示例中的模型结构化输出、工具结果和 markdown 内容是“符合当前契约的一组代表性样本”，不是固定字面值。

## 1. 先看三个总原则

### 1.1 真实运行入口

- run 入口：`src/main/services/ai/AiRunService.ts`
- `director` graph：`src/main/services/ai/director/graph/directorGraph.ts`
- `human` graph：`src/main/services/ai/human/graph/humanGraph.ts`

### 1.2 真正跨层传递的不是 `HumanState`

`director` 不直接读写 `HumanState`。跨层只看三类数据：

1. `contextEvidence`
2. `plan[].deliveryMarkdown / plan[].artifacts`
3. `HumanTaskOutput`

这意味着每次 `human` 子任务都是一个新的局部闭环，内部状态不会直接继承上一个 `human` 的 `HumanState`。

### 1.3 `deliveryMode` 只改变 `mouth` 怎么交付

- `context_note`：给 `director_context_human`
- `task_handoff`：给 `director_plan_exec`
- `user_answer`：给 `director_direct_human_exec` 和 `director_synthesis_human`

它不改变 `brain / learning / hand` 的职责，只改变最终 `mouth` 的输出形态，以及部分事件是否带 `internal=true`。

## 2. 样例 A：复杂请求完整跑一遍

### 2.1 用户请求

假设用户这轮输入是：

> 请把 Alpha PRD 的最新 docx 按上周评审意见和当前发布模板修好，统一术语、补充发布日期说明，生成预览并保存到 `docs/output/PRD-Alpha-reviewed.docx`，最后告诉我改了什么和还需要人工确认什么。

运行前提：

- 已绑定 workspace
- 已选本地参考资料，包含 Alpha PRD 所在目录和两份知识文档
- 会话里没有足够明确的“最新 docx 是哪一份”“上周评审意见具体指什么”

为了便于阅读，下文把 `ctx.referenceScope` 在 prompt 中渲染后的参考资料上下文近似理解成：

```text
当前工作区：Alpha Workspace（本地工作目录），后续本地文件路径都相对于这个工作区理解。

参考资料类型说明：
- 本地目录：工作区中的目录，可用于限定文件范围。
- 本地文件：工作区中的具体文件。
- 网页资料：当前工作区中已收录的网页内容。
- 知识库可用性：
  - 已索引：可直接通过知识库检索。
  - 部分可检索：部分内容已索引，不能假设完整覆盖。
  - 未索引：不能直接依赖知识库检索。

当前用户选择：
1. [本地目录] docs/prd/Alpha
   名称：Alpha PRD
   知识库可用性：部分可检索
2. [网页资料] 品牌术语规范
   地址：https://example.com/brand-terms
   知识库可用性：已索引
3. [网页资料] 发布说明模板
   地址：https://example.com/release-template
   知识库可用性：已索引
```

### 2.2 初始 `AiRunState`

`AiRunService.run()` 会先创建初始 run state：

```ts
{
  runId: 'run-a',
  sessionId: 'session-a',
  status: 'running',
  input: '请把 Alpha PRD 的最新 docx 按上周评审意见和当前发布模板修好……',
  directorStage: 'director_intent',
  contextRounds: 0,
  contextEvidence: [],
  plan: [],
  dispatchCursor: 0,
  finalArtifacts: []
}
```

同时，运行时会把一段不进入 `HumanState` 的“用户选择的参考资料”文本注入给 `director` 和 `brain`，例如：

```text
当前工作区：Alpha Workspace（本地工作目录），后续本地文件路径都相对于这个工作区理解。

参考资料类型说明：
- 本地目录：工作区中的目录，可用于限定文件范围。
- 本地文件：工作区中的具体文件。
- 网页资料：当前工作区中已收录的网页内容。
- 知识库可用性：
  - 已索引：可直接通过知识库检索。
  - 部分可检索：部分内容已索引，不能假设完整覆盖。
  - 未索引：不能直接依赖知识库检索。

当前用户选择：
1. [本地目录] docs/prd/Alpha
   名称：Alpha PRD
   知识库可用性：部分可检索
2. [网页资料] 品牌术语规范
   地址：https://example.com/brand-terms
   知识库可用性：已索引
3. [网页资料] 发布说明模板
   地址：https://example.com/release-template
   知识库可用性：已索引
```

这里还没有任何 `human` 状态。`director` 先决定这轮是直接做、先补上下文，还是拆计划。

### 2.3 第 1 步：`director_intent` 首次路由

`director_intent` 真实会读取：

- `state.input`
- `state.contextRounds`
- `state.contextEvidence`
- `ctx.loadHistory()` 返回的会话摘要和最近对话
- `ctx.referenceScope` 渲染出的参考资料上下文

在这个样例里，模型可能给出这样的结构化结果：

```json
{
  "mode": "need_context",
  "reason": "用户说的是“最新 docx”和“上周评审意见”，但当前输入里没有唯一文件定位和可执行规则摘要，先补上下文更稳。"
}
```

于是 `director_intent` 返回 patch：

```ts
{
  contextObjective: '先确认目标 docx、上周评审意见来源，以及可直接复用的规则证据。',
  directorStage: 'director_context_human'
}
```

此时没有 final answer，也没有 plan。

### 2.4 第 2 步：`director_context_human`

`director_context_human` 会做三件事：

1. 生成 `taskId = context-1`
2. 用 `buildContextHumanObjective()` 组织新的 `userInput`
3. 派发一个新的 `human`

派发参数的关键点：

```ts
{
  taskId: 'context-1',
  deliveryMode: 'context_note',
  internalDelivery: true
}
```

这里的 `internalDelivery=true` 很关键，因为这不是给最终用户看的正式答复，而是给 `director` 回填上下文证据。

### 2.5 `context-1` 这个 `human` 是怎么跑的

每个 `human` 都从全新的 `HumanState` 开始：

```ts
{
  task: {
    taskId: 'context-1',
    userInput: '# 上下文补充任务 ...'
  },
  runtime: {
    stage: 'brain',
    status: 'running'
  },
  brainMemory: {
    inside: {
      facts: [],
      evidences: [],
      openQuestions: []
    },
    outside: {
      skillCatalog: [/* 全量 skill 摘要，初始化即存在 */],
      learnedSkillIds: [],
      brainDecisions: []
    }
  },
  runtimeArtifacts: [],
  trace: {
    steps: []
  }
}
```

#### 2.5.1 `brain` 第一次决策，先触发一次 `watchHint`

为了展示真实的纠偏逻辑，先模拟一个当前代码允许发生的场景：

- `brain` 想先写一个 fact
- 但这个 fact 引用了尚未存在的 `evidenceId`

例如模型输出：

```json
{
  "memoryOps": [
    {
      "op": "add",
      "field": "facts",
      "value": {
        "id": "fact-docx-target",
        "summary": "目标文档是 Alpha PRD 的最新 docx。",
        "evidenceIds": ["ev-docx-path"]
      }
    }
  ],
  "decision": {
    "summary": "需要先学习本地定位和文档读取能力。",
    "reason": "当前还没有证据支持目标文档定位。",
    "expectedOutcome": "拿到可执行的文件路径和规则来源。"
  },
  "nextAction": {
    "action": "learning",
    "wantLearnSkillIds": ["workspace-cli", "kb-document-discovery", "docx-read"]
  }
}
```

这份输出先经过 `reduceBrainMemory()`。因为 fact 依赖的 `ev-docx-path` 还不存在，`memoryReducer` 会返回：

```ts
{
  inside: /* 回退到原 inside */,
  watchHint: 'memoryReducer 检测到非法记忆编辑，已忽略对应操作，请重新判断下一步。'
}
```

于是这一次 `brain` 的真实结果是：

- `lastBrainDecision` 仍会被写入
- `brainDecisions` 追加一条历史
- `trace.steps` 追加一条 `brain_decision`
- `watchHint` 被写入
- `runtime.stage` 不去 `learning`，而是继续留在 `brain`

这就是 `applyBrainDecisionTransition()` 里的真实逻辑：一旦存在 `watchHint`，下一跳强制回到 `brain`。

#### 2.5.2 `brain` 第二次决策，进入 `learning`

第二轮 `brain` 读到 `watchHint` 后，会更谨慎，只先学能力，不抢先写 fact：

```json
{
  "memoryOps": [],
  "decision": {
    "summary": "先学习定位文件、文档读取和知识文档发现能力。",
    "reason": "当前目标是补上下文，不是直接求解。",
    "expectedOutcome": "确认目标 docx、评审意见来源和模板规则来源。"
  },
  "nextAction": {
    "action": "learning",
    "wantLearnSkillIds": ["workspace-cli", "kb-document-discovery", "docx-read"]
  }
}
```

`learning` 节点会：

- 校验 skill 是否存在
- 校验是否重复学习
- 把这些 skill 对应的 tools 装入 runtime cache
- 回写 `learnedSkillIds`
- 追加 `learn_skill` trace
- 返回 `brain`

这一步之后，`learnedSkillIds` 变成：

```ts
['workspace-cli', 'kb-document-discovery', 'docx-read']
```

但注意：

- `skillCatalog` 本来就有
- 真正决定“当前可调用哪些工具”的，是 `builtin + learned external` 形成的 effective skills，再结合 runtime cache

#### 2.5.3 `brain` 第三次决策，进入 `hand` 做第一批工具调用

这次 `brain` 可以发出一个合法的只读并行批次，例如：

```json
{
  "memoryOps": [],
  "decision": {
    "summary": "先列出候选文档和已选知识文档。",
    "reason": "需要先缩小目标文件和规则来源。",
    "expectedOutcome": "拿到最新 PRD 文档路径和可检索的规则文档。"
  },
  "nextAction": {
    "action": "hand",
    "toolUsePlan": {
      "mode": "parallel",
      "calls": [
        {
          "toolName": "terminal_run_command",
          "args": {
            "command": "find docs/prd -name '*Alpha*PRD*.docx' -maxdepth 2",
            "cwd": "/project-alpha"
          }
        },
        {
          "toolName": "kb_list_documents",
          "args": {
            "query": "Alpha 发布模板 评审意见 术语"
          }
        }
      ]
    }
  }
}
```

为什么这批工具可以并行：

- `terminal_run_command` 在这里是低风险只读命令
- `kb_list_documents` 是只读
- 两者都能通过 `validateParallelToolCalls()`

`hand` 会并行执行它们，并把结果写进：

- `lastToolUseResults`
- `processMemory.roundHistory`
- `trace.steps`

这一步还不会改 `brainMemory.inside`。工具结果先原样落在 `lastToolUseResults`，同时以标准化结果行进入 `roundHistory`，等下一轮 `brain` 再提炼成 evidences/facts。

如果某次工具失败，`lastToolUseResults` 里除了 `code/summary` 之外，还可能带有结构化 `diagnostic`。例如：

```json
{
  "toolName": "docx_apply_ops",
  "ok": false,
  "code": "invalid_input",
  "summary": "Invalid input at ops[0].type",
  "diagnostic": {
    "kind": "invalid_input",
    "missingArgs": ["type"]
  }
}
```

#### 2.5.4 `brain` 第四次决策，再做一批文档读取

上一轮工具结果回来后，`brain` 会把高价值信息提炼进 memory：

```json
{
  "memoryOps": [
    {
      "op": "add",
      "field": "evidences",
      "value": {
        "id": "ev-docx-candidates",
        "toolName": "terminal_run_command",
        "summary": "候选文档包含 docs/prd/Alpha/PRD-Alpha-v7.docx，且它是最近修改的版本。",
        "sourceType": "tool_result",
        "rawRef": "tool_result:terminal_run_command#1"
      }
    },
    {
      "op": "add",
      "field": "evidences",
      "value": {
        "id": "ev-kb-docs",
        "toolName": "kb_list_documents",
        "summary": "已选知识文档中可直接引用《品牌术语规范》和《发布说明模板》。",
        "sourceType": "tool_result",
        "rawRef": "tool_result:kb_list_documents#1"
      }
    },
    {
      "op": "add",
      "field": "facts",
      "value": {
        "id": "fact-target-docx",
        "summary": "当前最可能的目标文档是 docs/prd/Alpha/PRD-Alpha-v7.docx。",
        "evidenceIds": ["ev-docx-candidates"]
      }
    }
  ],
  "decision": {
    "summary": "继续打开并检查目标 docx 的结构。",
    "reason": "还需要确认发布日期说明和术语相关段落在哪里。",
    "expectedOutcome": "得到后续 planning 可复用的文档定位信息。"
  },
  "nextAction": {
    "action": "hand",
    "toolUsePlan": {
      "mode": "serial",
      "calls": [
        {
          "toolName": "docx_open",
          "args": {
            "sourcePath": "/project-alpha/docs/prd/Alpha/PRD-Alpha-v7.docx"
          }
        }
      ]
    }
  }
}
```

`docx_open` 结束后，下一轮 `brain` 会拿到一个 `docId`，然后再发第二批只读并行调用：

```json
{
  "nextAction": {
    "action": "hand",
    "toolUsePlan": {
      "mode": "parallel",
      "calls": [
        {
          "toolName": "docx_outline",
          "args": {
            "docId": "doc-alpha-v7"
          }
        },
        {
          "toolName": "docx_search",
          "args": {
            "docId": "doc-alpha-v7",
            "query": "发布日期 术语 品牌名",
            "mode": "literal"
          }
        }
      ]
    }
  }
}
```

#### 2.5.5 `brain` 最后转向 `mouth`

当 `brain` 认为上下文已经够用时，会把结论沉淀成：

- 已确认事实
- 可复用证据
- 未决项

然后进入 `mouth`，`deliveryMode=context_note`。

这次 `mouth` 的代表性交付可以是：

```md
# 上下文补充结果

## 本轮结论
已确认目标文档、两份规则来源和当前最可能需要修改的两个区域；发布日期最终值仍需结合最终发布窗口确认。

## 可复用证据
- 目标文档为 `docs/prd/Alpha/PRD-Alpha-v7.docx`，它是当前候选中最新修改版本。
- 已选知识范围内可直接引用《品牌术语规范》。
- 已选知识范围内可直接引用《发布说明模板》。
- 目标文档中已有“发布日期”说明段和多处品牌术语段落。

## 当前边界
- 当前已经能进入 planning 和执行阶段。
- 仍不能从现有输入中确认最终发布日期具体值。

## 未决项
- 最终发布日期是否已经由业务锁定。

## 建议补充方向
- planning 时把“读取目标 block”“提取规则”“执行 docx 修改与交付”拆开。
```

这时 `context-1` 的 `HumanTaskOutput` 大致是：

```ts
{
  taskId: 'context-1',
  status: 'completed',
  summary: '已确认目标文档和规则来源，但发布日期具体值仍待确认。',
  deliveryMarkdown: '...context note...',
  artifacts: undefined
}
```

### 2.6 `director_context_human` 回写了什么

`buildContextEnrichPatch()` 不会把整段 `context_note` 塞回 `DirectorState`。它只会：

1. 找到 `## 可复用证据`
2. 提取 bullet / numbered line
3. 去重后合并进 `contextEvidence`

所以 patch 类似：

```ts
{
  contextRounds: 1,
  contextEvidence: [
    '目标文档为 `docs/prd/Alpha/PRD-Alpha-v7.docx`，它是当前候选中最新修改版本。',
    '已选知识范围内可直接引用《品牌术语规范》。',
    '已选知识范围内可直接引用《发布说明模板》。',
    '目标文档中已有“发布日期”说明段和多处品牌术语段落。'
  ],
  contextObjective: undefined,
  directorStage: 'director_intent'
}
```

这一步非常关键：复杂路径里，`director` 和后续 `human` 真正复用的是 `contextEvidence`，不是整个 `context_note`。

### 2.7 第 3 步：`director_intent` 第二次路由

现在再次进入 `director_intent`。这次它看到：

- `contextRounds = 1`
- 已经有一组 `contextEvidence`
- 用户要求仍然是多动作、多产物的修改型任务

于是更可能返回：

```json
{
  "mode": "to_plan",
  "reason": "当前证据已足够，但任务仍包含读取、规则提取、文档修改、交付四类动作，适合拆成多个 human 闭环任务。"
}
```

patch：

```ts
{
  contextObjective: undefined,
  directorStage: 'director_plan'
}
```

### 2.8 第 4 步：`director_plan`

`director_plan` 会读取原始输入、历史、`contextEvidence`、由 `ctx.referenceScope` 渲染出的参考资料上下文，再生成任务列表。

在这个样例里，合法计划可以是：

```ts
[
  {
    id: 'task-1',
    title: '确认待改 block',
    userInput:
      '读取 docs/prd/Alpha/PRD-Alpha-v7.docx，定位与“发布日期说明”和品牌术语统一相关的 block，输出可直接修改的区块清单和当前文本。'
  },
  {
    id: 'task-2',
    title: '提取执行规则',
    userInput:
      '从已选知识范围中提取《品牌术语规范》和《发布说明模板》里与术语统一、发布日期说明相关的可执行规则，输出规则清单和引用证据。'
  },
  {
    id: 'task-3',
    title: '修改并产出文档交付物',
    userInput:
      '基于 task-1 的区块清单和 task-2 的规则，修改 docs/prd/Alpha/PRD-Alpha-v7.docx，生成预览，保存到 docs/output/PRD-Alpha-reviewed.docx，并说明仍需人工确认的内容。'
  }
]
```

通过 `validatePlannerTasks()` 后，`toPlanTasks()` 会回写：

```ts
{
  plan: [
    { id: 'task-1', title: '确认待改 block', userInput: '...', status: 'ready' },
    { id: 'task-2', title: '提取执行规则', userInput: '...', status: 'ready' },
    { id: 'task-3', title: '修改并产出文档交付物', userInput: '...', status: 'ready' }
  ],
  dispatchCursor: 0,
  directorStage: 'director_plan_exec'
}
```

### 2.9 第 5 步：`director_plan_exec` 执行 `task-1`

`pickPendingTaskIndex()` 先选到 `task-1`。`director_plan_exec` 会把它包装成 `task_handoff` 类型的 `human` 子任务。

#### 2.9.1 `task-1` 的 `human` 关键过程

这个 `human` 是全新的，不继承 `context-1` 的 `HumanState`。

典型闭环：

1. `brain` 决定学习 `docx-read`
2. `learning` 装入 `docx_open / docx_outline / docx_search / docx_get_block / docx_get_history`
3. `brain -> hand` 调用 `docx_open`
4. `brain -> hand` 并行调用 `docx_outline + docx_search`
5. `brain` 把 block 定位结果提炼成 `facts/evidences`
6. `brain -> mouth`
7. `mouth` 用 `deliveryMode=task_handoff` 输出交接文档

代表性 `deliveryMarkdown`：

```md
# 子任务交付

## 本任务结论
已定位两个需要修改的区域：发布日期说明段和品牌术语说明段。

## 已完成
- 已确认需修改 block 的位置和当前文本。

## 关键事实
- 发布日期说明位于“发布计划”章节下第 3 个 block。
- 品牌术语不一致问题主要集中在“产品介绍”章节。

## 关键证据
- docx_outline: 文档包含“产品介绍”“发布计划”等章节。
- docx_search: 搜索命中“发布日期”“品牌名”相关段落。

## 产物与引用
无

## 未决与风险
- 最终发布日期具体值仍需业务确认。

## 对后续任务的影响
- 后续修改任务可以直接对两个 block 动手，不需要再全量扫描文档。

## 建议下一步
- 结合知识规则，对上述两个 block 生成结构化修改操作。
```

#### 2.9.2 `director` 回写 `task-1`

`buildPlanExecPatch()` 只更新当前 task：

```ts
{
  plan: [
    {
      id: 'task-1',
      status: 'completed',
      deliveryMarkdown: '...task-1 handoff...',
      artifacts: undefined
    },
    { id: 'task-2', status: 'ready' },
    { id: 'task-3', status: 'ready' }
  ],
  dispatchCursor: 1,
  directorStage: 'director_plan_exec'
}
```

### 2.10 `director_plan_exec` 执行 `task-2`

`task-2` 的目标是只做规则提取，不碰 docx。

#### 2.10.1 `task-2` 的 `human` 关键过程

典型闭环：

1. `brain` 决定学习 `kb-evidence-query`
2. `learning` 装入 `kb_hybrid_search_chunks / kb_vector_search_chunks / kb_fts_search_chunks`
3. `brain -> hand` 发一个只读并行 `toolUsePlan`，例如 `kb_hybrid_search_chunks + kb_fts_search_chunks`
4. `brain` 根据检索结果写入 `evidences/facts`
5. `mouth` 产出 `task_handoff`

这一步的重点是：

- `lastToolUseResults` 会同时持有两条 KB 结果
- `brain` 负责把 chunk 结果提炼成“规则”
- 规则不会直接写回 `DirectorState`，而是先留在 `task-2.deliveryMarkdown`

代表性交付：

```md
# 子任务交付

## 本任务结论
已提炼出可直接执行的两类规则：品牌术语统一规则、发布日期说明规则。

## 已完成
- 已从已选知识范围内提取规则。

## 关键事实
- 品牌术语必须统一为正式品牌名“NCurator Desktop”。
- 发布日期说明应使用“预计发布日期 + 待最终确认提示”的写法。

## 关键证据
- kb_hybrid_search_chunks: 《品牌术语规范》命中正式品牌名规则。
- kb_fts_search_chunks: 《发布说明模板》命中发布日期说明模板。

## 产物与引用
无

## 未决与风险
- 如果业务已经锁定发布日期，需要覆盖模板中的“预计”表述。

## 对后续任务的影响
- 修改任务可直接套用规则，不必再次检索。

## 建议下一步
- 对目标 block 生成 docx 修改操作，并在交付前做 validate 与 preview。
```

`director` 回写后，状态变成：

```ts
{
  dispatchCursor: 2,
  plan: [
    { id: 'task-1', status: 'completed', deliveryMarkdown: '...' },
    { id: 'task-2', status: 'completed', deliveryMarkdown: '...' },
    { id: 'task-3', status: 'ready' }
  ],
  directorStage: 'director_plan_exec'
}
```

### 2.11 `director_plan_exec` 执行 `task-3`

`task-3` 是整个复杂样例里最重要的一段，因为这里既有 docx 修改，也有 artifacts。

先明确一个容易误读的点：

- `plan[].userInput` 保留的是 planner 产出的原始子任务描述，不会被前序任务结果原地改写。
- 但 `director_plan_exec` 真正派发给这次 `human` 的 `task.userInput`，会通过 `buildPlanTaskObjective()` 重新组织。
- 重新组织后的输入里，会显式带上 `contextEvidence` 和前序任务的 `deliveryMarkdown`。

也就是说，`task-3` 实际收到的不是只有这一句：

```text
基于 task-1 的区块清单和 task-2 的规则，修改 docs/prd/Alpha/PRD-Alpha-v7.docx，生成预览，保存到 docs/output/PRD-Alpha-reviewed.docx，并说明仍需人工确认的内容。
```

而是更接近下面这种 dispatch 输入：

```md
# 计划子任务

请完成当前子任务，并输出供后续任务继续执行的正式交接文档。
不要直接给最终用户写总结性答复；你的交付应帮助下一个 human 或 synthesis human 继续工作。

## 总体目标
请把 Alpha PRD 的最新 docx 按上周评审意见和当前发布模板修好……

## 当前子任务
修改并产出文档交付物
基于 task-1 的区块清单和 task-2 的规则，修改 docs/prd/Alpha/PRD-Alpha-v7.docx，生成预览，保存到 docs/output/PRD-Alpha-reviewed.docx，并说明仍需人工确认的内容。

## 已选资料范围
workspace=/project-alpha
selected scopes:
- workspace directory: docs/prd
- kb document: 品牌术语规范
- kb document: 发布说明模板

## 上下文证据
1. 已确认目标 docx 为 docs/prd/Alpha/PRD-Alpha-v7.docx
2. 已确认评审意见与模板规则来源

## 前序任务交付
### 任务 1: 确认待改 block
- taskId: task-1
- 状态: completed
- 正式交付:
  ...task-1 的 deliveryMarkdown...

### 任务 2: 提取执行规则
- taskId: task-2
- 状态: completed
- 正式交付:
  ...task-2 的 deliveryMarkdown...
```

所以这里真正跨 task 传递的，不是上一个 `human` 的内部状态，而是前序任务已经落到 `plan[].deliveryMarkdown` 的正式交付文本，再由 `director` 重新包装进下一个任务的 `userInput`。

#### 2.11.1 `task-3` 的 `human` 前半段：先学能力

由于这是新的 `human`，它依然从空的 external `learnedSkillIds` 开始；builtin skill 仍然始终可用。

第一轮通常会学习：

```ts
['docx-read', 'docx-write', 'docx-delivery']
```

#### 2.11.2 `task-3` 的 `hand` 先触发一次并行保护

为了展示 `hand` 的守卫逻辑，先模拟一个真实可发生的错误决策：

`brain` 试图把下面两个动作放进同一批：

```json
[
  {
    "toolName": "docx_open",
    "args": {
      "sourcePath": "/project-alpha/docs/prd/Alpha/PRD-Alpha-v7.docx"
    }
  },
  {
    "toolName": "docx_validate",
    "args": {
      "docId": "doc-alpha-v7"
    }
  }
]
```

这批动作会被 `validateParallelToolCalls()` 拒绝，因为：

- `docx_open` 不是只读并行安全工具
- `docx_validate` 还依赖 `docx_open` 之后拿到的 `docId`

所以 `hand` 不会真正执行它们，而是回写：

```ts
{
  watchHint: 'hand 收到不满足并行安全要求的工具批次，已返回 brain 重新决策。',
  runtime.stage: 'brain'
}
```

这时你能看到一个很关键的实现事实：

- `watchHint` 不是单独的节点
- 它只是一个轻量纠偏信号
- 真正做下一步决策的仍然是下一轮 `brain`

#### 2.11.3 `task-3` 的 `human` 后半段：拆成顺序执行

修正后的闭环会变成：

1. `brain -> hand`：`docx_open`
2. `brain -> hand`：`docx_apply_ops`
3. `brain -> hand`：`docx_validate`
4. `brain -> hand`：`docx_render_preview`
5. `brain -> hand`：`docx_save`
6. `brain -> mouth`

其中最重要的是 `runtimeArtifacts` 的变化。

在 `docx_open / docx_apply_ops / docx_validate` 之后：

- 还没有可供最终消费的 file artifact
- `runtimeArtifacts` 仍可能是空

在 `docx_render_preview` 成功后：

```ts
runtimeArtifacts = [
  {
    kind: 'file',
    capability: 'docx',
    path: '/project-alpha/.ncurator/docx-previews/run-a-doc-alpha-v7-preview.docx',
    fileName: 'run-a-doc-alpha-v7-preview.docx',
    operation: 'created',
    artifactRole: 'preview',
    summary: 'preview generated (docx)'
  }
]
```

在 `docx_save` 成功后：

```ts
runtimeArtifacts = [
  {
    kind: 'file',
    capability: 'docx',
    path: '/project-alpha/.ncurator/docx-previews/run-a-doc-alpha-v7-preview.docx',
    fileName: 'run-a-doc-alpha-v7-preview.docx',
    operation: 'created',
    artifactRole: 'preview',
    summary: 'preview generated (docx)'
  },
  {
    kind: 'file',
    capability: 'docx',
    path: '/project-alpha/docs/output/PRD-Alpha-reviewed.docx',
    fileName: 'PRD-Alpha-reviewed.docx',
    operation: 'created',
    artifactRole: 'committed',
    summary: 'doc saved: PRD-Alpha-reviewed.docx'
  }
]
```

这里要注意两个边界：

1. artifacts 是 `hand` 从工具结构化结果里提取出来的
2. `mouth` 不负责“生成 artifacts”，只负责把已有 artifacts 透传到 `result`

#### 2.11.4 `task-3` 的 `task_handoff`

这次 `mouth` 仍然是 `task_handoff`，所以它写的是给后续 synthesis 用的交接，而不是最终答复。

代表性交付：

```md
# 子任务交付

## 本任务结论
已根据前两步提供的 block 清单和规则修改目标文档，完成校验、预览生成和落盘。

## 已完成
- 已统一品牌术语写法。
- 已补充发布日期说明段。
- 已生成 preview 并保存最终文件。

## 关键事实
- 修改发生在“产品介绍”和“发布计划”两个区域。
- 校验未发现结构性问题。

## 关键证据
- docx_apply_ops: 已完成目标 block 的结构化修改。
- docx_validate: 当前快照校验通过。
- docx_render_preview: 已生成预览产物。
- docx_save: 已写入最终文件。

## 产物与引用
无

## 未决与风险
- 发布日期具体值仍使用“预计”表述，待业务最终确认。

## 对后续任务的影响
- synthesis 可以直接向用户说明修改结果，并提示未决项。

## 建议下一步
- 汇总全部任务结果，向用户交付最终说明。
```

`HumanTaskOutput.artifacts` 会带上 preview 和 committed file 两个 artifact。

#### 2.11.5 `director` 回写 `task-3`

这时 `buildPlanExecPatch()` 会回写：

```ts
{
  plan: [
    { id: 'task-1', status: 'completed', deliveryMarkdown: '...', artifacts: undefined },
    { id: 'task-2', status: 'completed', deliveryMarkdown: '...', artifacts: undefined },
    {
      id: 'task-3',
      status: 'completed',
      deliveryMarkdown: '...task-3 handoff...',
      artifacts: [
        { kind: 'file', path: '/project-alpha/.ncurator/docx-previews/run-a-doc-alpha-v7-preview.docx', artifactRole: 'preview', ... },
        { kind: 'file', path: '/project-alpha/docs/output/PRD-Alpha-reviewed.docx', artifactRole: 'committed', ... }
      ]
    }
  ],
  dispatchCursor: 3,
  directorStage: 'director_synthesis_human'
}
```

为什么直接进 `director_synthesis_human`：

- `plan` 里已经没有 `ready` task
- `director_plan_exec` 当前实现是串行推进

### 2.12 第 6 步：`director_synthesis_human`

这一步会再派发一个新的 `human`：

```ts
{
  taskId: 'synthesis-human',
  deliveryMode: 'user_answer',
  emitAnswerEvents: true
}
```

这个 `human` 读到的 `userInput` 不是原始一句话，而是 `buildSynthesisHumanObjective()` 组织出来的大对象，里面包含：

- 原始用户请求
- 由 `ctx.referenceScope` 渲染出的参考资料上下文
- `contextEvidence`
- 全部 `plan[].deliveryMarkdown`

#### 2.12.1 synthesis `human` 的实际意义

这里的 `human` 不一定还要继续调工具。很多情况下：

- `brain` 看到现成的 `contextEvidence`
- 又看到三个 `task_handoff`
- 已经足够整理最终答案

所以它可以直接：

1. `brain`
2. `mouth`
3. 结束

这也正是当前架构的关键：即使复杂路径最后也回到 `human` 完成最终交付，而不是 `director` 自己拼答案。

#### 2.12.2 synthesis 的最终交付

代表性最终答复：

```md
# 处理结果

已完成 Alpha PRD 文档的定向修改，并生成预览与最终保存文件。

## 已确认事实
- 目标文档是 `docs/prd/Alpha/PRD-Alpha-v7.docx`。
- 已按知识规则统一品牌术语写法。
- 已补充发布日期说明并保留“待最终确认”的边界。
- 已生成 preview，并保存最终文件 `docs/output/PRD-Alpha-reviewed.docx`。

## 关键证据
- context evidence: 已定位目标 docx 和规则来源。
- task-1: 已定位需修改的 block。
- task-2: 已提炼术语与发布日期规则。
- task-3: 已完成 docx 修改、校验、预览和保存。

## 限制与未决项
- 最终发布日期具体值仍需业务确认；当前文案按“预计发布日期”处理。
```

### 2.13 synthesis 回写 `finalArtifacts`

`buildSynthesisHumanPatch()` 会做两件事：

1. `finalDeliveryMarkdown = synthesisHumanOutput.deliveryMarkdown`
2. `finalArtifacts = mergeArtifactRefs(plan 中已有 artifacts, synthesis output artifacts)`

在这个样例里，synthesis 自己没有新增 artifact，所以最终结果主要来自 `task-3`：

```ts
{
  finalArtifacts: [
    {
      kind: 'file',
      capability: 'docx',
      path: '/project-alpha/.ncurator/docx-previews/run-a-doc-alpha-v7-preview.docx',
      artifactRole: 'preview',
      summary: 'preview generated (docx)'
    },
    {
      kind: 'file',
      capability: 'docx',
      path: '/project-alpha/docs/output/PRD-Alpha-reviewed.docx',
      artifactRole: 'committed',
      summary: 'doc saved: PRD-Alpha-reviewed.docx'
    }
  ],
  directorStage: 'director_complete'
}
```

### 2.14 第 7 步：`director_complete`

最后 `director_complete` 只做 run 级收尾：

```ts
{
  status: 'completed',
  directorStage: 'director_complete'
}
```

到这里，复杂样例完整结束。

### 2.15 样例 A 的事件流按顺序看是什么

如果忽略 token streaming，只看关键事件，大致顺序是：

1. `task_started(context-1)`
2. `human_step(human_brain)`，随后一次 `watch_hint(memory_reducer)`
3. `human_step(human_learning)`
4. `tool_call_started/result` 若干
5. `human_step(human_hand)` 若干
6. `task_delivery_ready(context-1, internal=true)`
7. `task_completed(context-1)`
8. `plan_created`
9. `task_started(task-1)`
10. `task_delivery_ready(task-1)`
11. `task_completed(task-1)`
12. `task_started(task-2)`
13. `task_delivery_ready(task-2)`
14. `task_completed(task-2)`
15. `task_started(task-3)`
16. 一次 `watch_hint(hand)`
17. `file_artifact(preview)`
18. `file_artifact(committed)`
19. `task_delivery_ready(task-3)`
20. `task_completed(task-3)`
21. `task_started(synthesis-human)`
22. `answer_completed(synthesis-human)`
23. `task_delivery_ready(synthesis-human)`
24. `task_completed(synthesis-human)`

其中最值得记住的三点：

- `context-1` 的交付是内部交付，不是最终答复
- `plan` 阶段每个 task 的正式产出都先进入 `deliveryMarkdown`
- 只有 direct / synthesis 这类 `user_answer + emitAnswerEvents=true` 的任务会走 `answer_completed`

## 3. 样例 B：默认 direct-human 路径

### 3.1 用户请求

假设用户输入：

> 基于已选知识范围，总结《发布说明模板》里对“发布日期”字段的写法要求，给我一个简短结论。

这类请求的特点：

- 不需要修改 docx
- 不需要多任务拆分
- 单个 `human` 闭环即可完成

### 3.2 初始 `AiRunState`

初始状态与样例 A 一样，只是 `input` 不同：

```ts
{
  runId: 'run-b',
  sessionId: 'session-b',
  status: 'running',
  input: '基于已选知识范围，总结《发布说明模板》里对“发布日期”字段的写法要求，给我一个简短结论。',
  directorStage: 'director_intent',
  contextRounds: 0,
  contextEvidence: [],
  plan: [],
  dispatchCursor: 0,
  finalArtifacts: []
}
```

### 3.3 `director_intent` 直接分流到 `director_direct_human_exec`

这次 `director_intent` 可能直接给出：

```json
{
  "mode": "direct_human",
  "reason": "任务目标单一，单个 human 可通过已选知识范围直接检索并完成答复。"
}
```

patch：

```ts
{
  contextObjective: undefined,
  directorStage: 'director_direct_human_exec'
}
```

这里不会经过：

- `director_context_human`
- `director_plan`
- `director_plan_exec`
- `director_synthesis_human`

### 3.4 `director_direct_human_exec`

`director_direct_human_exec` 会派发：

```ts
{
  taskId: 'direct-human',
  deliveryMode: 'user_answer',
  emitAnswerEvents: true
}
```

### 3.5 `direct-human` 的 `human` 如何闭环

一条典型的真实链路：

1. `brain` 先判断需要知识检索
2. `learning` 学习 `kb-evidence-query`
3. `hand` 调用 `kb_hybrid_search_chunks`
4. `brain` 把 chunk 结果提炼成 facts/evidences
5. `mouth` 用 `deliveryMode=user_answer` 输出正式答复

代表性的 `HumanTaskOutput`：

```ts
{
  taskId: 'direct-human',
  status: 'completed',
  summary: '已总结发布日期字段的写法要求。',
  deliveryMarkdown: '# 处理结果\n\n发布日期字段应采用“预计发布日期 + 待最终确认说明”的写法……',
  artifacts: undefined
}
```

### 3.6 `director_direct_human_exec` 回写什么

`buildDirectHumanPatch()` 直接回写：

```ts
{
  finalDeliveryMarkdown: '# 处理结果 ...',
  finalArtifacts: [],
  directorStage: 'director_complete'
}
```

然后 `director_complete` 把 run 置为：

```ts
{
  status: 'completed',
  directorStage: 'director_complete'
}
```

### 3.7 样例 B 的关键差异

这条路径里：

- `contextEvidence` 全程为空也没关系
- `plan` 全程为空
- `finalDeliveryMarkdown` 直接来自这一个 `human`
- 没有中间 `task_handoff`
- 没有 synthesis human

事件流也简单很多：

1. `task_started(direct-human)`
2. `human_step(human_brain)`
3. `human_step(human_learning)`
4. `tool_call_started/result`
5. `human_step(human_hand)`
6. `answer_completed(direct-human)`
7. `task_delivery_ready(direct-human)`
8. `task_completed(direct-human)`

## 4. 两条路径放在一起看

### 4.1 `director` 侧差异

| 对比项 | 样例 A 复杂路径 | 样例 B 默认路径 |
| --- | --- | --- |
| 首次路由 | `need_context` | `direct_human` |
| 是否补上下文 | 是 | 否 |
| 是否拆计划 | 是 | 否 |
| 是否多次派发 `human` | 是 | 否 |
| 是否需要 synthesis | 是 | 否 |
| `finalDeliveryMarkdown` 来源 | synthesis human | direct human |

### 4.2 `human` 侧共性

不管是复杂路径还是默认路径，真正执行任务的始终是 `human`，并且都遵守同一套内部原则：

- `brain` 是唯一推理节点
- `learning` 只学 skill，不推理
- `hand` 只执行工具，不改 `brainMemory.inside`
- `mouth` 只交付，不新增 facts，也不生成 artifacts

### 4.3 数据流真正怎么过

复杂路径里，跨子任务传递的数据只走这三条通道：

1. `context_note -> extractReusableContextEvidence() -> contextEvidence`
2. `task_handoff -> plan[].deliveryMarkdown`
3. `hand` 提取的 `artifacts -> plan[].artifacts -> finalArtifacts`

默认路径里，这三条通道会被大幅裁剪，只剩：

1. `direct human -> finalDeliveryMarkdown`
2. `direct human -> finalArtifacts`

## 5. 最容易改错的实现点

### 5.1 改 `director` 逻辑时

- 不要让 `director` 直接依赖 `HumanState`
- 不要把整个 `context_note` 原样塞回 `DirectorState`
- 不要让 `director_plan` 生成“最终总结任务”

### 5.2 改 `human` 逻辑时

- `brainMemory.inside` 只能通过 `memoryOps + reduceBrainMemory()` 修改
- `watchHint` 只是纠偏信号，不是新节点
- `runtimeArtifacts` 只应在 `hand` 增长
- `mouth` 透传 artifacts，但不负责制造 artifacts

### 5.3 改交付逻辑时

- `deliveryMode` 只影响交付组织方式
- `context_note` 是给 `director` 的
- `task_handoff` 是给后续 task 和 synthesis 的
- `user_answer` 才是面向最终用户的

## 6. 看代码时建议对照的文件

- `src/main/services/ai/AiRunService.ts`
- `src/main/services/ai/runtime.ts`
- `src/main/services/ai/llmExecutor.ts`
- `src/main/services/ai/director/graph/directorGraph.ts`
- `src/main/services/ai/director/node/intentNode.ts`
- `src/main/services/ai/director/node/contextEnrichNode.ts`
- `src/main/services/ai/director/node/planNode.ts`
- `src/main/services/ai/director/node/planExecNode.ts`
- `src/main/services/ai/director/node/synthesisHumanNode.ts`
- `src/main/services/ai/director/node/helpers.ts`
- `src/main/services/ai/director/node/objectives.ts`
- `src/main/services/ai/human/graph/humanGraph.ts`
- `src/main/services/ai/human/node/brainNode/index.ts`
- `src/main/services/ai/human/node/learningNode/index.ts`
- `src/main/services/ai/human/node/handNode/index.ts`
- `src/main/services/ai/human/node/mouthNode/index.ts`
- `src/main/services/ai/human/node/utils/stateTransitions.ts`
- `src/main/services/ai/human/node/utils/stateTransitionEvents.ts`
- `src/main/services/ai/human/shared/deliverySummary.ts`
- `src/main/services/ai/utils/artifacts.ts`

如果你后面要改 AI 逻辑，最有用的阅读顺序通常是：

1. 先看本文，确认你想改的是哪一段真实链路
2. 再看 `implementation-spec.md`，确认节点职责边界
3. 最后进对应代码文件改实现
