# NCurator-Desktop AI 实现规范

本文定义 `main + human` 的实现规则。代码实现应优先对齐本文档。

## 1. `main` 实现主线

### 1.1 `main` 主循环

```ts
function runMain(input) {
  const route = runMainIntent(input)

  if (route === 'direct_human') {
    const output = dispatchHuman(
      { taskId: 'direct', userInput: input },
      { deliveryMode: 'user_answer' }
    )
    return completeRun(output)
  }

  const contextOutput = dispatchHuman(
    { taskId: 'context', userInput: buildContextObjective(input) },
    { deliveryMode: 'context_note' }
  )

  const contextEvidence = extractContextEvidence(contextOutput)
  const plan = buildPlan(input, contextEvidence)
  const taskOutputs = []

  for (const task of plan) {
    const output = dispatchHuman(task, { deliveryMode: 'task_handoff' })
    taskOutputs.push(output)
    updatePlanState(task, output)

    if (output.status === 'blocked') {
      break
    }
  }

  const finalOutput = dispatchHuman(
    { taskId: 'synthesis', userInput: buildSynthesisObjective(input, taskOutputs) },
    { deliveryMode: 'user_answer' }
  )

  return completeRun(finalOutput)
}
```

### 1.2 `main_intent`

```ts
function runMainIntent(input) {
  if (canBeHandledBySingleHuman(input)) {
    return 'direct_human'
  }

  return 'complex_pipeline'
}
```

实现要求：

- 默认优先选择 `direct_human`。
- 只有当当前单 `human` 直接闭环明显不稳时，才进入复杂链路。
- `main_intent` 只做 orchestration 复杂度判断，不负责展开求解。

### 1.3 `main_context_human`

```ts
function buildContextObjective(input) {
  return describeWhatContextStageNeedsToClarify(input)
}

function runContextHuman(input) {
  return dispatchHuman(
    { taskId: 'context', userInput: buildContextObjective(input) },
    { deliveryMode: 'context_note' }
  )
}
```

实现要求：

- `contextObjective` 是本轮上下文补充阶段的临时目标。
- `main_context_human` 的输出主要用于提取 `contextEvidence`，不是直接代替最终交付。

### 1.4 `main_plan`

```ts
function buildPlan(input, contextEvidence) {
  return splitGoalIntoHumanExecutableTasks(input, contextEvidence)
}
```

实现要求：

- 计划任务必须能交给单个 `human` 闭环执行。
- 计划任务的正式交付载体是 `task_handoff`。

### 1.5 `main_plan_exec`

```ts
function executePlan(plan) {
  const outputs = []

  for (const task of plan) {
    const output = dispatchHuman(task, { deliveryMode: 'task_handoff' })
    outputs.push(output)
    updatePlanState(task, output)

    if (output.status === 'blocked') {
      return outputs
    }
  }

  return outputs
}
```

实现要求：

- 当前链路按顺序串行派发任务。
- 每个任务的 `status / deliveryMarkdown / artifacts` 都要回写到计划状态。
- `blocked` 表示任务已经派发且最终阻塞，不与未执行状态混用。

### 1.5.1 计划任务回写

```ts
function updatePlanState(plan, taskId, output) {
  const nextPlan = plan.map((task) => {
    if (task.id !== taskId) {
      return task
    }

    return {
      ...task,
      status: output.status,
      deliveryMarkdown: output.deliveryMarkdown,
      artifacts: output.artifacts
    }
  })

  const dispatchCursor = findNextReadyTaskIndex(nextPlan)

  return { nextPlan, dispatchCursor }
}
```

实现要求：

- 回写时只更新当前已派发任务。
- `dispatchCursor` 始终指向下一项 `ready` 任务；不存在时表示计划阶段已完成。
- `task_handoff` 是计划阶段唯一正式交接载体。

### 1.6 `main_synthesis_human`

```ts
function runSynthesisHuman(input, taskOutputs) {
  return dispatchHuman(
    { taskId: 'synthesis', userInput: buildSynthesisObjective(input, taskOutputs) },
    { deliveryMode: 'user_answer' }
  )
}
```

实现要求：

- `main_synthesis_human` 负责汇总多个 `task_handoff`。
- 该阶段面向最终用户生成 `user_answer`。

## 2. `human` 实现主线

### 2.1 `human` 主循环

```ts
function runHuman(task, options) {
  const state = initHumanState(task)

  while (state.runtime.status === 'running') {
    const decision = runBrain(state, options)

    applyMemoryOps(state, decision.memoryOps)
    state.lastBrainDecision = decision
    appendBrainDecisionHistory(state, decision)

    if (decision.nextAction.action === 'learning') {
      runLearning(state, decision.nextAction.wantLearnSkillIds)
      continue
    }

    if (decision.nextAction.action === 'hand') {
      runHand(state, decision.nextAction.parallelCallToolParam)
      continue
    }

    if (decision.nextAction.action === 'mouth') {
      const mouthOutput = runMouth(state, options.deliveryMode)
      return finalizeHumanResult(state, mouthOutput, decision.nextAction.status)
    }
  }
}
```

实现要求：

- `brain` 是唯一控制中心。
- `learning / hand / mouth` 都是执行节点，不扩张为额外推理节点。
- `human` 的执行风格是逐步推进直到收敛或稳定阻塞。

### 2.2 决策历史沉淀

```ts
function appendBrainDecisionHistory(state, decision) {
  const record = {
    ...decision,
    createdAt: Date.now()
  }

  state.brainMemory.outside.brainDecisions = [
    ...state.brainMemory.outside.brainDecisions,
    record
  ].slice(-10)
}

function buildRecentDecisionDigest(records) {
  return records.map((record) => ({
    decision: record.decision,
    nextAction: record.nextAction,
    createdAt: record.createdAt
  }))
}
```

实现要求：

- `brainDecisions` 只保留最近 10 条。
- `brain` 回看历史时只消费 `decision / nextAction / createdAt` 摘要。
- `lastBrainDecision` 只服务当前分发，不进入下一轮 `brain` 的直接输入。

### 2.3 `human` result 收口

```ts
function finalizeHumanResult(state, mouthOutput, status) {
  state.runtime.status = status
  state.runtime.stage = 'mouth'
  state.result = {
    status,
    summary: mouthOutput.summary,
    deliveryMarkdown: mouthOutput.deliveryMarkdown,
    artifacts: state.runtimeArtifacts
  }

  return {
    taskId: state.task.taskId,
    ...state.result
  }
}
```

实现要求：

- `HumanResult.status` 由运行时按 `nextAction.status` 回写。
- `runtimeArtifacts` 由运行时透传到 `result`，不是由 `mouth` 模型生成。
- `HumanTaskOutput` 是 `main` 与 `human` 之间的稳定交接结构。

## 3. `brain` 实现规则

### 3.1 判断顺序

```ts
function runBrain(state) {
  if (canFinishNow(state)) {
    return nextActionMouth('completed')
  }

  if (shouldStopAsBlocked(state)) {
    return nextActionMouth('blocked')
  }

  if (needSkillExplanation(state)) {
    return nextActionLearning(selectRequiredSkills(state))
  }

  if (knowExactToolCalls(state)) {
    return nextActionHand(buildToolCalls(state))
  }

  return nextActionMouth('blocked')
}
```

实现要求：

- 优先判断是否已经可以结束。
- 再判断是否需要补 skill。
- 最后判断是否需要调用工具。
- 当没有足够依据继续推进、也没有明确下一步动作时，应优先收敛为 `blocked`，而不是继续漂移。

### 3.2 `brain` 输入输出

- 输入：
  - `task`
  - `brainMemory`
  - `lastParallelCallToolResults`
  - 最近决策历史摘要
  - `watchHint`
- 输出：
  - `memoryOps`
  - `decision`
  - `nextAction`

实现要求：

- `brain` 只通过 `memoryOps` 更新 `brainMemory.inside`。
- `brain` 自身不直接读 `lastBrainDecision` 作为回看输入。
- 回看材料只使用最近决策历史摘要。

## 4. `memoryReducer` 实现规则

```ts
function applyMemoryOps(state, memoryOps) {
  if (!validateIndexes(memoryOps)) {
    return writeWatchHint(state, 'memory edit index invalid')
  }

  const evidenceIdsAfterPatch = simulateEvidenceIdsAfterPatch(state, memoryOps)

  if (!allFactEvidenceRefsValid(state, memoryOps, evidenceIdsAfterPatch)) {
    return writeWatchHint(state, 'fact/evidence references invalid')
  }

  commitInsideMemoryPatch(state, memoryOps)
}
```

实现要求：

- `facts[].evidenceIds` 只能引用当前仍存在或本轮新增的 evidence id。
- 引用校验不得依赖 `memoryOps` 顺序。
- 任何会导致悬空 `evidenceIds` 的编辑都视为整组非法编辑。
- 非法编辑只写入 `watchHint`，不自动级联修正事实。

## 5. `learning` 实现规则

```ts
function runLearning(state, wantLearnSkillIds) {
  for (const skillId of wantLearnSkillIds) {
    if (alreadyLearned(state, skillId)) {
      writeWatchHint(state, 'skill already learned')
      return
    }

    appendLearnedSkillId(state, skillId)
  }
}
```

实现要求：

- `learning` 只负责更新 `learnedSkillIds`。
- `skillCatalog` 是目录摘要，不在 `learning` 阶段重新计算。
- 重复学习只写 `watchHint`，不做重复动作。

## 6. `hand` 实现规则

### 6.1 工具执行

```ts
function runHand(state, toolCalls) {
  const results = executeToolCalls(toolCalls)
  state.lastParallelCallToolResults = results
  state.runtimeArtifacts = collectRuntimeArtifacts(state.runtimeArtifacts, results)

  if (exceedsToolCallLimit(state)) {
    writeWatchHint(state, 'tool call limit exceeded')
  }
}
```

### 6.2 `artifacts` 收集

```ts
function collectRuntimeArtifacts(existingArtifacts, toolResults) {
  const newArtifacts = extractArtifactsFromStructuredToolResults(toolResults)
  return [...existingArtifacts, ...newArtifacts]
}
```

实现要求：

- `hand` 只执行 `brain` 已明确决定的工具调用。
- `hand` 只写最近一轮工具结果、`runtimeArtifacts` 与必要的 `watchHint`。
- `hand` 不直接生成最终结论。

## 7. `mouth` 实现规则

```ts
function runMouth(state, deliveryMode) {
  const input = {
    task: state.task,
    status: state.lastBrainDecision.nextAction.status,
    decision: state.lastBrainDecision.decision,
    facts: state.brainMemory.inside.facts,
    evidences: state.brainMemory.inside.evidences,
    openQuestions: state.brainMemory.inside.openQuestions,
    artifacts: state.runtimeArtifacts,
    deliveryMode
  }

  return renderMouthOutput(input)
}
```

实现要求：

- `mouth` 只生成 `summary + deliveryMarkdown`。
- `mouth` 不重新判断最终状态。
- `mouth` 不补编新事实，不扩张 artifacts。
- `result.status` 由运行时按 `nextAction.status` 回写。

## 8. 共享实现规则

### 8.1 `deliveryMode`

```ts
function resolveDeliveryMode(mainStage) {
  if (mainStage === 'main_direct_human_exec') return 'user_answer'
  if (mainStage === 'main_synthesis_human') return 'user_answer'
  if (mainStage === 'main_plan_exec') return 'task_handoff'
  return 'context_note'
}
```

### 8.2 `contextEvidence` 提取

```ts
function extractContextEvidence(output) {
  const lines = extractBulletsFromSection(output.deliveryMarkdown, '可复用证据')

  if (lines.length > 0) {
    return lines
  }

  return output.summary ? [output.summary] : []
}
```

实现要求：

- 只从 `context_note` 的 `## 可复用证据` 区块提取 bullet / numbered line。
- 提取失败时才 fallback 到 `summary`。
- 路由理由不写入 `contextEvidence`。

### 8.3 `main` 派发 `human`

```ts
function dispatchHuman(task, options) {
  const deliveryMode = options.deliveryMode ?? 'user_answer'
  const humanOutput = runHuman(task, { deliveryMode })

  return {
    taskId: humanOutput.taskId,
    status: humanOutput.status,
    summary: humanOutput.summary,
    deliveryMarkdown: humanOutput.deliveryMarkdown,
    artifacts: humanOutput.artifacts ?? []
  }
}
```

实现要求：

- `main` 与 `human` 的稳定交接边界是 `HumanTaskInput + HumanRunDispatchOptions -> HumanTaskOutput`。
- `deliveryMode` 只作为运行时派发参数传入，不要求持久化到 `MainState`。
- `main` 不直接改写 `human` 的内部状态。

### 8.4 run finalization

```ts
function completeRun(finalOutput) {
  return {
    status: 'completed',
    finalDeliveryMarkdown: finalOutput.deliveryMarkdown,
    finalArtifacts: finalizeRunArtifacts(finalOutput.artifacts)
  }
}
```

实现要求：

- `main_complete` 负责 run 级收尾。
- run finalization 可以追加 run 级 artifacts。

## 9. 不变量

- `main` 只负责 run 级 orchestration。
- `human` 只负责 task 级 autonomous execution。
- `brain` 是唯一推理节点。
- `deliveryMode` 只影响 `mouth` 的交付组织方式。
- `brainMemory.inside` 只由 `brain` 通过 `memoryOps` 修改。
- `lastBrainDecision` 是当前分发快照，`brainDecisions` 是最近决策历史。
- `mouth` 不读取最近决策历史。
