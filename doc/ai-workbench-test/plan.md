# NCurator-Desktop AI Workbench 测试总计划

## 1. 目标

本计划用于验证 `workbench` 页面上的 AI 是否真的能“接住用户诉求并把事情做成”，而不是只返回一段看起来合理的回答。

当前阶段的主目标聚焦三类真实诉求：

- 帮用户编辑或编写 `.docx` 文档
- 回答本地知识库问题
- 在必要时结合 `terminal` 读取工作区文件、生成中间材料或辅助完成前两类任务

这份计划按七个层次展开：

1. `tool`
2. `human`
3. `context`
4. `intent`
5. `plan`
6. `entire`
7. `workbench ui`

目标不是一次性做完所有自动化，而是先形成一版可以持续推进的专项测试基线，为下一步测试和优化提供统一框架。

## 2. 文档组织规则

AI workbench 测试文档统一放在 `doc/ai-workbench-test/`。

当前目录只允许存在两个工作文件：

1. `plan.md`
2. `todo-stage-1.md`

后续 `todo-stage-2.md`、`todo-stage-3.md` 等文件，只有在上一轮 todo 全部完成并打勾后，才能创建。

规则如下：

- `plan.md` 负责保留完整测试方案
- `todo-stage-N.md` 只负责当前阶段执行项
- 不在 `plan.md` 中维护当前阶段复选框
- 不在上一轮 todo 未完成时预建下一轮 todo

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
- 当前测试覆盖仍很薄：
  - backend 只有少量 tool happy path
  - e2e 只有基础 smoke

因此这轮测试计划的核心不是“补一点零散 case”，而是建立完整的专项覆盖树。

## 4. 测试范围

### 4.1 本轮纳入范围

- 本地优先场景
- `AI 对话` 模式下的多步任务完成能力
- `纯搜索` 模式下的检索与展示能力
- `.docx` 读取、编辑、保存、预览、校验、回滚能力
- `terminal` 的工作区边界、审批、命令执行与产物发现能力
- 本地知识库检索能力
- `draft review` 审阅中心链路
- `workbench` 页面可用性、布局与关键交互体验

### 4.2 本轮暂不作为核心目标

- 外部联网问答质量
- 多用户协作
- 长周期记忆质量
- 与当前主流程无关的泛化 Agent 能力

### 4.3 模型对比策略

AI 测试里要引入一组固定的“常用模型 + 强模型”对照，因为有些失败来自工程问题，有些失败确实来自模型能力上限。如果没有对比组，很多 case 很难判断该优先优化哪一层。

#### 默认模型组合

| 角色 | 推荐模型 | 用途 | 选择理由 |
| --- | --- | --- | --- |
| 常用模型 | `gpt-5` | 默认测试模型，承担大多数 backend / e2e 主跑 | 与当前主验证链路保持一致，适合作为日常基线 |
| 强模型 | `gpt-5.2` | 对比模型，用于关键样例复跑和疑难 case 复核 | 作为更强档位的同族模型，适合判断问题更偏工程还是能力上限 |

#### 为什么推荐这组而不是别的

- 选同一家族的两个模型，更容易把变量收敛到“能力强弱”，而不是“模型风格差异”。
- `gpt-5` 作为默认主跑，可以直接反映当前主模型配置下的真实完成度。
- `gpt-5.2` 作为强对照，更适合留给关键失败样例、`golden cases` 和最终完成度复核。
- 相比跨家族切换模型，这组组合更容易把结论收敛到“同族不同能力档位”的差异。
- 相比 `deepseek-r1` 这类第三方推理模型，`gpt-5.2` 更适合作为主强对照，因为行为风格更接近主模型族。

#### 配置方式

- `AI_LIVE_PRIMARY_MODEL_NAME`
  - 控制默认 `primaryModel`，当前默认值是 `gpt-5`。
- `AI_LIVE_STRONG_MODEL_NAME`
  - 控制默认 `strongModel`，当前默认值是 `gpt-5.2`。
- 只要 live 配置可用，测试就默认直连模型；若要退回纯 mock，可禁用 `.env` 加载或显式清空 live 配置。

基于你现在能用的模型，我的推荐是：

- 日常常用模型：`gpt-5`
- 更强对比模型：`gpt-5.2`

如果后面需要换 pair baseline，优先只改上述环境变量；测试侧在运行时显式选择 `primary` 或 `strong`，不再额外增加第三个模型开关，也不改 report 字段和 raw log 契约。

#### 如何融入测试流程

- 阶段 1：只固化模型对比策略与记录字段，不要求所有 tool case 都双跑。
- 阶段 2：`human` 关键样例全部用常用模型主跑；失败样例和 `golden cases` 用强模型复跑。
- 阶段 3：`intent / context / plan` 的关键路由 case 做双模型对比。
- 阶段 4：`S01 ~ S04` 的 e2e 用常用模型全跑；完成度低于 `2` 的 case，必须再用强模型复跑。
- 阶段 5：`S05 ~ S08` 与 UI 相关场景沿用同样规则。

#### 双模型结果怎么记录

先不做问题分类，只记录双模型差异。

这里有一个硬约束：不改现有测试架构，不改 `meta.json / timeline.jsonl / artifacts.json` 的固定契约。

落地方式如下：

- `raw log` 层
  - 继续沿用现有 schema。
  - 每次 run 只记录一个真实执行模型。
  - 模型名仍然只通过现有的 `meta.runtime.modelName` 表达。
- 双模型对比层
  - 通过“同一 case 跑两次或多次 run”完成，而不是给单次 run 增加新顶层字段。
  - 对比结果写入 `tests/report/ai/report.md`，而不是改 `meta.json` 顶层。
- 如果个别 case 需要在原始日志里补充轻量上下文
  - 只放进现有 `timeline.jsonl` 事件的 `data` 中。
  - 不引入新的 raw log schema。

因此下面这些记录项，默认都是 report 层概念，不是要求给 raw log 新增字段。

每条需要双跑的 case 建议记录：

- `primaryModel`
- `strongModel`
- `runMode`
  - `single`
  - `pair`
- `primaryScore`
- `strongScore`
- `deltaSummary`
  - 例如：`strong model completed same task with score 3 while primary scored 1`

## 5. 真实用户场景池

测试必须围绕真实诉求，而不是只围绕单个函数或事件。

| 场景 ID | 用户诉求示例 | 涉及能力 | 预期结果 |
| --- | --- | --- | --- |
| `S01` | “把工作区里的 `会议纪要.docx` 改成正式周报格式，并补一个结论段。” | `docx` + `human` | AI 读取原文、定位块、完成修改、输出新文档或审阅结果 |
| `S02` | “根据 `notes.txt` 和 `todo.md`，帮我写一版项目周报 docx。” | `terminal` + `docx` + `plan` | AI 先读取工作区材料，再生成结构化 docx |
| `S03` | “知识库里有没有关于 LanceDB 分层设计的说明？给我结论并引用依据。” | `local_kb_retrieval` + `human` | 返回基于本地资料的答案，证据可回看 |
| `S04` | “先从知识库里找数据库规范，再把 `模板.docx` 里的数据库章节改掉。” | `kb` + `docx` + `plan` | 先检索，再编辑文档，最终进入可预览或可审阅结果 |
| `S05` | “继续刚才第二步，把风险部分写得更保守一点。” | `context` + `intent` | AI 正确判断上下文不足或正确接续前文，而不是误做新任务 |
| `S06` | “去工作区里找最新日报，整理成一版发给领导的汇报。” | `terminal` + `context` + `plan` | AI 先找文件，再读取内容，再生成最终交付 |
| `S07` | “帮我执行一个命令把产物导出来。” | `terminal` + `approval` | AI 给出审批请求，等待用户决策，不越权执行 |
| `S08` | “根据 AI 改写结果，我只接受其中 2 处修改，其他拒绝。” | `draft review` + `ui` | 审阅中心可完成逐条接受、拒绝并提交 |

这 8 类场景足以覆盖当前阶段最重要的真实使用路径。

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
- 结果收敛
  - 保存文档：`docx_save`
  - 预览渲染：`docx_render_preview`
  - 校验：`docx_validate`
  - 历史回看：`docx_get_history`
  - 回滚：`docx_rollback`
- 异常与边界
  - 无效 `blockId`
  - 搜索命中歧义
  - 表格单元格更新失败
  - 多轮编辑后的 lineage 正确性
  - 保存路径冲突与 `overwrite` 行为

复杂诉求要按“用户真的会怎么提”来测，而不是只测单个 API。例如：

- “把第二章整体改写成适配当前项目的版本，保留原来的标题层级，再把风险表最后一列更新成新的负责人。”
- “根据知识库结论，在模板里插入一段新章节，并删除过时段落。”
- “先改三处，再给我渲染预览，如果不对就回滚到上一个版本。”

##### `terminal`

- 读取型能力
  - 在工作区内 `find / rg / ls / cat / sed` 读取材料
  - 多层目录发现文件
  - 相对路径与绝对路径解析
- 复杂命令能力
  - 多段命令
  - 管道与重定向
  - 产物识别与 `file_artifact` 事件
  - 输出截断后的摘要可用性
- 安全与阻塞
  - 工作区边界检查
  - 高中低风险分类
  - 审批请求触发
  - 审批通过 / 拒绝后的后续行为
- 异常与边界
  - 命令失败
  - 长输出
  - 取消执行
  - 工作区外路径逃逸
  - 读写混合命令

复杂诉求要覆盖“terminal 不是独立玩具，而是任务链一部分”的情况。例如：

- “去工作区里把最近三份日报找出来，拼成一份汇报素材。”
- “先看看 `notes/` 目录里有哪些材料，再把关键结论整理进 docx。”
- “执行一个会生成中间文件的命令，然后把生成结果写回文档。”

##### `kb`

- `hybrid` / `vector` / `fts` 检索
- `list documents`
- `source scope` 过滤
- 无结果返回
- 已选范围为空时的表现

#### 建议新增用例

- `tests/ai/backend/tools/docx/docx-open-outline-search.test.ts`
- `tests/ai/backend/tools/docx/docx-complex-structural-edit.test.ts`
- `tests/ai/backend/tools/docx/docx-table-and-mixed-ops.test.ts`
- `tests/ai/backend/tools/docx/docx-save-preview-validate.test.ts`
- `tests/ai/backend/tools/docx/docx-history-rollback-multi-round.test.ts`
- `tests/ai/backend/tools/docx/docx-invalid-op-and-ambiguous-search.test.ts`
- `tests/ai/backend/tools/terminal/terminal-read-workspace-materials.test.ts`
- `tests/ai/backend/tools/terminal/terminal-relative-and-absolute-paths.test.ts`
- `tests/ai/backend/tools/terminal/terminal-multi-segment-artifacts.test.ts`
- `tests/ai/backend/tools/terminal/terminal-workspace-boundary-rejected.test.ts`
- `tests/ai/backend/tools/terminal/terminal-approval-required.test.ts`
- `tests/ai/backend/tools/terminal/terminal-approval-denied-followup.test.ts`
- `tests/ai/backend/tools/terminal/terminal-command-failed.test.ts`
- `tests/ai/backend/tools/terminal/terminal-cancel-or-timeout.test.ts`
- `tests/ai/backend/tools/kb/kb-hybrid-search-basic.test.ts`
- `tests/ai/backend/tools/kb/kb-source-scope-filter.test.ts`
- `tests/ai/backend/tools/kb/kb-no-result.test.ts`

#### 通过标准

- 成功路径返回结果正确且事件完整
- 阻塞路径必须返回清晰的结构化原因
- 失败路径必须可复现、可回看、可归因

### 6.2 `human`

#### 目标

验证 `human` 是否具备“自主推进任务”的能力，而不是只会机械调用单个工具。

#### 重点问题

- 能否根据当前目标主动选择下一步动作
- 工具失败后能否修正路径
- 是否会在证据不足时停下来，而不是胡编
- 是否会在阻塞场景下正确上抛审批 / 工作区请求
- 是否能输出让后续节点继续工作的结构化交付
- 是否能把复杂诉求拆成多个有依赖关系的动作
- 是否能在 `kb / terminal / docx` 之间切换，而不是只会单工具闭环
- 是否能在多轮修改后保持目标不漂移
- 是否能在做不完时给出“部分完成但可继续”的交付

#### 建议场景

- 简单任务单步闭环：直接读取知识库并回答
- 多步工具串联：先找文档，再定位块，再修改，再保存
- 工具失败纠偏：搜索不到块后改用 `outline + get_block`
- 阻塞收敛：发现缺工作区后请求补充，而不是继续空跑
- 审阅收敛：有文档修改时输出 `draft_review_ready`
- 复杂文档改写：多个章节、多种块类型、多轮编辑
- 混合任务：`terminal -> kb/docx`
- 多轮会话：上一轮已有中间结果，这一轮继续精修
- 局部失败：某一步失败后仍能保留已有进展并安全收敛

#### 建议新增用例

- `tests/ai/backend/human/human-single-step-kb-answer.test.ts`
- `tests/ai/backend/human/human-docx-iterative-edit.test.ts`
- `tests/ai/backend/human/human-terminal-docx-handoff.test.ts`
- `tests/ai/backend/human/human-blocked-on-workspace.test.ts`
- `tests/ai/backend/human/human-self-correction-after-tool-failure.test.ts`
- `tests/ai/backend/human/human-complex-docx-rewrite.test.ts`
- `tests/ai/backend/human/human-kb-docx-bridge.test.ts`
- `tests/ai/backend/human/human-multi-turn-refinement.test.ts`
- `tests/ai/backend/human/human-partial-delivery-when-blocked.test.ts`
- `tests/ai/backend/human/human-step-budget-exhaustion.test.ts`

#### 通过标准

- 至少能把简单任务独立做完
- 多步任务中每一步选择与上一步结果一致
- 遇阻塞时不乱答、不越权、不丢状态
- 复杂任务能拆出清晰的行动链，而不是一上来就输出空泛答案
- 工具失败后能切换策略，不重复死循环

### 6.3 `context`

#### 目标

验证系统是否能主动补足后续规划所需上下文，为高质量 `plan` 提供输入。

#### 重点问题

- 用户指代不清时能否识别“需要更多上下文”
- 前文任务续做时能否正确接住会话上下文
- 工作区未准备文件能否纳入上下文判断
- 混合来源任务中能否先收集证据再规划

#### 典型场景

- “继续第二步”
- “按刚才那份文档的格式改这个”
- “根据工作区里最新日报继续写”
- “你先看一下当前目录下有哪些材料，再决定怎么做”

#### 建议新增用例

- `tests/ai/backend/main-context/context-follow-up-reference-resolution.test.ts`
- `tests/ai/backend/main-context/context-workspace-file-discovery.test.ts`
- `tests/ai/backend/main-context/context-hybrid-evidence-collection.test.ts`

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

#### 建议新增用例

- `tests/ai/backend/main-intent/intent-direct-human.test.ts`
- `tests/ai/backend/main-intent/intent-to-plan-docx-task.test.ts`
- `tests/ai/backend/main-intent/intent-need-context-follow-up.test.ts`
- `tests/ai/backend/main-intent/intent-hybrid-task-routing.test.ts`

#### 通过标准

- 简单 / 复杂 / 缺上下文三类任务都有稳定判别
- 路由错误可通过 raw log 直接看出

### 6.5 `plan`

#### 目标

验证生成的计划是否真的可执行、顺序合理、能落地解决用户诉求。

#### 重点问题

- 任务拆解是否缺步或错序
- 是否把“最终总结”错误塞进业务计划
- 是否把证据收集、文档编辑、保存、审阅等关键阶段拆出来
- 任务失败或阻塞后是否能以当前结果收敛

#### 计划质量检查点

- 每个 task 都有明确 objective
- 顺序符合依赖关系
- 不出现“先保存后编辑”这类错误顺序
- 不创建无意义的重复任务
- 任务结果能支撑 `synthesis`

#### 建议新增用例

- `tests/ai/backend/main-plan/plan-docx-edit-workflow.test.ts`
- `tests/ai/backend/main-plan/plan-kb-docx-hybrid-workflow.test.ts`
- `tests/ai/backend/main-plan/plan-terminal-assisted-docx-workflow.test.ts`
- `tests/ai/backend/main-plan/plan-blocked-task-synthesis.test.ts`

#### 通过标准

- 计划具有可执行性
- 计划执行后可得到完整交付或明确阻塞说明
- 阻塞时不会因为某一步失败导致整体状态不可收敛

### 6.6 `entire`

#### 目标

验证从用户输入到最终交付的完整闭环是否成立，这一层直接对应用户真实感受。

这一层的最终形态不是 backend 集成，而是基于真实用户场景池的 `workbench e2e` 完成度测试。

#### 总体场景完成度判定

每个真实用户场景都要按“完成度”而不是只按 `pass/fail` 评估。

| 分值 | 含义 |
| --- | --- |
| `3` | 完整完成，用户目标达成，结果可直接消费 |
| `2` | 主目标完成，但还需要少量人工修补 |
| `1` | 只完成部分步骤，有中间产物，但没真正完成诉求 |
| `0` | 失败或阻塞，用户诉求未完成 |

#### 总体 e2e 场景套件

最终要按第 5 节的真实用户场景池逐条落地 e2e：

| 场景 | e2e 关注点 | 完成度判定关键点 |
| --- | --- | --- |
| `S01` | 编辑现有 docx | 是否成功读文档、修改、产出审阅或文件 |
| `S02` | 工作区材料生成 docx | 是否成功读材料、组织结构、生成文档 |
| `S03` | 知识库问答 | 是否给出答案且依据可回看 |
| `S04` | 知识库 + docx 混合任务 | 是否先检索再改文档，链路顺序正确 |
| `S05` | 多轮续做 | 是否正确接续前文，而不是重新跑偏 |
| `S06` | terminal 读工作区后再交付 | 是否先发现材料再完成最终产物 |
| `S07` | terminal 审批流 | 是否正确停下等待审批，并在批准或拒绝后收敛 |
| `S08` | 审阅中心部分接受后提交 | 是否能真实完成审阅提交闭环 |

#### 优先覆盖的完整任务

- `E01` 编辑现有 docx 并进入审阅
- `E02` 从工作区文本生成 docx
- `E03` 基于知识库回答问题并给出依据
- `E04` 先检索知识库，再修改 docx
- `E05` 触发 terminal 审批并完成批准 / 拒绝分支
- `E06` 工作区未绑定时请求用户补充后继续
- `E07` 审阅中心接受部分修改并提交
- `E08` 多轮 follow-up 任务连续完成

#### 建议新增用例

- backend 快速集成：
  - `tests/ai/backend/entire/entire-docx-edit-review-ready.test.ts`
  - `tests/ai/backend/entire/entire-workspace-to-docx.test.ts`
  - `tests/ai/backend/entire/entire-kb-question-answer.test.ts`
  - `tests/ai/backend/entire/entire-kb-docx-mixed-task.test.ts`
  - `tests/ai/backend/entire/entire-terminal-approval-flow.test.ts`
- 最终总体 e2e：
  - `tests/ai/e2e/workbench/scenarios/scenario-s01-docx-rewrite.test.ts`
  - `tests/ai/e2e/workbench/scenarios/scenario-s02-workspace-to-docx.test.ts`
  - `tests/ai/e2e/workbench/scenarios/scenario-s03-kb-answer.test.ts`
  - `tests/ai/e2e/workbench/scenarios/scenario-s04-kb-docx-hybrid.test.ts`
  - `tests/ai/e2e/workbench/scenarios/scenario-s05-follow-up-context.test.ts`
  - `tests/ai/e2e/workbench/scenarios/scenario-s06-terminal-materials-to-delivery.test.ts`
  - `tests/ai/e2e/workbench/scenarios/scenario-s07-terminal-approval.test.ts`
  - `tests/ai/e2e/workbench/scenarios/scenario-s08-review-partial-commit.test.ts`

#### 通过标准

- 不是只看到事件跑过，而是场景本身达到目标
- 每个场景都有完成度记录
- 用户最终拿到可消费结果，而不是一堆中间事件
- 事实链完整，日志可复盘
- e2e 才是这一层的最终验收

### 6.7 `workbench ui`

#### 目标

保证工作台至少是“可用”的，避免出现布局溢出、信息不可见、按钮难点、状态难理解等问题。

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

#### 建议新增 e2e 用例

- `tests/ai/e2e/workbench/workbench-kb-search-answer.test.ts`
- `tests/ai/e2e/workbench/workbench-workspace-required-flow.test.ts`
- `tests/ai/e2e/workbench/workbench-approval-banner-flow.test.ts`
- `tests/ai/e2e/workbench/workbench-draft-review-flow.test.ts`
- `tests/ai/e2e/workbench/workbench-small-window-layout.test.ts`
- `tests/ai/e2e/workbench/workbench-search-mode-scope-filter.test.ts`

#### UI 通过标准

- 无阻塞级布局问题
- 无关键状态缺失
- 无明显滚动冲突
- 关键链路可在目标窗口尺寸下完成

## 7. 测试分层落位

建议继续沿用 `doc/test.md` 里已经约定的目录树：

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
        scenarios/
```

对应关系如下：

| 能力层 | 测试层 | 主要目的 |
| --- | --- | --- |
| `tool` | backend | 验证单能力与边界 |
| `human` | backend | 验证自主执行与纠偏 |
| `context` | backend | 验证上下文补全 |
| `intent` | backend | 验证路由判断 |
| `plan` | backend | 验证计划拆解与执行顺序 |
| `entire` | backend + e2e | backend 做快速集成，e2e 做真实场景完成度验收 |
| `workbench ui` | e2e | 验证真实交互与可用性 |

## 8. 执行节奏

建议按五个阶段推进，而不是一次铺满全部 case。

### 阶段规则

- 一次只做当前阶段的 `todolist`
- 当前阶段没有跑完、没有沉淀结果前，不进入下一阶段
- 每个阶段结束都必须输出：
  - raw logs
  - 一份阶段完成情况
  - 下一阶段 `todolist`
- 不要一上来把全部场景、全部 UI、全部回归一次铺开

### 阶段 1：能力打底

目标：先把 `tool` 层补齐，并把复杂 `docx / terminal` 场景打透。

优先级：

1. `docx`
2. `terminal` 阻塞与失败
3. `kb`

产出：

- backend raw logs
- 已确认的常用模型 / 强模型组合
- 一份阶段完成情况
- 下一阶段 `todolist`

### 阶段 2：`human` 核心能力

目标：把 `human` 单独拉出来验证，因为这是整个 AI 设计里最核心的执行体。

优先级：

1. 单步闭环
2. 多工具串联
3. 工具失败纠偏
4. 多轮 refinement
5. 阻塞后的部分交付

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

产出：

- backend raw logs
- 一份阶段完成情况
- 下一阶段 `todolist`

### 阶段 4：完整任务闭环

目标：把真实用户场景池的第一批 e2e 串起来，开始看场景完成度。

优先级：

1. `S01`
2. `S02`
3. `S03`
4. `S04`

产出：

- e2e raw logs
- 场景完成度表
- 一份阶段完成情况

### 阶段 5：第二批场景与 UI 可用性

目标：补第二批真实场景 e2e，并集中处理 UI 可用性。

优先级：

1. `S05`
2. `S06`
3. `S07`
4. `S08`
5. 小窗口布局与右侧面板稳定性

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
- `primaryModel`
- `strongModel`
- `runMode`
- 用户输入
- 预期结果
- 实际结果
- 完成度分值：`0 / 1 / 2 / 3`
- `primaryScore`
- `strongScore`
- 最终产物路径、回答摘要或审阅结果
- raw log 路径
- 下一步建议

### 跑完后的沉淀方式

1. 先落 raw logs 到 `tests/logs/ai/**`
2. 再更新 `tests/report/ai/report.md`
3. 在 report 中记录当前阶段完成情况与双模型对比结果
4. 最后给出“下一阶段 `todolist`”

## 10. Golden Cases

这些样例作为每次优化后的回归主样例：

- `G01` 编辑现有 `.docx` 并进入审阅
- `G02` 从工作区文本材料生成 `.docx`
- `G03` 回答知识库问题并给出依据
- `G04` 先搜知识库再修改 `.docx`
- `G05` terminal 命令审批通过后继续完成任务
- `G06` terminal 命令审批拒绝后给出安全收敛
- `G07` 工作区缺失时提示补充并可继续
- `G08` 小窗口下完整跑通一次 AI 对话链路

## 11. 阶段验收标准

建议把“当下测试计划”的验收标准定成以下四条：

- 已建立完整测试树，不再只有 smoke case
- 七层能力都有对应 case 设计与落位目录
- 至少一轮完整 raw log + report 分析已经按此计划执行
- 已形成一份按优先级排序的下一阶段 `todolist`，能够直接指导下一轮优化

如果要进入下一阶段实现，优先顺序建议是：

1. 补 `tool` 层缺口，尤其是 `docx` 与 `kb`
2. 单独验证 `human` 核心能力
3. 补 `intent / plan / context`
4. 补高价值 `entire` 场景
5. 集中整治 `workbench ui` 可用性问题

## 12. 本计划对应的输出物

按这份计划推进后，建议每轮测试固定产出以下内容：

- 新增或更新的测试用例
- `tests/logs/ai/**` 原始日志
- `tests/report/ai/report.md` 分析结论
- 一份阶段完成情况
- 一份下一轮优化目标列表

这会让后续测试不再停留在“感觉 AI 这次还行”，而是变成能被持续验证和持续改进的工程闭环。
