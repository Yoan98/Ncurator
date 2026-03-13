export const ARCHIVED_CASE_RECORDS = [
  {
    caseId: 'chat-approval-required',
    suite: 'e2e-chat',
    lifecycle: 'archived',
    reason: '旧 Chat 页面审批路径已由工作台路径覆盖。',
    replacementCaseId: 'workbench-chat-approval-required'
  },
  {
    caseId: 'chat-docx-draft-lifecycle-panel',
    suite: 'renderer-chat-contract',
    lifecycle: 'archived',
    reason: '旧草稿生命周期面板用例已并入新的草稿审阅流 contract 覆盖。',
    replacementCaseId: 'chat-draft-review-flow'
  },
  {
    caseId: 'chat-plan-artifact-rendering',
    suite: 'e2e-chat',
    lifecycle: 'archived',
    reason: '旧 Chat 计划渲染路径已收敛到工作台 deterministic 链路。',
    replacementCaseId: 'workbench-chat-plan-artifact-rendering'
  },
  {
    caseId: 'chat-workspace-required',
    suite: 'e2e-chat',
    lifecycle: 'archived',
    reason: '旧 Chat 页面 workspace 补充路径已收敛到工作台 deterministic 链路。',
    replacementCaseId: 'workbench-chat-workspace-required'
  },
  {
    caseId: 'docx-history-invalid-doc-id',
    suite: 'main-ai-capability',
    lifecycle: 'archived',
    reason: '旧 history 边界报告目录已失去当前源码对应 case。'
  },
  {
    caseId: 'docx-rollback-invalid-target',
    suite: 'main-ai-capability',
    lifecycle: 'archived',
    reason: '旧 rollback 边界报告目录已失去当前源码对应 case。'
  },
  {
    caseId: 'docx-save-overwrite-approval-approved',
    suite: 'main-ai-capability',
    lifecycle: 'archived',
    reason: '旧 overwrite approved 报告目录已失去当前源码对应 case。'
  },
  {
    caseId: 'docx-search-invalid-regex',
    suite: 'main-ai-capability',
    lifecycle: 'archived',
    reason: '旧 invalid regex 报告目录已失去当前源码对应 case。'
  },
  {
    caseId: 'docx-search-semantic-explicit-gap',
    suite: 'main-ai-capability',
    lifecycle: 'archived',
    reason: '旧 semantic explicit gap 命名已被新的 cached gap case 取代。',
    replacementCaseId: 'docx-search-semantic-cached'
  },
  {
    caseId: 'human-brain-mock-decision-regression',
    suite: 'main-ai-human',
    lifecycle: 'archived',
    reason: '旧 mock-decision regression 已不再属于当前 human live case 集。'
  },
  {
    caseId: 'human-missing-config-fail-fast',
    suite: 'main-ai-human',
    lifecycle: 'archived',
    reason: '旧 missing config 命名已被 live-config fail-fast case 取代。',
    replacementCaseId: 'human-missing-live-config-fail-fast'
  },
  {
    caseId: 'human-missing-fixture-fail-fast',
    suite: 'main-ai-human',
    lifecycle: 'archived',
    reason: '旧 missing fixture fail-fast 报告目录已失去当前源码对应 case。'
  },
  {
    caseId: 'retrieval-requested-ids-without-run-scope',
    suite: 'main-ai-capability',
    lifecycle: 'archived',
    reason: '旧 retrieval requested ids 报告目录已失去当前源码对应 case。'
  },
  {
    caseId: 'search-source-scope-results',
    suite: 'e2e-search',
    lifecycle: 'archived',
    reason: '旧 Search 页面 deterministic 路径已收敛到工作台链路。',
    replacementCaseId: 'workbench-search-source-scope-results'
  },
  {
    caseId: 'terminal-cwd-out-of-workspace',
    suite: 'main-ai-capability',
    lifecycle: 'archived',
    reason: '旧 cwd out-of-workspace 报告目录已失去当前源码对应 case。'
  },
  {
    caseId: 'terminal-timeout-failed',
    suite: 'main-ai-capability',
    lifecycle: 'archived',
    reason: '旧 timeout failed 报告目录已失去当前源码对应 case。'
  },
  {
    caseId: 'tool-registry-workspace-guards',
    suite: 'main-ai-capability',
    lifecycle: 'archived',
    reason: '旧 tool registry workspace guard 报告目录已失去当前源码对应 case。'
  }
]

export const ARCHIVED_REPORT_SUITES = ['main-ai-human-live']
