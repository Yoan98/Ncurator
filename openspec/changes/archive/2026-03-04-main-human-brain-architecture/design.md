## Context

当前运行时以 host 决策循环为核心，系统编排与任务执行共用同一控制层，导致能力增多后工具选择噪声、状态传递不稳定、职责边界不清晰。  
本次变更基于 `proposal.md` 执行重构：采用 `main graph`（系统编排）+ `human graph`（单任务执行）双层模型，且明确为 **BREAKING**，不保留旧 host 兼容路径。  

约束条件：
- 运行时仍基于 LangGraph；
- brain 必须作为唯一工具调用入口；
- capability 保留为代码层模块边界（维护与扩展），不再承载内部 AI 决策循环；
- 动态工具机制必须沿用 LangGraph tool 调用方式（`bindTools` + `ToolNode`）。

## Goals / Non-Goals

**Goals:**
- 建立 main/human 双层职责边界：main 负责编排，human 负责单任务执行闭环。
- 建立 brain 单循环模型：每一步都由 brain 在 active tools 中选择并触发工具调用。
- 通过 Tool Broker 动态筛选 active tools（每步小集合），避免全量工具平铺导致能力退化。
- 建立步骤级状态契约（`consume / produce / expect`）和 slot memory 提交机制，确保“上一步结果可稳定驱动下一步”。
- 将 capability 执行收敛为原子执行器，移除 capability 内部 AI 循环。
- 保持 workspace/approval 等安全边界在重构后语义不弱化。

**Non-Goals:**
- 不兼容并行保留旧 host 决策路径。
- 不在本次引入新的业务能力（如新增 docx/terminal 功能面）。
- 不改变现有存储基础设施（LanceDB/StorageService）职责边界。
- 不在本次定义 UI 的最终视觉形态，仅定义事件与语义契约。

## Decisions

### 1) 采用 main/human 双层运行时模型

**Decision**
- `main graph` 仅保留系统级阶段：`probe -> context_enrichment_loop -> plan -> dispatch_to_human -> finalize`。
- `human graph` 仅处理一个 task objective，内部执行 `brain -> tool -> observe -> brain` 的步骤循环。
- plan 中每个任务必须独立派发到 human，避免隐式共享执行态。

**Rationale**
- 降低单层控制器复杂度，避免编排逻辑与执行逻辑互相污染。
- 为后续 main 层扩展新节点（历史整合、策略节点）保留稳定边界。

**Alternatives considered**
- 继续扩展单层 host：短期改动小，但会持续放大耦合与调试难度。
- 为每个 capability 独立建图：边界清晰但会造成跨能力编排碎片化。

### 2) brain 成为唯一工具调用入口，统一使用 LangGraph tool 机制

**Decision**
- human 每一步都先计算 active tools，再由 brain 通过 `bindTools(activeTools)` 生成 tool call。
- 工具执行统一通过 `ToolNode(activeTools)`，并要求与本步 `bindTools` 使用同一份工具集合。
- capability 不再运行独立 AI 循环；只提供原子工具执行函数。

**Rationale**
- 避免“双大脑”竞争（brain 决策 + capability 内部 AI 决策）导致不可预测行为。
- 与现有 LangGraph 技术栈一致，减少额外框架复杂度。

**Alternatives considered**
- brain 仅做能力级决策、能力内继续 AI 循环：会形成双重循环，状态与错误归因复杂。
- 非 tool-call 的自由文本指令执行：可控性与审计能力不足。

### 3) 引入 Tool Broker，按步骤动态暴露小规模 active tools

**Decision**
- 保留全量 capability registry，但每一步由 Tool Broker 确定 `activeTools`（默认 3~6）。
- Broker 采用确定性规则筛选：白名单约束、前置条件、slot 可用性、策略门禁、目标匹配打分。
- brain 在每一步只可见 active tools，不直接感知全量工具集。

**Rationale**
- 工具数量增长到十几/二十个时，全量暴露会显著降低工具选择质量。
- 步骤级动态筛选既保证扩展性，又控制每轮推理复杂度。

**Alternatives considered**
- 永远全量暴露工具：实现简单，但在多工具场景下质量不稳定。
- 固定 capability 绑定固定工具集：稳定但不够灵活，难以适配跨阶段切换。

### 4) 使用通用步骤契约 `consume / produce / expect` + task slot memory

**Decision**
- brain 每步动作必须声明：
  - `consume`: 本步读取的 slot 引用；
  - `produce`: 本步承诺写入的 slot；
  - `expect.requiredOutputs`: 本步完成所需输出。
- 执行结果先标准化，再原子提交到 task slot memory；提交成功后才允许进入下一步。
- 大文本/大文件通过 `ref` 存储，prompt 仅传摘要与引用。

**Rationale**
- 将跨步骤依赖从“隐式上下文记忆”改为“显式状态引用”，解决结果丢失与漂移问题。
- 便于回放、审计与失败恢复。

**Alternatives considered**
- 只靠自然语言上下文串联：实现快但易丢失关键信息。
- capability 内持久化私有状态：跨能力不可见，调试与治理困难。

### 5) capability registry 从执行器清单升级为“执行器 + 元数据 +策略约束”

**Decision**
- 每个 capability/tool 需声明元数据：`tags`、`requiresWorkspace`、`requiresApproval`、`consumes`、`produces`、`inputSchema`、`outputSchema`。
- Broker 仅依据该元数据筛选与排序，不直接读取工具实现细节。
- capability 仍按代码目录分层维护（便于扩展与测试），但运行时调度权归 brain + broker。

**Rationale**
- 支撑动态工具筛选与稳定参数校验。
- 保持“运行时统一”与“代码可维护”两者平衡。

**Alternatives considered**
- 无元数据仅靠提示词选工具：难以可靠约束。
- 将所有规则硬编码在 brain prompt：可运营性差。

### 6) 事件语义重构为双层阶段与步骤级可观测

**Decision**
- 事件必须表达 `main stage` 与 `human step` 语义，区分系统编排阶段与任务步骤执行。
- 每步记录：active tools 快照、broker 选择理由、tool 调用与结果、slot 提交结果。
- 旧 host 专属事件语义不再作为兼容目标。

**Rationale**
- 动态工具机制若缺少可观测信息，问题定位成本会显著上升。
- UI 与调试链路需要稳定分层语义。

**Alternatives considered**
- 仅沿用旧 activity 语义：无法表达动态工具决策过程。

### 7) 失败收敛语义：human 内 `block_task`，main 负责后续编排决策

**Decision**
- human 无法满足 `expect` 或遇到不可继续条件时返回 `block_task`（附阻塞原因与证据）。
- main 统一处理任务失败/阻塞后的编排策略（继续、失败收敛、后续 replan）。
- human 层不做跨任务 replan。

**Rationale**
- 保持“single task executor”定位，避免 human 再次上升为编排器。

**Alternatives considered**
- human 内直接改写 plan：会重新混淆分层职责。

## Risks / Trade-offs

- [Risk] 动态工具集与执行工具集不一致，导致 tool call 失配  
  -> Mitigation: 每步生成唯一 `activeToolSetId`，`bindTools` 与 `ToolNode` 绑定同一实例并记录快照。

- [Risk] capability 内部循环移除后，单步失败率短期上升  
  -> Mitigation: 在 human 层增加步骤预算与失败重试策略（有限重试），并通过 `expect` 门槛控制推进。

- [Risk] slot 设计不当导致状态膨胀或命名混乱  
  -> Mitigation: 约束命名规范（`slot:<domain>.<name>`）、大小阈值、ref 化存储策略。

- [Risk] Broker 规则过强导致可用工具过少，任务无法推进  
  -> Mitigation: 设置最小候选兜底策略（min active count）与降级路径（放宽低优先级过滤条件）。

- [Risk] 事件量增长影响 UI 渲染与日志成本  
  -> Mitigation: 定义事件采样与摘要策略，区分调试级与展示级事件。

- [Risk] BREAKING 重构一次切换导致上线风险集中  
  -> Mitigation: 采用阶段性交付和回放验证，在合并前完成关键场景验收并预留快速回滚分支。

## Migration Plan

1. 先定义并落地共享契约类型：`HumanTaskInput`、`BrainStepAction`、`CapabilityResult`、`HumanTaskOutput`、slot 结构与事件扩展字段。
2. 重构 main graph：移除旧 host 控制路径，改为 main 阶段编排 + human 任务派发。
3. 实现 human runner：brain 步骤循环、broker 选择、LangGraph 动态 tools 调用、slot 提交流程。
4. capability 适配：将现有 capability 调整为原子执行器（去内部 AI 循环），补齐元数据与 schema。
5. 事件流改造：补充步骤级与 broker 观测事件，更新 renderer 语义映射。
6. 场景回放与验收：覆盖直达完成、跨步依赖、工具切换、审批/工作区门禁、阻塞收敛等核心路径。

**Rollback strategy**
- 本次为 BREAKING 重构，不保留运行时双路径。回滚策略为代码级回滚（revert 到重构前稳定提交），而非运行时开关回退。

## Open Questions

- Broker 评分是否完全规则化，还是允许引入轻量模型评分作为次级排序器？
- slot memory 的持久化边界：仅 run 内存态，还是需要可选会话级持久化快照？
- human `block_task` 到 main 后的默认策略优先级（直接失败 / 继续剩余任务 / 触发 replan）如何定义为统一产品策略？
- 动态 active tools 的默认大小（3~6）是否按 capability 类型可配置？
