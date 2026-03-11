export const chatSelectors = {
  page: 'chat-page',
  sessionsList: 'chat-sessions-list',
  input: 'chat-input',
  sendButton: 'chat-send-button',
  cancelButton: 'chat-cancel-button',
  sourceScopeField: 'chat-source-scope-field',
  tracePanel: 'chat-trace-panel',
  rightPanel: 'chat-right-panel',
  rightPanelTitle: 'chat-right-panel-title',
  rightPanelChunks: 'chat-right-panel-chunks',
  rightPanelDocs: 'chat-right-panel-docs',
  rightPanelArtifacts: 'chat-right-panel-artifacts',
  rightPanelJson: 'chat-right-panel-json',
  approvalBanner: 'chat-approval-banner',
  approvalApproveButton: 'chat-approval-approve-button',
  approvalDenyButton: 'chat-approval-deny-button',
  workspaceBanner: 'chat-workspace-banner',
  workspaceContinueButton: 'chat-workspace-continue-button',
  nonLocalBanner: 'chat-non-local-banner',
  nonLocalAllowButton: 'chat-non-local-allow-button',
  nonLocalDeclineButton: 'chat-non-local-decline-button',
  localSourceStatus: 'chat-local-source-status'
} as const

export const importSelectors = {
  page: 'import-page',
  createWorkspaceButton: 'import-create-workspace-button',
  workspaceList: 'import-workspace-list',
  workspaceCardPrefix: 'import-workspace-card',
  workspaceDetail: 'import-workspace-detail',
  workspaceStatus: 'import-workspace-status',
  workspaceQuickScanButton: 'import-workspace-quick-scan-button',
  workspaceQuickPrepareButton: 'import-workspace-quick-prepare-button',
  workspaceTree: 'import-workspace-tree',
  createWorkspaceModal: 'import-create-workspace-modal',
  createWorkspaceRootInput: 'import-create-workspace-root-input',
  createWorkspaceNameInput: 'import-create-workspace-name-input',
  createWorkspaceConfirmButton: 'import-create-workspace-confirm-button',
  createWorkspaceCancelButton: 'import-create-workspace-cancel-button'
} as const

export const searchSelectors = {
  page: 'search-page',
  input: 'search-input',
  submitButton: 'search-submit-button',
  sourceScopeField: 'search-source-scope-field',
  resultsList: 'search-results-list',
  resultCardPrefix: 'search-result-card'
} as const
