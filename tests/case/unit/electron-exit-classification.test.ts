import { describe, expect, it } from 'vitest'
import {
  isExpectedForceKilledTeardownExit,
  isExpectedWindowsInspectorTeardownExit,
  type E2ELifecycleEntry
} from '../../harness/e2e/electronApp'

const lifecycle = (
  ...entries: Array<string | { name: string; data?: E2ELifecycleEntry['data'] }>
): E2ELifecycleEntry[] =>
  entries.map((entry) => {
    if (typeof entry === 'string') {
      return {
        ts: new Date().toISOString(),
        name: entry,
        data:
          entry === 'electron-process-exit'
            ? { code: 3221225477, signal: null }
            : undefined
      }
    }
    return {
      ts: new Date().toISOString(),
      name: entry.name,
      data: entry.data
    }
  })

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

describe('Force-killed Electron exit classification', () => {
  it('accepts intentional SIGKILL after hung close when the test already passed', () => {
    expect(
      isExpectedForceKilledTeardownExit({
        lifecycleEntries: lifecycle(
          'electron-teardown-started',
          'electron-graceful-shutdown-prepared',
          'electron-force-killed',
          { name: 'electron-process-exit', data: { code: null, signal: 'SIGKILL' } }
        ),
        testPassed: true
      })
    ).toBe(true)
  })

  it.each([
    [
      'failed test',
      false,
      lifecycle(
        'electron-teardown-started',
        'electron-force-killed',
        { name: 'electron-process-exit', data: { code: null, signal: 'SIGKILL' } }
      )
    ],
    [
      'missing force-kill marker',
      true,
      lifecycle(
        'electron-teardown-started',
        { name: 'electron-process-exit', data: { code: null, signal: 'SIGKILL' } }
      )
    ],
    [
      'renderer crash',
      true,
      lifecycle(
        'electron-teardown-started',
        'page-crash',
        'electron-force-killed',
        { name: 'electron-process-exit', data: { code: null, signal: 'SIGKILL' } }
      )
    ],
    [
      'non-SIGKILL exit',
      true,
      lifecycle(
        'electron-teardown-started',
        'electron-force-killed',
        { name: 'electron-process-exit', data: { code: 1, signal: null } }
      )
    ]
  ])('rejects force-kill classification for %s', (_name, testPassed, lifecycleEntries) => {
    expect(
      isExpectedForceKilledTeardownExit({
        lifecycleEntries: lifecycleEntries as E2ELifecycleEntry[],
        testPassed: testPassed as boolean
      })
    ).toBe(false)
  })
})
