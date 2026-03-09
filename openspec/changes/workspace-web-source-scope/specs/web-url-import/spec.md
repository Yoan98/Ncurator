## MODIFIED Requirements

### Requirement: 支持以 URL 作为导入数据源
系统 MUST 允许用户在网页资料来源中提供一个或多个网页地址（URL），并将每个 URL 作为一个可复用的网页资料来源进行抓取、保存和后续刷新，而不是仅作为一次性导入动作处理。

#### Scenario: 新增一个网页资料来源
- **WHEN** 用户在网页资料入口填写一个合法的网页 URL 并开始导入
- **THEN** 系统 MUST 创建一个网页资料来源记录，并开始抓取该 URL 的内容用于后续索引与范围选择

### Requirement: 记录网页文档的来源元数据
系统 MUST 为网页类型文档记录可供资料来源管理与范围选择复用的来源元数据，至少包含：`url`、`title`（可为空）、`sourceType=web`、`fetchedAt`，以及可关联网页资料来源的稳定标识。

#### Scenario: 导入后可复用网页资料来源
- **WHEN** 一个网页 URL 导入成功并产生文档记录
- **THEN** 文档元数据 MUST 包含 url、sourceType=web、fetchedAt 与对应的网页资料来源标识，以便 UI 展示、后续刷新与 `@` 范围选择复用

## ADDED Requirements

### Requirement: 网页资料来源可在统一范围选择中被引用
系统 MUST 将导入成功的网页资料来源暴露给统一范围选择模型，使其能够在聊天 `@` 与搜索范围选择中作为独立来源被引用。

#### Scenario: 网页资料出现在范围候选中
- **WHEN** 某个网页 URL 已成功抓取并建立索引
- **THEN** 系统 MUST 使该网页资料出现在统一范围候选列表中，并可被用户单独选择
