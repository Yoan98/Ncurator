# docx-tool-capability Specification

## Purpose
TBD - created by archiving change tool-based-terminal-docx-capability. Update Purpose after archive.
## Requirements
### Requirement: Implement docx capability as tool-driven execution
The `docx` capability MUST be implemented as a LangChain tool-driven executor and MUST NOT remain a placeholder response once this change is applied.

#### Scenario: Docx task is dispatched
- **WHEN** host dispatches a `docx` task
- **THEN** runtime executes concrete docx tools and returns a real task result instead of `not_implemented`

### Requirement: Keep docx runtime Node.js-first
The `docx` capability implementation MUST run with Node.js-compatible dependencies and MUST NOT require Python libraries or external system tools as baseline end-user requirements.

#### Scenario: Runtime dependency validation
- **WHEN** docx tools are installed and packaged for app runtime
- **THEN** capability operation succeeds without requiring Python or system package installation by end users

### Requirement: Provide structured docx tool set
`docx` capability MUST 提供结构化工具以完成文档检查、内容检索、编辑应用、草稿预览生成、审阅交接和显式完成；在 AI 运行阶段，直接把修改写回用户真实文件 MUST NOT 作为默认完成路径。

#### Scenario: docx 编辑运行返回待审阅草稿
- **WHEN** 用户要求修改一个现有 `.docx`
- **THEN** capability MUST 通过结构化工具完成 inspect/search/apply/preview 等步骤，并在运行结束时返回可审阅的草稿结果，而不是直接覆盖源文件

### Requirement: Enforce workspace and write-safety policies for docx operations
`docx` capability MUST 要求文件操作具备工作空间边界；在 AI 运行阶段，capability MUST NOT 直接覆盖用户真实文档；当用户在最终提交阶段选择写入已存在路径时，系统 MUST 先经过显式审批或确认后再执行覆盖。

#### Scenario: 运行完成时真实文件保持不变
- **WHEN** 一次 docx 编辑运行已经完成，但用户尚未完成草稿审阅与最终提交
- **THEN** capability MUST 保持源 docx 文件未被改写

#### Scenario: 提交到已存在路径需要审批
- **WHEN** 用户确认提交并选择覆盖一个已存在的目标 docx 路径
- **THEN** 系统 MUST 在真正写盘前请求相应审批或确认

### Requirement: Preserve draft snapshots before save
`docx` capability MUST 在编辑流程中保留不可变草稿快照，并允许在保存前查看快照历史和回滚到祖先快照；在同一运行内，后续 inspect/search/apply 操作 MUST 默认基于当前最新草稿快照继续执行，而不是回退到原始源文件内容。

#### Scenario: 后续读取基于最新草稿继续执行
- **WHEN** 文档已经生成一个新的草稿快照，随后在同一运行中再次执行 docx 搜索或读取
- **THEN** capability MUST 基于该最新草稿快照返回结果，使 AI 能读到先前编辑后的文本信息

#### Scenario: 用户或系统需要回滚到旧草稿
- **WHEN** 当前草稿快照不再适合继续编辑，且存在可用祖先快照
- **THEN** capability MUST 能在不写盘的前提下回滚到某个祖先快照继续处理

### Requirement: Run bounded internal tool loops and finish explicitly
The `docx` capability MUST run an internal tool loop to satisfy the task objective, MUST enforce bounded loop limits (for example max-step and timeout), and MUST terminate with explicit success or failure state.

#### Scenario: Docx task requires multiple iterative tool steps
- **WHEN** a docx objective cannot be completed in a single tool call
- **THEN** the capability continues iterative inspect/plan/apply/save tool execution within configured limits until finish is emitted

#### Scenario: Docx loop exceeds configured bounds
- **WHEN** the capability reaches max-step or timeout limit before completion
- **THEN** the task is marked failed with a bounded-loop error and no further docx tool calls are executed

### Requirement: Defer user confirmation until run completion
`docx` capability MUST 在一次编辑运行中自行完成全部内部编辑步骤，并 MUST NOT 因单个块级修改而暂停运行请求用户逐块确认；若本次运行产生可提交修改，capability MUST 在全部 docx 编辑步骤完成后再交付统一的审阅集合。

#### Scenario: 多个块级编辑在一次运行中连续完成
- **WHEN** capability 在一次运行中连续完成多个块或多个位置的 docx 修改
- **THEN** 系统 MUST 允许这些修改在草稿快照链上连续完成，并在运行结束后才进入统一审阅阶段

