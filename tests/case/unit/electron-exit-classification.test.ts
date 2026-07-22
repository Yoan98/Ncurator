import { describe, expect, it } from 'vitest'
import {
  isExpectedWindowsInspectorTeardownExit,
  type E2ELifecycleEntry
} from '../../harness/e2e/electronApp'

const lifecycle = (...names: string[]): E2ELifecycleEntry[] =>
  names.map((name) => ({
    ts: new Date().toISOString(),
    name,
    data:
      name === 'electron-process-exit'
        ? { code: 3221225477, signal: null }
        : undefined
  }))

describe('Windows Electron exit classification', () => {
  it('accepts a known inspector exit after successful test teardown starts', () => {
    expect(
      isExpectedWindowsInspectorTeardownExit({
        platform: 'win32',
        lifecycleEntries: lifecycle(
          'electron-process-started',
          'electron-teardown-started',
          'page-close',
          'electron-process-exit'
        ),
        testPassed: true
      })
    ).toBe(true)
  })

  it.each([
    ['failed test', 'win32', false, lifecycle('electron-teardown-started', 'electron-process-exit')],
    ['non-Windows', 'darwin', true, lifecycle('electron-teardown-started', 'electron-process-exit')],
    ['pre-teardown exit', 'win32', true, lifecycle('electron-process-exit', 'electron-teardown-started')],
    [
      'renderer crash',
      'win32',
      true,
      lifecycle('electron-teardown-started', 'page-crash', 'electron-process-exit')
    ]
  ])('rejects a known exit for %s', (_name, platform, testPassed, lifecycleEntries) => {
    expect(
      isExpectedWindowsInspectorTeardownExit({
        platform: platform as NodeJS.Platform,
        lifecycleEntries: lifecycleEntries as E2ELifecycleEntry[],
        testPassed: testPassed as boolean
      })
    ).toBe(false)
  })

  it('rejects unknown non-zero exit codes', () => {
    const entries = lifecycle('electron-teardown-started', 'electron-process-exit')
    entries[1] = {
      ...entries[1],
      data: { code: 1, signal: null }
    }
    expect(
      isExpectedWindowsInspectorTeardownExit({
        platform: 'win32',
        lifecycleEntries: entries,
        testPassed: true
      })
    ).toBe(false)
  })
})
