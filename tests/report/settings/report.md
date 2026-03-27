# Settings 域测试报告

## 总览

### 分析范围

- raw logs 范围：当前仓库内 `tests/logs/settings/**`
- 本次分析窗口：当前仓库内 Settings 域全部 raw runs
- 本次纳入分析的 suite：`model`、`workspace`、`web`
- 当前未纳入 raw logs 的计划 suite：`vector`

### 总体结论

- 历史总数据：`totalRuns=32`、`passedRuns=17`、`failedRuns=15`、`historicalSuccessRate=53.1%`
- 最新总数据：`latestCaseCount=11`、`latestPassedCases=11`、`latestFailedCases=0`、`latestSuccessRate=100.0%`
- 当前结论：本轮已实现并进入 raw logs 的 11 条 Settings 正式 case 已全部转为 latest passed，已覆盖 `model`、`workspace`、`web` 三个 suite 的首批主链路；`vector` suite 仍然没有正式 raw logs，尚未进入当前 report 覆盖面。

### 下一阶段建议

- 继续补齐 `model` 中围绕首屏初始化、变更事件和删除反馈的剩余 case
- 继续补齐 `workspace` 中围绕默认选中、添加、系统打开路径和空态提示的剩余 case
- 继续补齐 `web` 中围绕单条重新抓取和外链打开契约的剩余 case
- 启动 `vector` suite 的正式 case 实现与 raw logs 闭环

## model

### 证据

- `model-create-edit-form` | `20260327-180429-211` | `passed`
- `model-enable-switch-current` | `20260327-180436-423` | `passed`
- `model-first-config-auto-activate` | `20260327-180433-385` | `passed`

### 通过率

- 历史总数据：`totalRuns=12`、`passedRuns=6`、`failedRuns=6`、`historicalSuccessRate=50.0%`
- 最新总数据：`latestCaseCount=3`、`latestPassedCases=3`、`latestFailedCases=0`、`latestSuccessRate=100.0%`

### 失败分析

- 历史 failed run 共 `6` 次：
- `model-create-edit-form` | `20260327-175759-024` | `failed`
- `model-create-edit-form` | `20260327-180058-496` | `failed`
- `model-create-edit-form` | `20260327-180335-189` | `failed`
- `model-enable-switch-current` | `20260327-175834-037` | `failed`
- `model-first-config-auto-activate` | `20260327-175906-781` | `failed`
- `model-first-config-auto-activate` | `20260327-180132-257` | `failed`
- 上述 3 条 case 的最新 run 均已转为 `passed`，因此当前 suite 没有 latest failed case。

### 当前评估

- `model` suite 已形成新增/编辑表单、首条配置自动激活、手动切换当前模型三条主链路的正式覆盖。
- 从 latest 口径看，当前没有证据表明这三条模型管理主链路仍存在回归。

### 下一步建议

- 补齐 `model-page-load-active-config`
- 补齐 `model-active-config-change-event`
- 补齐 `model-delete-config-feedback`

## workspace

### 证据

- `workspace-scan-progress-refresh` | `20260327-181242-187` | `passed`
- `workspace-load-by-mode` | `20260327-181246-418` | `passed`
- `workspace-detail-status-and-error` | `20260327-181249-496` | `passed`
- `workspace-remove-from-list` | `20260327-181252-927` | `passed`

### 通过率

- 历史总数据：`totalRuns=8`、`passedRuns=5`、`failedRuns=3`、`historicalSuccessRate=62.5%`
- 最新总数据：`latestCaseCount=4`、`latestPassedCases=4`、`latestFailedCases=0`、`latestSuccessRate=100.0%`

### 失败分析

- 历史 failed run 共 `3` 次：
- `workspace-load-by-mode` | `20260327-180703-475` | `failed`
- `workspace-remove-from-list` | `20260327-180743-654` | `failed`
- `workspace-scan-progress-refresh` | `20260327-180706-984` | `failed`
- 上述 3 条 case 的最新 run 均已转为 `passed`，因此当前 suite 没有 latest failed case。

### 当前评估

- `workspace` suite 已覆盖扫描进度刷新、按模式加载、错误与摘要展示、移除后列表收敛四条核心用户链路。
- 从 latest 口径看，当前 raw logs 已经支持 `SET-WORKSPACE-003`、`SET-WORKSPACE-004`、`SET-WORKSPACE-005`、`SET-WORKSPACE-006` 的首批正式验收闭环。

### 下一步建议

- 补齐 `workspace-page-load-default-selection`
- 补齐 `workspace-add-selection-flow`
- 补齐 `workspace-scan-contract`、`workspace-load-mode-contract`、`workspace-open-path-contract`、`workspace-remove-source-contract`
- 补齐 `workspace-empty-tree-legacy-hints`

## web

### 证据

- `web-page-load-filter-selection` | `20260327-182400-488` | `passed`
- `web-add-sources-dialog` | `20260327-182403-415` | `passed`
- `web-refresh-all-summary` | `20260327-182406-395` | `passed`
- `web-detail-and-delete` | `20260327-182408-771` | `passed`

### 通过率

- 历史总数据：`totalRuns=12`、`passedRuns=6`、`failedRuns=6`、`historicalSuccessRate=50.0%`
- 最新总数据：`latestCaseCount=4`、`latestPassedCases=4`、`latestFailedCases=0`、`latestSuccessRate=100.0%`

### 失败分析

- 历史 failed run 共 `6` 次：
- `web-page-load-filter-selection` | `20260327-181604-617` | `failed`
- `web-page-load-filter-selection` | `20260327-181836-057` | `failed`
- `web-add-sources-dialog` | `20260327-181608-566` | `failed`
- `web-add-sources-dialog` | `20260327-181839-692` | `failed`
- `web-refresh-all-summary` | `20260327-181643-331` | `failed`
- `web-refresh-all-summary` | `20260327-181913-148` | `failed`
- 上述 3 条存在历史失败的 case，其最新 run 均已转为 `passed`；`web-detail-and-delete` 的全部 raw runs 目前均为 `passed`，因此当前 suite 没有 latest failed case。

### 当前评估

- `web` suite 已覆盖首屏与筛选、批量添加入口、全部抓取汇总反馈、详情与删除收敛四条主链路。
- 从 latest 口径看，当前没有证据表明网页资料管理的首批正式主链路仍存在回归。

### 下一步建议

- 补齐 `web-refresh-one-source`
- 补齐 `web-refresh-visible-list-contract`
- 补齐 `web-open-url-contract`
