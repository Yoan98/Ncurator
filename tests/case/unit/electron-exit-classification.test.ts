import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { terminateDesktopProcess } from '../../../scripts/test/desktop-launch.mjs'
import {
  isExpectedForceKilledTeardownExit,
  isExpectedMacDesktopTeardownExit,
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
        data: entry === 'electron-process-exit' ? { code: 3221225477, signal: null } : undefined
      }
    }
    return {
      ts: new Date().toISOString(),
      name: entry.name,
      data: entry.data
    }
  })

describe('Windows Electron exit classification', () => {
  it.each([3221225477, 3221226505, -1073741819, -1073740791])(
    'accepts known inspector status %i after successful test teardown starts',
    (code) => {
      expect(
        isExpectedWindowsInspectorTeardownExit({
          platform: 'win32',
          lifecycleEntries: lifecycle(
            'electron-process-started',
            'electron-teardown-started',
            'page-close',
            { name: 'electron-process-exit', data: { code, signal: null } }
          ),
          testPassed: true
        })
      ).toBe(true)
    }
  )

  it.each([-1073741819, -1073740791])('rejects signed status %i before teardown', (code) => {
    expect(
      isExpectedWindowsInspectorTeardownExit({
        platform: 'win32',
        lifecycleEntries: lifecycle(
          { name: 'electron-process-exit', data: { code, signal: null } },
          'electron-teardown-started'
        ),
        testPassed: true
      })
    ).toBe(false)
  })

  it.each([
    [
      'failed test',
      'win32',
      false,
      lifecycle('electron-teardown-started', 'electron-process-exit')
    ],
    [
      'non-Windows',
      'darwin',
      true,
      lifecycle('electron-teardown-started', 'electron-process-exit')
    ],
    [
      'pre-teardown exit',
      'win32',
      true,
      lifecycle('electron-process-exit', 'electron-teardown-started')
    ],
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

describe('macOS desktop exit observation', () => {
  const exit = {
    name: 'electron-process-exit',
    data: { code: null, signal: null, launcherExitCode: 0, exited: true }
  }
  it('accepts an observed exit after requested teardown without inventing a native status', () => {
    expect(
      isExpectedMacDesktopTeardownExit({
        platform: 'darwin',
        testPassed: true,
        lifecycleEntries: lifecycle(
          'electron-teardown-started',
          'electron-graceful-shutdown-prepared',
          exit
        )
      })
    ).toBe(true)
  })
  it.each([
    lifecycle(exit, 'electron-teardown-started'),
    lifecycle('electron-teardown-started', exit),
    lifecycle(
      'electron-teardown-started',
      'electron-graceful-shutdown-prepared',
      'page-crash',
      exit
    ),
    lifecycle('electron-teardown-started', 'electron-graceful-shutdown-prepared', {
      ...exit,
      data: { ...exit.data, exited: false }
    }),
    lifecycle('electron-teardown-started', 'electron-graceful-shutdown-prepared', {
      ...exit,
      data: { ...exit.data, launcherExitCode: 1 }
    })
  ])('rejects an unverified exit', (...lifecycleEntries) => {
    expect(
      isExpectedMacDesktopTeardownExit({ platform: 'darwin', testPassed: true, lifecycleEntries })
    ).toBe(false)
  })
})

describe('Force-killed Electron exit classification', () => {
  it('accepts intentional SIGKILL after hung close when the test already passed', () => {
    expect(
      isExpectedForceKilledTeardownExit({
        platform: 'linux',
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

  it.skipIf(process.platform !== 'win32')(
    'classifies the real taskkill exit of a process terminated by the harness',
    async () => {
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        stdio: 'ignore',
        windowsHide: true
      })
      try {
        await once(child, 'spawn')
        const exited = once(child, 'exit')
        terminateDesktopProcess(child.pid)
        const [code, signal] = await exited
        expect(code).toBe(1)
        expect(signal).toBeNull()
        expect(
          isExpectedForceKilledTeardownExit({
            platform: 'win32',
            testPassed: true,
            lifecycleEntries: lifecycle('electron-teardown-started', 'electron-force-killed', {
              name: 'electron-process-exit',
              data: { code, signal }
            })
          })
        ).toBe(true)
      } finally {
        if (child.exitCode === null) child.kill('SIGKILL')
      }
    }
  )

  it.each([
    {
      name: 'failed assertions',
      testPassed: false,
      lifecycleEntries: lifecycle('electron-teardown-started', 'electron-force-killed', {
        name: 'electron-process-exit',
        data: { code: 1, signal: null }
      })
    },
    {
      name: 'an unrequested exit',
      testPassed: true,
      lifecycleEntries: lifecycle('electron-teardown-started', {
        name: 'electron-process-exit',
        data: { code: 1, signal: null }
      })
    },
    {
      name: 'a force-kill marker before teardown',
      testPassed: true,
      lifecycleEntries: lifecycle('electron-force-killed', 'electron-teardown-started', {
        name: 'electron-process-exit',
        data: { code: 1, signal: null }
      })
    },
    {
      name: 'a renderer crash',
      testPassed: true,
      lifecycleEntries: lifecycle(
        'electron-teardown-started',
        'page-crash',
        'electron-force-killed',
        {
          name: 'electron-process-exit',
          data: { code: 1, signal: null }
        }
      )
    },
    {
      name: 'an unrelated exit code',
      testPassed: true,
      lifecycleEntries: lifecycle('electron-teardown-started', 'electron-force-killed', {
        name: 'electron-process-exit',
        data: { code: 2, signal: null }
      })
    }
  ])('rejects Windows force-kill classification for $name', ({ testPassed, lifecycleEntries }) => {
    expect(
      isExpectedForceKilledTeardownExit({ platform: 'win32', testPassed, lifecycleEntries })
    ).toBe(false)
  })

  it.each([
    [
      'failed test',
      false,
      lifecycle('electron-teardown-started', 'electron-force-killed', {
        name: 'electron-process-exit',
        data: { code: null, signal: 'SIGKILL' }
      })
    ],
    [
      'missing force-kill marker',
      true,
      lifecycle('electron-teardown-started', {
        name: 'electron-process-exit',
        data: { code: null, signal: 'SIGKILL' }
      })
    ],
    [
      'renderer crash',
      true,
      lifecycle('electron-teardown-started', 'page-crash', 'electron-force-killed', {
        name: 'electron-process-exit',
        data: { code: null, signal: 'SIGKILL' }
      })
    ],
    [
      'non-SIGKILL exit',
      true,
      lifecycle('electron-teardown-started', 'electron-force-killed', {
        name: 'electron-process-exit',
        data: { code: 1, signal: null }
      })
    ]
  ])('rejects force-kill classification for %s', (_name, testPassed, lifecycleEntries) => {
    expect(
      isExpectedForceKilledTeardownExit({
        platform: 'linux',
        lifecycleEntries: lifecycleEntries as E2ELifecycleEntry[],
        testPassed: testPassed as boolean
      })
    ).toBe(false)
  })
})
