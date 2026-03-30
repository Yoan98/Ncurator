# Settings 域测试报告

## 总览

### 分析范围

- raw logs 范围：当前仓库内 `tests/logs/settings/**`
- 本次分析窗口：当前仓库内 Settings 域全部 raw runs
- 本次纳入分析的 suite：`model`、`workspace`、`web`
- 当前未纳入 raw logs 的计划 suite：`vector`

### 总体结论

- 历史总数据：`totalRuns=95`、`passedRuns=68`、`failedRuns=27`、`historicalSuccessRate=71.6%`
- 最新总数据：`latestCaseCount=17`、`latestPassedCases=17`、`latestFailedCases=0`、`latestSuccessRate=100.0%`
- 当前结论：本轮新增并收敛了 `model-page-load-active-config`、`model-delete-config-feedback`、`workspace-page-load-default-selection`、`workspace-add-selection-flow`、`workspace-empty-tree-legacy-hints`、`web-refresh-one-source` 六条正式 case。当前进入 raw logs 的 17 条 Settings 正式 case 在 latest 口径下已全部为 `passed`，覆盖 `model`、`workspace`、`web` 三个 suite 的首批核心用户链路；`vector` suite 仍然没有正式 raw logs，尚未进入当前 report 覆盖面。

### 下一阶段建议

- 继续补齐 `model` 中围绕配置列表契约与 `check-llm-config` 变更事件的 backend case
- 继续补齐 `workspace` 中围绕扫描契约、加载模式契约、打开路径契约和移除后数据源收敛的 backend case
- 继续补齐 `web` 中围绕当前可见列表批量抓取范围和外链打开契约的 backend case
- 启动 `vector` suite 的正式 case 实现与 raw logs 闭环

## model

### 证据

- `model-create-edit-form` | `20260327-185017-046` | `passed`
- `model-delete-config-feedback` | `20260327-185014-125` | `passed`
- `model-enable-switch-current` | `20260327-185021-550` | `passed`
- `model-first-config-auto-activate` | `20260327-185019-432` | `passed`
- `model-page-load-active-config` | `20260327-185023-169` | `passed`

### 通过率

- 历史总数据：`totalRuns=37`、`passedRuns=27`、`failedRuns=10`、`historicalSuccessRate=73.0%`
- 最新总数据：`latestCaseCount=5`、`latestPassedCases=5`、`latestFailedCases=0`、`latestSuccessRate=100.0%`

### 失败分析

- 历史 failed run 共 `10` 次：
- `model-create-edit-form` | `20260327-175759-024` | `failed`
- `model-create-edit-form` | `20260327-180058-496` | `failed`
- `model-create-edit-form` | `20260327-180335-189` | `failed`
- `model-delete-config-feedback` | `20260327-184218-120` | `failed`
- `model-delete-config-feedback` | `20260327-184522-625` | `failed`
- `model-delete-config-feedback` | `20260327-184705-691` | `failed`
- `model-delete-config-feedback` | `20260327-184819-583` | `failed`
- `model-enable-switch-current` | `20260327-175834-037` | `failed`
- `model-first-config-auto-activate` | `20260327-175906-781` | `failed`
- `model-first-config-auto-activate` | `20260327-180132-257` | `failed`
- 上述存在历史失败的 4 条 case，其最新 run 均已转为 `passed`，因此当前 suite 没有 latest failed case。

### 当前评估

- `model` suite 已覆盖页面首屏初始化、新增/编辑表单、首条配置自动激活、手动切换当前模型、删除成功与删除失败反馈五条核心链路。
- 从 latest 口径看，当前 raw logs 已经支持 `SET-MODEL-001`、`SET-MODEL-002`、`SET-MODEL-003`、`SET-MODEL-005` 的首批正式验收闭环。

### 下一步建议

- 补齐 `model-config-list-contract`
- 补齐 `model-active-config-change-event`

## workspace

### 证据

- `workspace-add-selection-flow` | `20260327-184821-653` | `passed`
- `workspace-detail-status-and-error` | `20260327-184848-985` | `passed`
- `workspace-empty-tree-legacy-hints` | `20260327-184826-801` | `passed`
- `workspace-load-by-mode` | `20260327-184838-245` | `passed`
- `workspace-page-load-default-selection` | `20260327-184819-579` | `passed`
- `workspace-remove-from-list` | `20260327-184843-817` | `passed`
- `workspace-scan-progress-refresh` | `20260327-184831-859` | `passed`

### 通过率

- 历史总数据：`totalRuns=36`、`passedRuns=26`、`failedRuns=10`、`historicalSuccessRate=72.2%`
- 最新总数据：`latestCaseCount=7`、`latestPassedCases=7`、`latestFailedCases=0`、`latestSuccessRate=100.0%`

### 失败分析

- 历史 failed run 共 `10` 次：
- `workspace-add-selection-flow` | `20260327-184320-168` | `failed`
- `workspace-add-selection-flow` | `20260327-184523-503` | `failed`
- `workspace-add-selection-flow` | `20260327-184701-806` | `failed`
- `workspace-empty-tree-legacy-hints` | `20260327-184248-489` | `failed`
- `workspace-empty-tree-legacy-hints` | `20260327-184703-790` | `failed`
- `workspace-load-by-mode` | `20260327-180703-475` | `failed`
- `workspace-page-load-default-selection` | `20260327-184212-690` | `failed`
- `workspace-page-load-default-selection` | `20260327-184518-328` | `failed`
- `workspace-remove-from-list` | `20260327-180743-654` | `failed`
- `workspace-scan-progress-refresh` | `20260327-180706-984` | `failed`
- 上述存在历史失败的 5 条 case，其最新 run 均已转为 `passed`，因此当前 suite 没有 latest failed case。

### 当前评估

- `workspace` suite 已覆盖首屏默认选中、添加选择目录、扫描进度刷新、按模式加载、错误与摘要展示、移除后列表收敛、无文件/旧数据提示七条核心用户链路。
- 从 latest 口径看，当前 raw logs 已经支持 `SET-WORKSPACE-001`、`SET-WORKSPACE-002`、`SET-WORKSPACE-003`、`SET-WORKSPACE-004`、`SET-WORKSPACE-005`、`SET-WORKSPACE-006`、`SET-WORKSPACE-007` 的首批正式验收闭环。

### 下一步建议

- 补齐 `workspace-scan-contract`、`workspace-load-mode-contract`、`workspace-open-path-contract`、`workspace-remove-source-contract`

## web

### 证据

- `web-add-sources-dialog` | `20260327-184518-331` | `passed`
- `web-detail-and-delete` | `20260327-184535-264` | `passed`
- `web-page-load-filter-selection` | `20260327-184521-416` | `passed`
- `web-refresh-all-summary` | `20260327-184529-702` | `passed`
- `web-refresh-one-source` | `20260327-184523-091` | `passed`

### 通过率

- 历史总数据：`totalRuns=22`、`passedRuns=15`、`failedRuns=7`、`historicalSuccessRate=68.2%`
- 最新总数据：`latestCaseCount=5`、`latestPassedCases=5`、`latestFailedCases=0`、`latestSuccessRate=100.0%`

### 失败分析

- 历史 failed run 共 `7` 次：
- `web-page-load-filter-selection` | `20260327-181604-617` | `failed`
- `web-page-load-filter-selection` | `20260327-181836-057` | `failed`
- `web-add-sources-dialog` | `20260327-181608-566` | `failed`
- `web-add-sources-dialog` | `20260327-181839-692` | `failed`
- `web-refresh-all-summary` | `20260327-181643-331` | `failed`
- `web-refresh-all-summary` | `20260327-181913-148` | `failed`
- `web-refresh-one-source` | `20260327-184231-184` | `failed`
- 上述存在历史失败的 4 条 case，其最新 run 均已转为 `passed`；`web-detail-and-delete` 的全部 raw runs 目前均为 `passed`，因此当前 suite 没有 latest failed case。

### 当前评估

- `web` suite 已覆盖首屏与筛选、批量添加入口、单条重新抓取、全部抓取汇总反馈、详情与删除收敛五条主链路。
- 从 latest 口径看，当前 raw logs 已经支持 `SET-WEB-001`、`SET-WEB-002`、`SET-WEB-003`、`SET-WEB-004`、`SET-WEB-005` 的首批正式验收闭环。

### 下一步建议

- 补齐 `web-refresh-visible-list-contract`
- 补齐 `web-open-url-contract`
