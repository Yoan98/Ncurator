# NCurator-Desktop AI Workbench 测试总计划

## 1. 目标

本计划用于验证 `workbench` 页面上的 AI 是否真的能接住用户诉求，并在本地优先约束下把事情做成，而不是只返回一段看起来合理的回答。

当前测试主轴聚焦三类真实诉求：

- 帮用户编辑或编写 `.docx` 文档
- 回答本地知识库问题
- 在必要时结合 `terminal` 读取工作区文件、生成中间材料或辅助完成前两类任务

测试按七个层次展开：

1. `tool`
2. `human`
3. `context`
4. `intent`
5. `plan`
6. `entire`
7. `workbench`

目标不是一次性做完所有自动化，而是先建立一版能持续推进的专项测试基线，为后续实现、诊断和优化提供统一框架。

## 2. 文档组织规则

AI workbench 测试文档统一放在 `doc/ai-workbench-test/`。

任一时刻，该目录只保留两个工作文件：

1. `plan.md`
2. 当前阶段唯一的 `todo-stage-N.md`

规则如下：

- `plan.md` 负责保留完整测试方案、阶段定义和用例信息列表
- `todo-stage-N.md` 只负责当前阶段执行项
- 不在 `plan.md` 中维护当前阶段复选框
- 不在入口文档中写死当前所处 stage 编号
- 只有当前阶段完成并验收后，才能创建下一阶段的 `todo-stage-N.md`

## 3. 当前基线

结合当前实现，现状如下：

- AI 编排主链路已经成型：`main_intent -> main_context_human -> main_plan -> main_plan_exec -> main_synthesis_human`
- `human` 子流程已经成型：`human_brain -> human_skill_loader / human_tool_exec -> human_response`
- 工具族已经具备三类核心能力：
  - `local_kb_retrieval`
  - `terminal_exec`
  - `docx`
- `workbench` 页面已经具备目标骨架：
  - 左侧历史会话
  - 中间会话与 `Assistant Run`
  - 右侧时间线与检查器
  - 底部统一输入区、模式切换与范围选择
- 当前测试覆盖仍然偏薄：
  - backend 只有少量基础样例
  - e2e 只有基础 smoke

因此这轮计划的重点不是补少量零散 case，而是建立完整的专项覆盖树，并把阶段推进、日志沉淀和诊断方式统一下来。

## 4. 测试范围

### 4.1 本轮纳入范围

- 本地优先场景
- `AI 对话` 模式下的多步任务完成能力
- `纯搜索` 模式下的检索与展示能力
- `.docx` 读取、编辑、保存、预览、校验、回滚能力
- `terminal` 的工作区边界、审批、命令执行与产物发现能力
- 本地知识库检索能力
- `draft review` 审阅中心链路
- `workbench` 页面下的最终完成 e2e、可用性、布局与关键交互体验

### 4.2 本轮暂不作为核心目标

- 外部联网问答质量
- 多用户协作
- 长周期记忆质量
- 与当前主流程无关的泛化 Agent 能力

### 4.3 模型诊断策略

测试默认只用基础模型主跑。更强模型不是固定对照组，而是诊断工具。

#### 默认规则

- 所有 case 先只用基础模型执行
- 同一 case 必须在相同 fixture、相同输入、相同运行前提下重复执行
- 当基础模型连续 `3` 次都未完成目标，且失败不像是确定性的工程阻塞时，才补跑 `1` 次更强模型

#### 不触发更强模型的情况

下列情况优先按工程问题处理，不把它们当成“需要换模型诊断”的信号：

- 工作区未绑定
- 审批被拒绝
- fixture 缺失或路径错误
- 工具本身返回明确错误
- 明确的边界拦截，例如工作区外路径逃逸

#### 触发更强模型诊断的目的

- 判断失败是否主要来自模型能力上限
- 判断是否是上下文组织、任务拆解或提示结构不足
- 判断“换模型就能解决”是否值得反向推动工程改造
- 为后续优化提供证据，而不是直接把更强模型当成默认方案

#### 配置方式

- `AI_LIVE_PRIMARY_MODEL_NAME`
  - 控制基础模型，当前默认值是 `gpt-5`
- `AI_LIVE_STRONG_MODEL_NAME`
  - 控制诊断用更强模型，当前默认值是 `gpt-5.2`
- live 配置可用时，测试默认直连 live 模型；若要退回纯 mock，可禁用 `.env` 加载或显式清空 live 配置

#### 诊断产出要求

补跑更强模型后，需要明确记录：

- 更强模型是否完成了基础模型连续失败的同一任务
- 完成质量是否明显高于基础模型
- 差异更像能力差异、上下文差异，还是工程链路问题
- 该结论是否值得反向指导 prompt、编排或工具链改造

## 5. 真实用户场景池

测试必须围绕真实诉求，而不是只围绕单个函数或单条事件。

| 场景 ID | 用户诉求示例 | 涉及能力 | 预期结果 |
| --- | --- | --- | --- |
| `S01` | “把工作区里的 `会议纪要.docx` 改成正式周报格式，并补一个结论段。” | `docx` + `human` | AI 读取原文、定位块、完成修改、输出新文档或审阅结果 |
| `S02` | “根据 `notes.txt` 和 `todo.md`，帮我写一版项目周报 docx。” | `terminal` + `docx` + `plan` | AI 先读取工作区材料，再生成结构化 docx |
| `S03` | “知识库里有没有关于 LanceDB 分层设计的说明？给我结论并引用依据。” | `local_kb_retrieval` + `human` | 返回基于本地资料的答案，证据可回看 |
| `S04` | “先从知识库里找数据库规范，再把 `模板.docx` 里的数据库章节改掉。” | `kb` + `docx` + `plan` | 先检索，再编辑文档，最终进入可预览或可审阅结果 |
| `S05` | “继续刚才第二步，把风险部分写得更保守一点。” | `context` + `intent` | AI 正确接续前文或先补上下文，而不是误做新任务 |
| `S06` | “去工作区里找最新日报，整理成一版发给领导的汇报。” | `terminal` + `context` + `plan` | AI 先找文件，再读取内容，再生成最终交付 |
| `S07` | “帮我执行一个命令把产物导出来。” | `terminal` + `approval` | AI 给出审批请求，等待用户决策，不越权执行 |
| `S08` | “根据 AI 改写结果，我只接受其中 2 处修改，其他拒绝。” | `draft review` + `ui` | 审阅中心可完成逐条接受、拒绝并提交 |
| `S09` | “对比 `上周周报.docx` 和 `本周草稿.docx`，生成变更摘要并补到最终版开头。” | `docx` + `human` + `plan` | AI 能读取两份文档、归纳变更点并写回最终文档或生成审阅结果 |
| `S10` | “先从知识库找数据库规范，再去工作区找现有实现说明，最后生成一版技术方案 docx。” | `kb` + `terminal` + `docx` + `plan` | AI 能跨知识库与工作区收集证据，再输出结构化文档 |
| `S11` | “工作区里有三份日报和一个风险清单，帮我合并成领导汇报，并把风险部分写得更保守。” | `terminal` + `docx` + `human` | AI 能发现多份材料、归并要点并完成定向改写 |
| `S12` | “如果知识库里证据不足，就明确告诉我还缺什么，并先给我一版可继续完善的初稿。” | `kb` + `human` + `plan` | AI 能在证据不足时安全收敛，而不是编造结论 |
| `S13` | “根据会议纪要、todo、上周周报和知识库规范，连续处理并生成正式周报，再进入审阅。” | `terminal` + `kb` + `docx` + `human` + `plan` | AI 能完成长任务、多源材料融合和最终审阅收敛 |
| `S14` | “先执行导出命令拿到数据，再把关键指标写进现有周报模板，并保留原表格结构。” | `terminal` + `approval` + `docx` + `human` | AI 能完成审批、产物读取、结构化写回和表格保持 |

这 `14` 类场景覆盖了当前阶段最重要的真实使用路径，也能更完整地支撑 `tool`、`human`、`entire` 与 `workbench` 的专项测试。

## 6. 七层测试策略

### 6.1 `tool`

#### 目标

确认工具本身可用、边界明确、失败可解释，因为这是上层全部能力的地基。

#### 覆盖重点

##### `docx`

- 基础读取
  - 打开文档：`docx_open`
  - 获取结构：`docx_outline`
  - 定位块：`docx_get_block`
  - 文本搜索：`docx_search`
- 复杂编辑
  - 混合操作：`replace_block / insert_after / insert_before / delete_block / update_table_cell / replace_text`
  - 多段连续修改
  - 标题、正文、表格混合修改
  - 长文档局部范围修改
  - 行内文本与表格单元格的混合改写
  - 保持标题层级、段落顺序与表格结构
- 结果收敛
  - 保存文档：`docx_save`
  - 预览渲染：`docx_render_preview`
  - 校验：`docx_validate`
  - 历史回看：`docx_get_history`
  - 回滚：`docx_rollback`
  - 保存冲突、覆盖与另存为策略
- 异常与边界
  - 无效 `blockId`
  - 搜索命中歧义
  - 表格单元格更新失败
  - 多轮编辑后的 lineage 正确性
  - 保存路径冲突与 `overwrite` 行为
  - 多文档并行打开后的目标文档识别

##### `terminal`

- 读取型能力
  - 在工作区内 `find / rg / ls / cat / sed` 读取材料
  - 多层目录发现文件
  - 相对路径与绝对路径解析
  - 批量发现多个候选文件并汇总关键信息
- 复杂命令能力
  - 多段命令
  - 管道与重定向
  - 产物识别与 `file_artifact` 事件
  - 输出截断后的摘要可用性
  - 先生成产物、再回读产物的连续链路
- 安全与阻塞
  - 工作区边界检查
  - 高中低风险分类
  - 审批请求触发
  - 审批通过 / 拒绝后的后续行为
  - 审批拒绝后的安全收敛与替代回复
- 异常与边界
  - 命令失败
  - 长输出
  - 取消执行
  - 工作区外路径逃逸
  - 读写混合命令
  - 相对路径跳转与软链接式逃逸尝试

##### `kb`

- `hybrid / vector / fts` 检索
- `list documents`
- `source scope` 过滤
- 无结果返回
- 已选范围为空时的表现
- 先列文档再限定检索范围
- 多来源结果的引用与区分

#### 通过标准

- 成功路径返回结果正确且事件完整
- 阻塞路径必须返回清晰的结构化原因
- 失败路径必须可复现、可回看、可归因

### 6.2 `human`

#### 目标

验证 `human` 是否具备自主推进任务的能力，而不是只会机械调用单个工具。

#### 重点问题

- 能否根据当前目标主动选择下一步动作
- 工具失败后能否修正路径
- 是否会在证据不足时停下来，而不是胡编
- 是否会在阻塞场景下正确上抛审批 / 工作区请求
- 是否能输出让后续节点继续工作的结构化交付
- 是否能把复杂诉求拆成多个有依赖关系的动作
- 是否能在 `kb / terminal / docx` 之间切换，而不是只会单工具闭环
- 是否能在多轮修改后保持目标不漂移
- 是否能在做不完时给出部分完成但可继续的交付
- 是否能在长任务里保持步骤连贯、证据可追溯、阶段目标不丢失

#### 覆盖重点

- 单步闭环任务
- 单工具 `docx` 直接完成任务
- 多工具串联任务
- 工具失败后的自纠偏
- 工作区缺失、审批阻塞等中断点
- 文档修改后的审阅收敛
- 混合任务中的跨工具切换
- 多源材料归并后的统一交付
- 证据不足时的安全停止与继续建议
- 多轮 follow-up 续做
- 长任务中的多步依赖推进
- 长任务中途加入约束后的重规划
- 长任务中的审批分支切换
- 预算耗尽或部分阻塞时的安全收敛

#### 通过标准

- 至少能把简单任务独立做完
- 多步任务中每一步选择与上一步结果一致
- 遇阻塞时不乱答、不越权、不丢状态
- 复杂任务能拆出清晰的行动链，而不是一上来就输出空泛答案
- 工具失败后能切换策略，不重复死循环
- 长任务中能维持稳定目标，不因中间步骤变多而明显漂移

### 6.3 `context`

#### 目标

验证系统是否能主动补足后续规划所需上下文，为高质量 `plan` 提供输入。

#### 重点问题

- 用户指代不清时能否识别“需要更多上下文”
- 前文任务续做时能否正确接住会话上下文
- 工作区未准备文件能否纳入上下文判断
- 混合来源任务中能否先收集证据再规划

#### 通过标准

- `contextEvidence` 能沉淀关键事实
- 上下文补充后，后续 `intent` 或 `plan` 明显改善
- 不因上下文缺失直接走错误执行路径

### 6.4 `intent`

#### 目标

验证系统是否能在 `need_context / direct_human / to_plan` 之间做出正确路由。

#### 重点问题

- 简单任务是否过度规划
- 复杂任务是否误判成单步任务
- 指代不清任务是否直接执行
- 文档修改任务是否正确进入多步链路

#### 关键判断样例

| 类型 | 用户输入 | 预期路由 |
| --- | --- | --- |
| 简单 | “总结知识库里这篇资料的核心观点” | `direct_human` |
| 复杂 | “把模板 docx 改成适配本项目的版本并保存” | `to_plan` |
| 上下文不足 | “继续刚才第二段” | `need_context` |
| 混合任务 | “先去看工作区材料，再帮我写一版文档” | `to_plan` |

#### 通过标准

- 简单 / 复杂 / 缺上下文三类任务都有稳定判别
- 路由错误可通过 raw log 直接看出

### 6.5 `plan`

#### 目标

验证生成的计划是否真的可执行、顺序合理、能落地解决用户诉求。

#### 重点问题

- 任务拆解是否缺步或错序
- 是否把最终总结错误塞进业务计划
- 是否把证据收集、文档编辑、保存、审阅等关键阶段拆出来
- 任务失败或阻塞后是否能以当前结果收敛

#### 计划质量检查点

- 每个 task 都有明确 objective
- 顺序符合依赖关系
- 不出现“先保存后编辑”这类错误顺序
- 不创建无意义的重复任务
- 任务结果能支撑 `synthesis`

#### 通过标准

- 计划具有可执行性
- 计划执行后可得到完整交付或明确阻塞说明
- 阻塞时不会因为某一步失败导致整体状态不可收敛

### 6.6 `entire`

#### 目标

验证从用户输入到最终交付的后端完整闭环是否成立。

这一层只归属 `backend`，用于验证 `main / human / tools` 在不依赖真实 UI 交互时能否完成完整任务链。`workbench` 下的真实交互与最终完成验收，统一放到第 `6.7` 节。

#### 总体场景完成度判定

每个真实用户场景都按完成度而不是单纯 `pass / fail` 评估。

| 分值 | 含义 |
| --- | --- |
| `3` | 完整完成，用户目标达成，结果可直接消费 |
| `2` | 主目标完成，但还需要少量人工修补 |
| `1` | 只完成部分步骤，有中间产物，但没真正完成诉求 |
| `0` | 失败或阻塞，用户诉求未完成 |

#### 通过标准

- 不是只看到事件跑过，而是场景本身达到目标
- 每个场景都有完成度记录
- 用户最终拿到可消费结果，而不是一堆中间事件
- 事实链完整，日志可复盘
- backend harness 下能稳定复现成功、部分完成与阻塞三类结果

### 6.7 `workbench`

#### 目标

验证 `workbench` 真实交互下的最终完成能力与 UI 可用性，避免出现“backend 能跑通，但用户在界面里做不成”的情况。

#### 最终完成 e2e 关注点

- 用户从输入到最终交付的整链路是否真的跑通
- follow-up 任务是否能接住上一轮产物继续完成
- 审批流、工作区流、审阅流是否能在界面里闭环
- 最终产物、引用依据、审阅结果、打开路径等是否可被用户消费
- 长任务在真实界面中是否仍能稳定完成，而不是只在 backend harness 中成立

#### 当前阶段的核心判断

- 页面结构是否符合三栏工作模型
- 输入区是否稳定可见、可输入、可回车发送
- `Assistant Run`、时间线、检查器、审阅中心是否互不遮挡
- 右侧面板在长内容、长路径、长 JSON 下是否溢出失控
- 小窗口下是否出现布局断裂
- 审批 / 工作区 / 非本地提示条是否清晰
- 草稿审阅中心是否在大修改量下仍可操作

#### 必测视口

- `1440 x 900`
- `1280 x 800`
- `1024 x 768`
- `900 x 700`

#### 必测交互

- 会话切换
- 模式切换：`AI 对话 / 纯搜索`
- 范围选择
- 回车发送 / 按钮发送 / 取消运行
- 时间线点击与检查器联动
- 审批通过 / 拒绝
- 工作区继续运行
- 审阅中心逐条接受 / 拒绝 / 全部接受 / 提交
- 预览 / 打开 / 定位路径

#### UI 通过标准

- 无阻塞级布局问题
- 无关键状态缺失
- 无明显滚动冲突
- 关键链路可在目标窗口尺寸下完成
- 最终完成 e2e 中，用户能在界面里拿到可消费结果，而不是只看到事件流

## 7. 测试分层落位

继续沿用 [test.md](/Users/test/work-space/NCurator-Desktop/doc/test.md) 中约定的目录树：

```text
tests/
  ai/
    backend/
      tools/
        terminal/
        docx/
        kb/
      human/
      main-intent/
      main-context/
      main-plan/
      entire/
    e2e/
      workbench/
        final-completion/
        ui/
```

对应关系如下：

| 能力层 | 测试层 | 主要目的 |
| --- | --- | --- |
| `tool` | backend | 验证单能力与边界 |
| `human` | backend | 验证自主执行与纠偏 |
| `context` | backend | 验证上下文补全 |
| `intent` | backend | 验证路由判断 |
| `plan` | backend | 验证计划拆解与执行顺序 |
| `entire` | backend | 验证后端完整任务闭环 |
| `workbench` | e2e | 验证真实交互下的最终完成与 UI 可用性 |

## 8. 执行节奏与阶段用例信息列表

建议按五个阶段推进，而不是一次铺满全部 case。

### 阶段规则

- 一次只做当前阶段的 `todolist`
- 当前阶段没有跑完、没有沉淀结果前，不进入下一阶段
- 每个阶段结束都必须输出：
  - raw logs
  - 一份阶段完成情况
  - 下一阶段 `todolist`
- 不要一上来把全部场景、全部 UI、全部回归一次铺开
- 下表中的测试用例名称同时作为 stable case name；落地文件时按 suite 目录使用同名 kebab-case

### 阶段 1：能力打底

目标：先把 `tool` 层补齐，并把复杂 `docx / terminal / kb` 场景打透。

优先级：

1. `docx`
2. `terminal`
3. `kb`

#### 测试用例信息列表

| 测试用例名称 | 目标 | 描述 |
| --- | --- | --- |
| `T1-docx-structure-read` | 验证文档打开、结构识别、块定位、搜索闭环 | 针对带标题、正文、表格的样例文档完成 `open -> outline -> search -> get_block` |
| `T1-docx-block-targeting-and-ambiguous-search` | 验证块定位与歧义消解 | 多个相似标题或相似段落同时命中时，仍能稳定定位目标块 |
| `T1-docx-mixed-structural-edit` | 验证复杂结构改写 | 同一 case 内完成章节改写、插入新段、删除旧段、更新表格负责人 |
| `T1-docx-table-and-inline-rewrite` | 验证表格与行内文本混合改写 | 同一轮操作中修改表格单元格、段落正文和局部文本替换 |
| `T1-docx-save-conflict-and-overwrite-policy` | 验证保存边界 | 覆盖保存、另存为、路径冲突和 `overwrite` 行为都能被正确处理 |
| `T1-docx-preview-validate-rollback` | 验证结果收敛能力 | 多轮编辑后执行保存、预览、校验、历史回看与回滚 |
| `T1-terminal-workspace-material-discovery` | 验证读取型 terminal 链路 | 在多层目录里找到最新材料并提取可复用内容 |
| `T1-terminal-relative-and-absolute-path-resolution` | 验证路径解析 | 混用相对路径、绝对路径和目录切换时仍能稳定定位文件 |
| `T1-terminal-batch-material-summary` | 验证批量材料发现与归并 | 一次发现多份日报、会议纪要或风险清单，并提取可复用摘要 |
| `T1-terminal-artifact-producing-command` | 验证复杂命令与产物识别 | 执行会生成中间文件的命令，检查摘要、产物识别与回读链路 |
| `T1-terminal-approval-and-boundary` | 验证高风险命令审批与工作区边界 | 覆盖审批请求、批准、拒绝、路径逃逸阻断 |
| `T1-terminal-approval-denied-follow-up` | 验证审批拒绝后的收敛 | 用户拒绝后，系统能停止执行并给出安全后续 |
| `T1-terminal-failure-and-long-output` | 验证失败路径可解释 | 覆盖命令失败、长输出截断、取消执行后的收敛 |
| `T1-kb-hybrid-retrieval` | 验证 `hybrid / vector / fts` 检索基线 | 在限定 source scope 下返回可引用结果 |
| `T1-kb-list-documents-and-scope-filter` | 验证文档枚举与范围过滤 | 先列出文档，再按 source scope 限定检索范围 |
| `T1-kb-empty-scope-and-no-result` | 验证知识库边界表现 | 覆盖空范围、无结果和返回理由清晰性 |

产出：

- backend raw logs
- 一份阶段完成情况
- 下一阶段 `todolist`

### 阶段 2：`human` 核心能力

目标：把 `human` 单独拉出来验证，因为这是整个 AI 设计里最核心的执行体。

优先级：

1. 单步闭环
2. 多工具串联
3. 工具失败纠偏
4. 多轮 refinement
5. 审阅与阻塞收敛
6. 长任务工程能力
7. 阻塞后的部分交付

#### 测试用例信息列表

| 测试用例名称 | 目标 | 描述 |
| --- | --- | --- |
| `T2-human-direct-kb-answer` | 验证单步自主完成 | 直接读取知识库并交付可引用答案 |
| `T2-human-direct-docx-edit` | 验证单工具文档任务闭环 | 直接读取指定文档、完成局部修改并交付可审阅结果 |
| `T2-human-tool-failure-recovery` | 验证失败后换路 | 块搜索失败后改走 `outline + get_block`，继续推进任务 |
| `T2-human-workspace-blocked-recovery` | 验证阻塞上抛 | 缺工作区或缺审批时请求补充，而不是空跑或乱答 |
| `T2-human-approval-blocked-recovery` | 验证审批阻塞收敛 | 需要执行命令但未获批准时，能停在正确节点并给出继续条件 |
| `T2-human-terminal-docx-handoff` | 验证跨工具协作 | 先在工作区找材料，再写入 docx 并形成可审阅交付 |
| `T2-human-kb-docx-bridge` | 验证知识到文档的转换 | 先检索本地规范，再据此修改模板文档 |
| `T2-human-multi-source-merge-delivery` | 验证多源材料归并 | 汇总多份日报、纪要或风险清单后输出统一交付 |
| `T2-human-evidence-insufficient-safe-stop` | 验证证据不足时的安全行为 | 找不到足够依据时明确说明缺口，并交付可继续的初稿或后续建议 |
| `T2-human-review-ready-delivery` | 验证审阅收敛能力 | 文档修改完成后能稳定输出 `draft_review_ready` 类结果而不是松散文本 |
| `T2-human-multi-turn-refinement` | 验证多轮目标保持 | 上一轮已有中间产物，本轮继续保守化或局部精修 |
| `T2-human-long-task-project-brief` | 验证长任务工程能力 | 至少 `6` 个依赖步骤串联完成“找材料、抽结论、写周报、补风险、生成审阅结果”的整链路 |
| `T2-human-long-task-with-corrections` | 验证长任务中的纠偏稳定性 | 长任务中途加入新约束或局部失败后，仍能保持目标不漂移 |
| `T2-human-long-task-approval-branch` | 验证长任务中的审批分支 | 长任务中途需要审批时，能在批准与拒绝两条分支上都安全推进或收敛 |
| `T2-human-partial-delivery-on-budget-limit` | 验证做不完时的安全收敛 | 步骤预算耗尽或审批未过时，保留已有进展并给出可继续交付 |

产出：

- backend raw logs
- 一份阶段完成情况
- 下一阶段 `todolist`

### 阶段 3：编排判断

目标：补 `intent / context / plan`，确保 `main` 编排与 `human` 核心能力能正确衔接。

优先级：

1. `intent`
2. `context`
3. `plan`

#### 测试用例信息列表

| 测试用例名称 | 目标 | 描述 |
| --- | --- | --- |
| `T3-intent-direct-vs-plan-routing` | 验证简单任务不过度规划 | 区分直接回答与进入计划链路 |
| `T3-intent-need-context-follow-up` | 验证续做场景路由 | 像“继续第二步”这类输入必须先补上下文 |
| `T3-context-workspace-evidence-collection` | 验证规划前证据收集 | 先看工作区材料，再决定任务方案 |
| `T3-context-follow-up-reference-resolution` | 验证指代解析 | 正确接住“刚才那份文档”“上一版风险段”之类引用 |
| `T3-plan-docx-workflow-ordering` | 验证计划顺序正确 | 文档类任务必须先取证、后编辑、再保存或审阅 |
| `T3-plan-blocked-task-convergence` | 验证阻塞时计划可收敛 | 出现审批或缺文件时仍能产出明确后续 |

产出：

- backend raw logs
- 一份阶段完成情况
- 下一阶段 `todolist`

### 阶段 4：`backend/entire` 完整任务闭环

目标：用 backend harness 先把高价值真实任务闭环跑通，验证 `entire` 层是否能在不依赖 UI 的情况下稳定完成。

优先级：

1. 文档闭环
2. 混合检索与文档闭环
3. 证据不足收敛
4. 长任务闭环

#### 测试用例信息列表

| 测试用例名称 | 目标 | 描述 |
| --- | --- | --- |
| `E01-backend-docx-rewrite-review-ready` | 验证现有 docx 改写闭环 | 对应 `S01`，读取、修改并进入审阅结果 |
| `E02-backend-workspace-to-docx` | 验证工作区材料生成文档 | 对应 `S02`，从 `notes / todo` 提炼内容并生成结构化 docx |
| `E03-backend-kb-answer-with-citation` | 验证知识库问答闭环 | 对应 `S03`，答案必须可回看依据 |
| `E04-backend-kb-to-docx-hybrid` | 验证混合链路 | 对应 `S04`，先查规范，再改模板文档，顺序正确且结果可消费 |
| `E05-backend-follow-up-continuation` | 验证多轮续做闭环 | 对应 `S05`，接续前文后继续完成修改 |
| `E06-backend-terminal-materials-to-delivery` | 验证工作区材料到最终交付 | 对应 `S06`，先找材料，再生成最终汇报 |
| `E07-backend-evidence-insufficient-safe-stop` | 验证证据不足时的完整收敛 | 对应 `S12`，依据不足时仍能给出明确缺口和可继续交付 |
| `E08-backend-long-task-weekly-brief` | 验证长任务闭环 | 对应 `S13`，多源材料、多步依赖和审阅收敛都能成立 |

产出：

- backend raw logs
- 场景完成度表
- 一份阶段完成情况

### 阶段 5：`e2e/workbench` 最终完成与 UI 验收

目标：在真实 `workbench` 交互下验证最终完成能力与 UI 可用性，不再单独拆 `scenarios` 子目录。

优先级：

1. 最终完成 e2e
2. 审批与审阅链路
3. follow-up 与长任务稳定性
4. 小窗口布局与右侧面板稳定性

#### 测试用例信息列表

| 测试用例名称 | 目标 | 描述 |
| --- | --- | --- |
| `W01-workbench-docx-rewrite-final-completion` | 验证文档类最终完成 | 对应 `S01`，用户在界面中能完成输入、等待执行并拿到可消费结果 |
| `W02-workbench-kb-answer-final-completion` | 验证知识库问答最终完成 | 对应 `S03`，答案、依据与引用展示都可被用户消费 |
| `W03-workbench-kb-docx-hybrid-final-completion` | 验证混合任务最终完成 | 对应 `S04`，先检索后改文档的链路能在界面中完整跑通 |
| `W04-workbench-follow-up-continuation` | 验证多轮续做 | 对应 `S05`，接续上轮中间结果完成后续修改 |
| `W05-workbench-terminal-approval-final-completion` | 验证审批分支 | 对应 `S07`，覆盖等待审批、批准继续、拒绝收敛 |
| `W06-workbench-review-partial-acceptance` | 验证审阅中心部分接受 | 对应 `S08`，逐条接受或拒绝后提交最终结果 |
| `W07-workbench-long-task-stability` | 验证长任务真实交互稳定性 | 对应 `S13`，长任务在界面里仍能保持步骤连贯并最终收敛 |
| `W08-workbench-small-window-and-overflow` | 验证可用性 | 小窗口、长路径、长 JSON、右侧面板滚动都不失控 |
| `W09-workbench-inspector-and-run-linkage` | 验证工作台核心联动 | 时间线、检查器、审批条、审阅中心之间状态一致 |
| `W10-workbench-workspace-and-banner-flow` | 验证工作区与提示条链路 | 工作区缺失、补充后继续运行，以及各类 banner 状态都清晰可操作 |

产出：

- e2e trace
- 场景完成度表
- 一份阶段完成情况

## 9. 运行后记录方式

问题先不预设分类。每轮跑完后，只记录真实结果和下一步。

### `raw log` 层

不改现有架构设计，继续遵守 [test.md](/Users/test/work-space/NCurator-Desktop/doc/test.md) 的固定契约：

- `meta.json`
- `timeline.jsonl`
- `artifacts.json`

其中：

- 模型名继续使用现有的 `meta.runtime.modelName`
- 如需保留 fixture 或补充观测值，继续放进 `timeline.jsonl` 事件的 `data`
- 不新增 `meta.json` 顶层字段

### `report` 层

每条 case 至少记录这些内容：

- `caseId / scenarioId`
- `baselineModel`
- `baselineAttempts`
- `diagnosticTriggered`
- `diagnosticModel`
- `diagnosticReason`
- `diagnosticObservation`
- `diagnosticConclusion`
- 用户输入
- 预期结果
- 实际结果
- 完成度分值：`0 / 1 / 2 / 3`
- 最终产物路径、回答摘要或审阅结果
- `rawLogPath`
- 下一步建议

### 跑完后的沉淀方式

1. 先落 raw logs 到 `tests/logs/ai/**`
2. 再更新 `tests/report/ai/report.md`
3. 在 report 中记录当前阶段完成情况与强模型诊断结论
4. 最后给出下一阶段 `todolist`

## 10. 高价值回归样例

这些样例作为每次优化后的回归主样例：

- `G01` 编辑现有 `.docx` 并进入审阅
- `G02` 从工作区文本材料生成 `.docx`
- `G03` 回答知识库问题并给出依据
- `G04` 先搜知识库再修改 `.docx`
- `G05` terminal 命令审批通过后继续完成任务
- `G06` terminal 命令审批拒绝后给出安全收敛
- `G07` 工作区缺失时提示补充并可继续
- `G08` 多份工作区材料合并成领导汇报
- `G09` 证据不足时明确说明缺口并交付可继续初稿
- `G10` 长任务下完成周报生成并进入审阅
- `G11` workbench 中审批、审阅与最终产物链路完整跑通
- `G12` 小窗口下完整跑通一次 AI 对话链路

## 11. 阶段验收标准

本计划的阶段性验收标准如下：

- 已建立完整测试树，不再只有 smoke case
- 七层能力都有对应 case 设计与落位目录
- 至少一轮完整 raw log + report 分析已经按此计划执行
- 已形成一份按优先级排序的下一阶段 `todolist`，能够直接指导下一轮优化

如果要进入下一阶段实现，优先顺序建议是：

1. 补 `tool` 层缺口，尤其是 `docx / terminal / kb`
2. 单独验证 `human` 核心能力
3. 补 `intent / context / plan`
4. 补高价值 `entire` 场景
5. 集中补 `workbench` 最终完成与 UI 可用性问题

## 12. 本计划对应的输出物

按这份计划推进后，每轮测试固定产出以下内容：

- 新增或更新的测试用例
- `tests/logs/ai/**` 原始日志
- `tests/report/ai/report.md` 分析结论
- 一份阶段完成情况
- 一份下一轮优化目标列表

这会让后续测试不再停留在“感觉 AI 这次还行”，而是变成能被持续验证和持续改进的工程闭环。
