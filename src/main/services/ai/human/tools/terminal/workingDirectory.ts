import os from 'node:os'

export const getTerminalStartDirectory = (): string => os.homedir()
