import { terminalExecCapability } from '../terminal_exec'

export const buildWorkspaceCliTools = (input: Parameters<typeof terminalExecCapability.buildTools>[0]) =>
  terminalExecCapability.buildTools(input)
