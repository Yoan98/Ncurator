# AI 域测试报告

## 总览

### 分析范围

- raw logs 范围: 当前仓库内 `tests/logs/ai/e2e/workbench/**`
- 已分析 scope: `ai/e2e/workbench/scenario`、`ai/e2e/workbench/boundary`
- 本轮验收目标: docx 确认文档模式的完成态提交、多确认会话保留、源文件冲突拦截

### 总体结论

- 历史总数据: `19` 次 raw runs，其中 `10` 次 passed、`9` 次 failed，historicalSuccessRate=`52.6%`
- 最新总数据: `3 / 3` 个 case 的最新一轮 run 为 passed，latestSuccessRate=`100.0%`
- 当前结论: 本轮确认文档模式在 `workbench` 的三条主验收链路已经跑通。历史 failed run 暴露出的真实问题包括 E2E fixture 路径错误且异常未透出、提交成功态 toast 运行时错误，以及 docx 预览缺少 `font-src` CSP 放行。上述问题均已修复；多确认会话场景的最后一类 failed run 属于用例对入口顺序的错误假设，现已改成校验“不同入口打开不同会话”，不再依赖固定顺序。

### 下一阶段建议

- 补一条 `discarded / superseded` 的 e2e，覆盖确认文档结束态的另外两条状态流转
- 在 macOS 真机上补一次“选择其他应用打开...”的手工验收，确认 WPS / Office 打开确认副本的实际交互
- 继续评估构建阶段的依赖告警，尤其是 `pdfjs` worker 和 `@js-preview/docx` 的 browser compatibility 警告，避免后续掩盖真实异常

## e2e

### workbench

#### 证据

- `final-review-confirm-session-completion` | run=`20260326-113831-568` | status=`passed`
- `final-review-multi-targets-preserved` | run=`20260326-113844-688` | status=`passed`
- `final-review-conflict-blocks-commit` | run=`20260326-113855-121` | status=`passed`
- 历史关键 failed runs:
- `final-review-confirm-session-completion` | run=`20260326-112535-028` | status=`failed`
- `final-review-multi-targets-preserved` | run=`20260326-113125-408` | status=`failed`
- `final-review-conflict-blocks-commit` | run=`20260326-111908-608` | status=`failed`

#### 通过率

- 历史总数据:
  - totalRuns: 19
  - passedRuns: 10
  - failedRuns: 9
  - historicalSuccessRate: 52.6%
- 最新总数据:
  - latestCaseCount: 3
  - latestPassedCases: 3
  - latestFailedCases: 0
  - latestSuccessRate: 100.0%

#### 失败分析

- 初始 failed run 中，`20260326-111908-608` 与 `20260326-111915-336` 表现为 `assistant turn steps toggle not found`。根因不是 workbench 面板本身，而是 E2E fixture docx 路径写错，同时 fixture 失败发生在 `ai-run-start` 的 try/catch 之外，导致前端只收到开始信号，收不到 ready 或 failed 事件。
- `20260326-112535-028` 暴露了真实的 renderer 运行时缺陷: 提交成功后调用了不可用的 `message.success`，导致 ended-state 状态卡没有渲染出来。
- `20260326-113125-408` 的 failed run 说明多确认会话入口顺序并不稳定，受更新时间影响。这里最终确认产品行为是正确的，问题出在用例把“第一个入口必须是 source-a”写成了硬编码断言。
- 最新一轮修复前的通过 run 仍持续记录 docx 预览字体的 CSP console error；补上 `font-src 'self' data: blob:` 后，最新三条 passed run 已不再出现这类 runtime console error。

#### 当前评估

- `workbench` 的确认文档模式已经满足本轮验收目标。确认副本与源文件分离、会话完成后的状态卡、同一 run 多确认入口保留，以及源文件冲突阻止提交，都已有 e2e 证据支撑。
- 当前剩余风险主要不在主链路正确性，而在外围覆盖面不足，例如结束态的 `discarded / superseded`、外部应用打开的真机行为，以及构建阶段依赖告警噪声。

#### 下一步建议

- 继续补 `discarded / superseded` 的正式 e2e case
- 将外部应用打开的手工验收结果沉淀到测试计划或专项记录中
- 如果后续继续扩 docx 预览能力，优先保持 console clean，避免新的 runtime error 被构建告警掩盖

#### scenario

##### 证据

- `final-review-confirm-session-completion` | run=`20260326-113831-568` | status=`passed`
- `final-review-multi-targets-preserved` | run=`20260326-113844-688` | status=`passed`
- 历史关键 failed runs:
- `final-review-confirm-session-completion` | run=`20260326-111915-336` | status=`failed`
- `final-review-confirm-session-completion` | run=`20260326-112535-028` | status=`failed`
- `final-review-multi-targets-preserved` | run=`20260326-113125-408` | status=`failed`

##### 通过率

- 历史总数据:
  - totalRuns: 14
  - passedRuns: 6
  - failedRuns: 8
  - historicalSuccessRate: 42.9%
- 最新总数据:
  - latestCaseCount: 2
  - latestPassedCases: 2
  - latestFailedCases: 0
  - latestSuccessRate: 100.0%

##### 失败分析

- `final-review-confirm-session-completion` 早期失败先后暴露了 fixture 事件链不完整和提交成功态 toast 运行时错误两个问题；两者都直接阻断了结束态验收。
- `final-review-multi-targets-preserved` 的历史失败最终收敛为测试假设过强，而不是产品最后只保留一个确认目标。最新 passed run 已确认同一 run 下两个入口都能打开不同会话。

##### 当前评估

- scenario 组已经验证了“打开确认文档 -> 确认提交 -> 留在结束态”和“同一 run 多确认入口不丢失”两条主线，且最新结果稳定通过。

##### 下一步建议

- 为 scenario 组补一条“外部编辑后再次触发 AI 续编”的正式 e2e，用于覆盖 normalize 后继续编辑的真实闭环

#### boundary

##### 证据

- `final-review-conflict-blocks-commit` | run=`20260326-113855-121` | status=`passed`
- 历史关键 failed run:
- `final-review-conflict-blocks-commit` | run=`20260326-111908-608` | status=`failed`

##### 通过率

- 历史总数据:
  - totalRuns: 5
  - passedRuns: 4
  - failedRuns: 1
  - historicalSuccessRate: 80.0%
- 最新总数据:
  - latestCaseCount: 1
  - latestPassedCases: 1
  - latestFailedCases: 0
  - latestSuccessRate: 100.0%

##### 失败分析

- 当前仅有一条历史 failed run，根因与 scenario 组一致，来自 fixture docx 路径错误和 fixture 异常未透出，不是冲突校验本身失效。

##### 当前评估

- boundary 组已经证明源文件发生外部变化时，确认文档提交会被正确拦截，且不会再悄悄覆盖源文件。

##### 下一步建议

- 在 boundary 组继续补“确认副本损坏 / 外部修订存在时阻止提交”的 e2e，和现有 backend 校验形成闭环
