# NCurator-Desktop Workbench 测试计划

## 1. 总体目标

本计划用于定义 workbench 用户可见能力的正式测试范围。

workbench 正式测试统一对齐 [workbench.md](/Users/test/work-space/NCurator-Desktop/doc/prd/workbench.md)，新增、调整或验收结论都应引用对应的 `WB-*` 需求编号与验收编号。

## 2. Suite 设计

workbench 的正式测试 suite 直接对齐 PRD 模块：

1. `core`
2. `session`
3. `composer`
4. `mode`
5. `scope`
6. `blocker`
7. `panel`
8. `review`


### 2.1 `core`

做什么：验证 workbench 的核心能力边界与上下文使用前提。

为什么：这是后续会话、发送、检索和执行的共同基础。

怎么做：围绕本地资料是否可选、显式资料范围是否影响执行、问答与受支持文件任务中的本地资料优先 / 模型知识回退、`terminal` 结果是否被后续交付消费、当前受支持文件类型的新增 / 编辑能力边界是否清晰等规则组织正式 case。

### 2.2 `session`

做什么：验证会话初始化、切换、删除和续做主线保持。

为什么：会话状态一旦失真，后续所有运行态和右侧内容都会串线。

怎么做：围绕默认会话创建、切换重置、标题更新、删除后回退和同会话续做组织正式 case。

### 2.3 `composer`

做什么：验证输入、发送、取消和本地执行前置校验。

为什么：composer 是 workbench 的主入口，错误会直接放大到整条任务链路。

怎么做：围绕发送前置条件、键盘行为、智能/搜索发送路径、本地执行拦截、`terminal` 调用前置条件和取消运行组织正式 case。

### 2.4 `mode`

做什么：验证智能模式与搜索模式的切换和约束。

为什么：模式切换会直接改变发送路径、结果呈现和范围校验。

怎么做：围绕模式切换保持输入、搜索模式严格范围校验组织正式 case。

### 2.5 `scope`

做什么：验证 `@` 资料范围、source scope 和范围清理规则。

为什么：资料范围是 workbench 和资料体系之间的核心接口。

怎么做：围绕候选来源、插入删除、重复去重、跨工作区清理和空候选提示组织正式 case。

### 2.6 `blocker`

做什么：验证 AI 运行中的阻塞、恢复和 warning。

为什么：审批、补工作区和未加载资料提示都会直接影响任务是否能继续完成。

怎么做：围绕审批阻塞、`workspace_required` 恢复和未加载资料 warning 组织正式 case。

### 2.7 `panel`

做什么：验证右侧内容面板的状态切换与内容打开规则。

为什么：搜索结果、文档查看和 review 入口都依赖右侧面板稳定收口。

怎么做：围绕空态、搜索结果、本地文档查看和 review 入口衔接组织正式 case。

### 2.8 `review`

做什么：验证确认修改流程。

为什么：review 是 workbench 中最直接影响文档落盘的用户可见链路。

怎么做：围绕 review 打开、默认选中、修改导航、提交前校验、现有受支持文件写回、新建受支持文件落盘、放弃、结束态和多 review 入口组织正式 case。

## 3. Suite 归属规则

- Workbench 的用户可见行为默认归入本计划，不再挂到 AI 或 Settings 域下。
- `scope`、`workspace_required` 恢复、右侧面板和 `review` 统一归入 workbench。
- 所有正式结论都应优先引用 [workbench.md](/Users/test/work-space/NCurator-Desktop/doc/prd/workbench.md) 中对应的 `WB-*` 编号。
- Workbench 正式目录路径与 case 登记规则统一以 [test.md](/Users/test/work-space/NCurator-Desktop/doc/test.md) 为准。

## 4. Case 登记约定

- 本文中的 `用例名称` 直接作为稳定 `caseId` 使用。
- 当前 `workbench` 域下还没有已登记的正式测试文件，因此新增 case 默认先标记为 `未实现`；只有本次实际补齐的 case 会标为 `已实现`。
- `panel` 与 `review` 当前不额外拆 `group`；若后续没有新增层级需求，正式 case 默认直接落在 `tests/workbench/<suite>/`。
- 文件映射规则：
  - `backend`：`tests/workbench/<suite>/<caseId>.test.ts`
  - `e2e`：`tests/workbench/<suite>/<caseId>.e2e.test.ts`
- `How` 与 `Oracle` 必须显式映射到 [workbench.md](/Users/test/work-space/NCurator-Desktop/doc/prd/workbench.md) 的需求编号与验收编号。

## 5. 正式 Case 清单

### 5.1 `panel`

#### `panel-session-persistent-state`

- 用例名称：`panel-session-persistent-state`
- 测试类型：`e2e`
- 实现状态：`已实现`
- What：验证同一会话内继续发送消息时，右侧不会默认清空，而是保留当前搜索列表、文件预览或确认修改工作区；切换会话后才重置。
- Why：右侧从临时附属栏变为会话内持续工作区后，若状态被错误清空，用户会直接丢失当前阅读或确认上下文。
- How：在同一会话内先后覆盖搜索列表、文件预览和确认修改工作区三种状态，再发送新消息；随后切换到另一会话；对齐 `WB-PANEL-001`，覆盖 `WB-PANEL-001-AC1`、`WB-PANEL-001-AC2`。
- Oracle：
  - 同会话继续发送消息后，右侧仍保留当前相关状态，对齐 `WB-PANEL-001-AC1`。
  - 当前正在查看 A 文件时，B 文件的新 review 只能作为新 tab 加入，不能抢走当前焦点，对齐 `WB-PANEL-001-AC1`。
  - 切换会话后，右侧回到空态或新会话对应状态，对齐 `WB-PANEL-001-AC2`。
- Not：不验证 review 具体差异内容，只验证右侧状态收口。

#### `panel-search-local-preview-modal`

- 用例名称：`panel-search-local-preview-modal`
- 测试类型：`e2e`
- 实现状态：`已实现`
- What：验证搜索模式下点击本地结果会使用 modal 预览文件，关闭 modal 后仍停留在搜索列表；网页结果继续外部打开。
- Why：这是右侧从“列表+嵌入预览”切到“列表+modal”后的核心交互边界，错误会直接破坏搜索上下文。
- How：在搜索模式准备同时包含本地与网页结果的 fixture，分别点击两类结果；对齐 `WB-PANEL-002`，覆盖 `WB-PANEL-002-AC1`、`WB-PANEL-002-AC2`。
- Oracle：
  - 点击网页结果时，触发系统浏览器打开，不进入本地预览，对齐 `WB-PANEL-002-AC1`。
  - 点击本地结果时，打开文件预览 modal；关闭 modal 后，搜索列表和当前选中命中仍在，对齐 `WB-PANEL-002-AC2`。
- Not：不验证文档渲染细节和外部浏览器窗口样式。

### 5.2 `review`

#### `review-cumulative-docx-diff`

- 用例名称：`review-cumulative-docx-diff`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证同一文件多轮未提交修改后，最新 review 展示的是“源文件 vs 当前最新草稿”的累计差异，而不是仅最后一轮增量。
- Why：这是 `WB-REVIEW-008` 的核心语义，若后端仍按增量出 review，右侧会漏掉先前轮次仍然成立的差异。
- How：构造同一 `docx` 文件的源文档与最新草稿，覆盖“第一轮改第 3 块，第二轮改第 2 / 3 块”的场景，直接调用累计 diff 生成逻辑；对齐 `WB-REVIEW-008`，覆盖 `WB-REVIEW-008-AC1`、`WB-REVIEW-008-AC2`。
- Oracle：
  - 输出的 change seeds 同时包含相对源文件仍然成立的第 2 / 3 块差异，对齐 `WB-REVIEW-008-AC1`。
  - 若后一轮覆盖了前一轮某处改动，则输出只保留最新仍成立的差异，不残留旧标记，对齐 `WB-REVIEW-008-AC2`。
- Not：不验证 renderer tab 切换和 anchor 定位；这里只验证后端累计 diff 事实。

#### `review-table-cell-cumulative-diff`

- 用例名称：`review-table-cell-cumulative-diff`
- 测试类型：`backend`
- 实现状态：`已实现`
- What：验证表格在行列结构不变时，会收敛成单元格级累计 diff；结构变化时退化为整表替换。
- Why：`docx` 的表格是累计 diff 最容易失真的结构，如果这里不稳，review 会错误放大为整块替换或漏掉单元格变更。
- How：分别构造“同一单元格多轮修改且表格结构不变”和“表格行列结构变化”的源文档 / 最新草稿，调用累计 diff 生成逻辑；对齐 `WB-REVIEW-008`，并补充支撑 `WB-REVIEW-004` 的文件级确认边界。
- Oracle：
  - 表格结构不变时，输出 `update_table_cell`，并指向正确的 `(row,col)` 单元格。
  - 表格结构变化时，输出退化为整表 `replace_block`，而不是错误地生成失真的单元格更新。
- Not：不验证 commit/discard UI；这里只验证表格 diff 退化策略。

#### `review-file-tabs-and-file-level-actions`

- 用例名称：`review-file-tabs-and-file-level-actions`
- 测试类型：`e2e`
- 实现状态：`已实现`
- What：验证多文件 review 在右侧按文件 tab 展示，切换 tab 后只操作当前文件，并保持预览优先布局。
- Why：这是新的 review 工作区核心入口，若 tab 聚合或文件级动作串线，会直接造成错误确认 / 放弃。
- How：准备同一会话内多个待确认文件，进入确认修改工作区后切换 tab，并分别执行确认或放弃；对齐 `WB-PANEL-003`、`WB-REVIEW-001`、`WB-REVIEW-004`、`WB-REVIEW-007`。
- Oracle：
  - 右侧以一文件一 tab 展示全部 active review 文件，不会互相覆盖，对齐 `WB-PANEL-003-AC2`、`WB-REVIEW-007-AC2`。
  - 先确认替换当前文件后，只当前文件被写回并从 active tabs 中移除，其他文件继续保留，对齐 `WB-REVIEW-004-AC1`。
  - 放弃剩余文件时，只当前 tab 对应文件退出 review，其他文件不受影响，对齐 `WB-REVIEW-004-AC3`。
- Not：不验证 docx 累计 diff 的具体内容；该部分由 backend case 覆盖。

#### `review-change-navigation-and-anchor`

- 用例名称：`review-change-navigation-and-anchor`
- 测试类型：`e2e`
- 实现状态：`已实现`
- What：验证确认修改工作区通过上一处 / 下一处切换当前修改时，计数与 docx 预览 anchor 会同步变化。
- Why：这是 review 工作区的核心阅读路径，如果计数变化了但预览没定位，用户无法准确审阅对应差异。
- How：准备单文件 review，进入确认修改工作区后依次点击下一处和上一处，检查当前修改计数与 docx 预览 anchor；对齐 `WB-REVIEW-001`、`WB-REVIEW-002`。
- Oracle：
  - 打开 review 后默认选中第一条修改，对齐 `WB-REVIEW-001-AC2`。
  - 点击上一处 / 下一处时，当前修改计数明确变化，对齐 `WB-REVIEW-002-AC1`。
  - docx 预览随当前修改切换到不同 anchor，并可回到原始 anchor，对齐 `WB-REVIEW-002-AC2`。
- Not：不验证 docx 渲染像素细节；这里只验证导航与 anchor 对齐关系。
