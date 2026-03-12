## MODIFIED Requirements

### Requirement: Emit artifact metadata for capability file outputs
运行时 MUST 在能力生成本地产物时发出产物元数据事件，并且产物元数据 MUST 明确区分预览产物、草稿产物与最终提交产物；对于预览产物和草稿产物，事件语义 MUST NOT 让 Renderer 误判为用户真实文件已经被改写。

#### Scenario: 运行中生成 docx 预览产物
- **WHEN** docx 能力在运行中基于当前草稿快照生成一个预览文件
- **THEN** 事件流 MUST 包含该预览产物的元数据，并明确其属于预览或草稿角色，而不是最终提交结果

#### Scenario: 审阅完成后生成最终提交产物
- **WHEN** 用户完成审阅并触发最终提交，系统写出真实文件结果
- **THEN** 事件流或关联提交通道 MUST 明确标识该产物为最终提交结果

### Requirement: Keep artifact events correlated and UI-usable
产物事件 MUST 提供足够的稳定关联字段，使 Renderer 能把某个产物关联到对应的 run、task、草稿文档或提交结果，并直接渲染打开、定位和预览交互，而无需从通用 JSON 文本中启发式提取路径。

#### Scenario: Renderer 收到混合事件流中的草稿预览产物
- **WHEN** 草稿预览产物事件与工具事件、步骤事件、审批事件混合到同一运行流中
- **THEN** Renderer MUST 能稳定把该预览产物归类到对应步骤或草稿文档，而不依赖路径字符串猜测
