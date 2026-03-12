# web-document-search Specification

## Purpose
TBD - created by archiving change import-web-url. Update Purpose after archive.
## Requirements
### Requirement: 网页类型文档进入统一索引管线
系统 MUST 将网页类型导入的内容进入与文件一致的分段、嵌入与全文索引管线，使网页内容可参与向量检索与全文检索。

#### Scenario: 网页内容可被索引
- **WHEN** 一个网页 URL 导入成功并产生正文文本
- **THEN** 系统 MUST 对正文文本进行分段与索引，使其在向量检索与全文检索中可被召回

### Requirement: 混合搜索可召回网页类型结果
系统 MUST 在混合搜索结果中包含网页类型文档，并以与文件一致的排序融合策略处理网页结果与文件结果。

#### Scenario: 搜索召回网页结果
- **WHEN** 用户搜索的关键词仅存在于某个已导入的网页正文中
- **THEN** 系统 MUST 在搜索结果中返回该网页文档或其相关片段

### Requirement: 搜索结果携带网页来源信息
系统 MUST 在网页类型搜索结果中提供可供 UI 展示与范围联动的来源信息，至少包含：`title`（若可用）、`url`、`sourceType=web`，以及可关联到网页资料来源的稳定标识。

#### Scenario: 结果可区分网页资料来源
- **WHEN** 搜索结果包含网页类型文档
- **THEN** 每条网页结果 MUST 携带 sourceType=web、url 与对应网页资料来源标识，用于 UI 展示与范围关联

### Requirement: 支持按来源类型过滤搜索结果
系统 MUST 支持按来源类型过滤搜索结果，至少支持：仅文件、仅网页、全部。

#### Scenario: 仅查看网页结果
- **WHEN** 用户选择“仅网页”的过滤条件并执行搜索
- **THEN** 系统 MUST 仅返回 sourceType=web 的结果

### Requirement: 网页内容更新时索引可被刷新
系统 MUST 支持对同一网页资料来源再次抓取并刷新索引内容，并确保更新后的内容继续对应原有网页资料来源，参与后续搜索与范围选择。

#### Scenario: 刷新已有网页资料
- **WHEN** 用户对某个已存在的网页资料来源再次执行抓取并成功获取新内容
- **THEN** 系统 MUST 使用新的正文内容刷新该网页资料对应的索引，并使后续搜索与范围选择看到更新后的结果

### Requirement: 搜索模式支持按网页资料范围约束结果
系统 MUST 支持在搜索模式中将网页资料作为已准备范围参与过滤，并且仅返回属于已选网页资料范围的结果。

#### Scenario: 仅搜索某个网页资料
- **WHEN** 用户在搜索模式中选择某个网页资料作为范围并执行搜索
- **THEN** 系统 MUST 仅返回属于该网页资料来源的结果

