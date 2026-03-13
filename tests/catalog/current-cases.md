# Current Test Cases

- generatedAt: 2026-03-13T06:53:27.950Z

## e2e-chat

| Case | Retention | Lifecycle | Run Policy | Latest | Source |
| --- | --- | --- | --- | --- | --- |
| chat-failure-report-contract | coverage | active | gating | failed/failed | tests/e2e/chat/deterministic/chat.failure-report-contract.test.ts |
| workbench-chat-approval-required | canonical | active | gating | passed/completed | tests/e2e/chat/deterministic/chat.fixture-flows.e2e.test.ts |
| workbench-chat-plan-artifact-rendering | canonical | active | gating | passed/completed | tests/e2e/chat/deterministic/chat.fixture-flows.e2e.test.ts |
| workbench-chat-review-commit-flow | canonical | active | gating | passed/completed | tests/e2e/chat/deterministic/chat.review-flow.e2e.test.ts |
| workbench-chat-review-conflict-flow | canonical | active | gating | passed/completed | tests/e2e/chat/deterministic/chat.review-flow.e2e.test.ts |
| workbench-chat-workspace-required | canonical | active | gating | passed/completed | tests/e2e/chat/deterministic/chat.fixture-flows.e2e.test.ts |

## e2e-chat-ai-live

| Case | Retention | Lifecycle | Run Policy | Latest | Source |
| --- | --- | --- | --- | --- | --- |
| chat-approval-recovery-live | live-eval | active | non_gating | none | tests/e2e/chat/ai-live/chat.approval-recovery.live.test.ts |

## e2e-import

| Case | Retention | Lifecycle | Run Policy | Latest | Source |
| --- | --- | --- | --- | --- | --- |
| import-workspace-create-scan-prepare | canonical | active | gating | passed/completed | tests/e2e/import/deterministic/import.workspace-flow.e2e.test.ts |

## e2e-search

| Case | Retention | Lifecycle | Run Policy | Latest | Source |
| --- | --- | --- | --- | --- | --- |
| workbench-search-source-scope-results | canonical | active | gating | passed/completed | tests/e2e/search/deterministic/search.scope-results.e2e.test.ts |

## main-ai-capability

| Case | Retention | Lifecycle | Run Policy | Latest | Source |
| --- | --- | --- | --- | --- | --- |
| docx-apply-ops-replace-text | canonical | active | gating | passed/completed | tests/main/ai/capability/docx.apply-ops-replace-text.test.ts |
| docx-complex-edit-flow | canonical | active | gating | passed/completed | tests/main/ai/capability/docx.complex-edit-flow.test.ts |
| docx-image-preservation-regression | canonical | active | gating | passed/completed | tests/main/ai/capability/docx.image-preservation-regression.test.ts |
| docx-large-mixed-regression | canonical | active | gating | passed/completed | tests/main/ai/capability/docx.large-docx-regression.test.ts |
| docx-open-path-boundary-invalid-input | canonical | active | gating | passed/failed | tests/main/ai/capability/docx.boundary-validation.test.ts |
| docx-peripheral-structure-regression | canonical | active | gating | passed/completed | tests/main/ai/capability/docx.peripheral-structure-regression.test.ts |
| docx-preview-format-explicit-gap | coverage | active | non_gating | passed/failed | tests/main/ai/capability/docx.explicit-gap.test.ts |
| docx-replace-text-style-preservation | canonical | active | gating | passed/completed | tests/main/ai/capability/docx.replace-text-style-preservation.test.ts |
| docx-save-existing-without-overwrite | canonical | active | gating | passed/failed | tests/main/ai/capability/docx.boundary-validation.test.ts |
| docx-save-overwrite-approval-denied | canonical | active | gating | passed/blocked | tests/main/ai/capability/docx.save-overwrite-approval-denied.test.ts |
| docx-save-reopen-regression | canonical | active | gating | passed/completed | tests/main/ai/capability/docx.save-reopen-regression.test.ts |
| docx-search-semantic-cached | coverage | active | non_gating | passed/completed | tests/main/ai/capability/docx.explicit-gap.test.ts |
| docx-snapshot-history-rollback | canonical | active | gating | passed/completed | tests/main/ai/capability/docx.snapshot-rollback.test.ts |
| docx-structural-op-invariance | canonical | active | gating | passed/completed | tests/main/ai/capability/docx.structural-op-invariance.test.ts |
| docx-target-hyperlink-preservation | canonical | active | gating | passed/completed | tests/main/ai/capability/docx.target-hyperlink-preservation.test.ts |
| retrieval-all-tools-boundary | canonical | active | gating | passed/completed | tests/main/ai/capability/retrieval.all-tools-boundary.test.ts |
| retrieval-scope-filter | canonical | active | gating | passed/completed | tests/main/ai/capability/retrieval.scope-filter.test.ts |
| terminal-cwd-normalization | canonical | active | gating | passed/completed | tests/main/ai/capability/terminal.boundary-approval.test.ts |
| terminal-execution-trace-artifacts | canonical | active | gating | passed/completed | tests/main/ai/capability/terminal.execution-trace-artifacts.test.ts |
| terminal-risk-approval-denied | canonical | active | gating | passed/blocked | tests/main/ai/capability/terminal.boundary-approval.test.ts |
| terminal-workspace-boundary-rejected | canonical | active | gating | passed/blocked | tests/main/ai/capability/terminal.boundary-approval.test.ts |
| tool-registry-manual-combo | canonical | active | gating | passed/completed | tests/main/ai/capability/tool-registry.manual-combo.test.ts |

## main-ai-human

| Case | Retention | Lifecycle | Run Policy | Latest | Source |
| --- | --- | --- | --- | --- | --- |
| human-approval-denied-block | live-eval | active | batch_only | passed/blocked | tests/main/ai/human/human.approval-denied.live.test.ts |
| human-docx-edit | live-eval | active | batch_only | passed/completed | tests/main/ai/human/human.docx-edit.live.test.ts |
| human-local-evidence-insufficient-block | live-eval | active | batch_only | passed/blocked | tests/main/ai/human/human.local-evidence-insufficient.live.test.ts |
| human-local-kb-answer | live-eval | active | batch_only | passed/completed | tests/main/ai/human/human.local-kb-answer.live.test.ts |
| human-local-kb-empty-result-block | live-eval | active | batch_only | passed/blocked | tests/main/ai/human/human.local-kb-empty-result.live.test.ts |
| human-missing-live-config-fail-fast | coverage | active | manual | failed/not_run | tests/main/ai/human/human.missing-live-config.fail-fast.test.ts |
| human-multi-skill-kb-then-shell | live-eval | active | batch_only | passed/completed | tests/main/ai/human/human.multi-skill-kb-then-shell.live.test.ts |
| human-nonexistent-file-block | live-eval | active | batch_only | passed/blocked | tests/main/ai/human/human.nonexistent-file.live.test.ts |
| human-read-workspace-file | live-eval | active | batch_only | passed/completed | tests/main/ai/human/human.read-workspace-file.live.test.ts |
| human-step-budget-exhausted-block | live-eval | active | batch_only | passed/blocked | tests/main/ai/human/human.step-budget-exhausted.live.test.ts |
| human-tool-error-recovery | live-eval | active | batch_only | passed/completed | tests/main/ai/human/human.tool-error-recovery.live.test.ts |
| human-workspace-missing-block | live-eval | active | batch_only | passed/blocked | tests/main/ai/human/human.workspace-missing.live.test.ts |

## main-ai-runtime

| Case | Retention | Lifecycle | Run Policy | Latest | Source |
| --- | --- | --- | --- | --- | --- |
| docx-draft-review-conflict | canonical | active | gating | passed/completed | tests/main/ai/runtime/docx.draft-review-commit.test.ts |
| docx-draft-review-partial-commit | canonical | active | gating | passed/completed | tests/main/ai/runtime/docx.draft-review-commit.test.ts |
| docx-draft-review-ready | canonical | active | gating | passed/completed | tests/main/ai/runtime/docx.draft-review-commit.test.ts |
| human-result-data-enrichment | canonical | active | gating | passed/completed | tests/main/ai/runtime/human.result-data-enrichment.test.ts |
| prompt-local-first-contract | canonical | active | gating | passed/completed | tests/main/ai/runtime/prompt.local-first-contract.test.ts |
| runtime-missing-fixture-fail-fast | coverage | active | gating | failed/not_run | tests/main/ai/runtime/runtime.missing-fixture.fail-fast.test.ts |
| runtime-scope-validation | canonical | active | gating | passed/completed | tests/main/ai/runtime/runtime.scope-validation.test.ts |
| source-scope-explicit-preserve | canonical | active | gating | passed/completed | tests/main/ai/runtime/source-scope.explicit-preserve.test.ts |

## main-workspace-migration

| Case | Retention | Lifecycle | Run Policy | Latest | Source |
| --- | --- | --- | --- | --- | --- |
| migration-legacy-local-import-cleanup | canonical | active | gating | passed/completed | tests/main/workspace/migration/migration.legacy-local-import-cleanup.test.ts |

## main-workspace-service

| Case | Retention | Lifecycle | Run Policy | Latest | Source |
| --- | --- | --- | --- | --- | --- |
| workspace-scan-diff-scope-selection | canonical | active | gating | passed/completed | tests/main/workspace/service/workspace.scan-diff-scope-selection.test.ts |

## renderer-chat-contract

| Case | Retention | Lifecycle | Run Policy | Latest | Source |
| --- | --- | --- | --- | --- | --- |
| chat-approval-approve | canonical | active | gating | passed/completed | tests/renderer/chat/contract/chat.approval-flow.test.tsx |
| chat-approval-deny | canonical | active | gating | passed/completed | tests/renderer/chat/contract/chat.approval-flow.test.tsx |
| chat-draft-review-flow | canonical | active | gating | passed/completed | tests/renderer/chat/contract/chat.draft-review-flow.test.tsx |
| chat-right-panel-events | canonical | active | gating | passed/completed | tests/renderer/chat/contract/chat.right-panel-events.test.tsx |
| chat-workspace-required | canonical | active | gating | passed/completed | tests/renderer/chat/contract/chat.workspace-required.test.tsx |

## renderer-search-contract

| Case | Retention | Lifecycle | Run Policy | Latest | Source |
| --- | --- | --- | --- | --- | --- |
| search-scope-selection-deduped-documents | canonical | active | gating | passed/completed | tests/renderer/search/contract/search.scope-selection.test.tsx |
| search-scope-selection-empty-documents | canonical | active | gating | passed/completed | tests/renderer/search/contract/search.scope-selection.test.tsx |
