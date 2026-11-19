import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import {
  checkWindowsLiveProxy,
  createWindowsLiveProxyPreflight
} from '../../../../scripts/release/shared/live-proxy-preflight.mjs'
import { listSupersededReleaseKeys } from '../../../../scripts/release/r2/cleanup-inventory.mjs'

const wps = path.resolve(
  'tests/case/workbench/result/apply/wps-sync-dispatch-on-write-and-revert.e2e.test.ts'
)
const env = {
  AI_LIVE_PROVIDER: 'custom',
  AI_LIVE_BASE_URL: 'http://127.0.0.1:8317',
  AI_LIVE_API_KEY: 'fake-key',
  AI_LIVE_MODEL: 'fake-model'
}

describe('release preflight', () => {
  it('requires real completion for pending Windows local proxy workbench tests only', async () => {
    const fetchNow = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }))
      )
    await checkWindowsLiveProxy([], { platform: 'win32', env, fetchNow })
    await checkWindowsLiveProxy(
      [
        'tests/case/workbench/conversation/partner/partner-delete-confirmation.e2e.test.ts',
        'tests/case/workbench/run/browser/browser-navigate-cnipa-https.e2e.test.ts',
        'tests/case/workbench/scheduled-task/scheduled-task-config-lifecycle.e2e.test.ts'
      ],
      { platform: 'win32', env, fetchNow }
    )
    expect(fetchNow).not.toHaveBeenCalled()
    await checkWindowsLiveProxy([wps], { platform: 'win32', env, fetchNow })
    expect(fetchNow).toHaveBeenCalledWith(
      new URL('http://127.0.0.1:8317/v1/chat/completions'),
      expect.objectContaining({ method: 'POST', redirect: 'error' })
    )
    fetchNow.mockRejectedValueOnce(new TypeError('redirect to untrusted destination'))
    await expect(
      checkWindowsLiveProxy([wps], { platform: 'win32', env, fetchNow })
    ).rejects.toThrow('did not return a real completion')
    expect(fetchNow).toHaveBeenCalledTimes(2)
    fetchNow.mockResolvedValue(new Response(JSON.stringify({ data: [] })))
    await expect(
      checkWindowsLiveProxy([wps], { platform: 'win32', env, fetchNow })
    ).rejects.toThrow('did not return a real completion')
  })

  it.each([
    'prefix-cache-retain-live',
    'subagent-prefix-cache-retain-live',
    'queue-message-during-run',
    'partner-cache-cleanup',
    'scheduled-task-trigger-and-session-refresh'
  ])('checks the configured local provider for %s', async (caseId) => {
    const fetchNow = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }))
      )
    await checkWindowsLiveProxy([caseId + '.e2e.test.ts'], { platform: 'win32', env, fetchNow })
    expect(fetchNow).toHaveBeenCalledTimes(1)
  })

  it('skips reused fixed evidence and probes at most once across gate and optional phases', async () => {
    const fetchNow = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }))
      )
    const probe = createWindowsLiveProxyPreflight({ platform: 'win32', env, fetchNow })
    await probe([])
    expect(fetchNow).not.toHaveBeenCalled()
    await probe(['prefix-cache-retain-live.e2e.test.ts'])
    await probe([wps])
    expect(fetchNow).toHaveBeenCalledTimes(1)
  })

  it('does not require an unrelated CLIProxy for a preset or remote live provider', async () => {
    const fetchNow = vi.fn()
    await checkWindowsLiveProxy(['prefix-cache-retain-live.e2e.test.ts'], {
      platform: 'win32',
      env: { ...env, AI_LIVE_PROVIDER: 'dashscope' },
      fetchNow
    })
    await checkWindowsLiveProxy([wps], {
      platform: 'win32',
      env: { ...env, AI_LIVE_BASE_URL: 'https://configured-provider.example/v1' },
      fetchNow
    })
    expect(fetchNow).not.toHaveBeenCalled()
  })

  it('uses the exact platform-specific old-object scope without writes', async () => {
    const platform = 'macos-arm64'
    const tag = 'mac-v2.0.1'
    const live = 'artifacts/macos/mac-v2.0.1/package.dmg'
    const old = 'artifacts/macos/mac-v2.0.0/package.dmg'
    const stray = 'artifacts/macos/mac-v2.0.1/extra.dmg'
    const fragment = 'artifacts/macos/mac-v2.0.1/fragment.json'
    const legacy = 'release-status/macos/something'
    const keys = [live, old, stray, fragment, legacy, 'artifacts/windows/other/file']
    const listKeys = async (prefix: string) => keys.filter((key) => key.startsWith(prefix))
    expect(
      await listSupersededReleaseKeys({ platform, tag, files: [{ name: 'package.dmg' }] }, listKeys)
    ).toEqual([old, stray, legacy].sort())
    expect(
      await listSupersededReleaseKeys({ platform: 'windows-x64', tag: 'windows-v2.0.0' }, listKeys)
    ).toEqual(['artifacts/windows/other/file'])
  })
})
