import { describe, expect, it } from 'vitest'
import { buildTerminalEnvironment } from '../../../../src/main/services/ai/human/tools/terminal/environment/TerminalEnvironment'
import { getTerminalPlatformAdapter } from '../../../../src/main/services/ai/human/tools/terminal/platform'
import { TerminalProtocol } from '../../../../src/main/services/ai/human/tools/terminal/protocol/TerminalProtocol'

describe('terminal platform adapters', () => {
  it('enforces deterministic macOS UTF-8 after runtime overrides', () => {
    const environment = buildTerminalEnvironment({
      platform: 'macos',
      managerEnvironment: { LANG: 'C.UTF-8', LC_ALL: 'C' },
      sessionEnvironment: { LC_CTYPE: 'C', PATH: '/custom/bin' }
    })

    expect(environment).toMatchObject({
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      LC_CTYPE: 'en_US.UTF-8',
      PATH: '/custom/bin',
      TERM: 'xterm-256color'
    })
  })

  it('enforces Windows UTF-8 runtime variables after overrides', () => {
    const environment = buildTerminalEnvironment({
      platform: 'windows',
      sessionEnvironment: { PYTHONIOENCODING: 'cp1252', PYTHONUTF8: '0' }
    })

    expect(environment.PYTHONIOENCODING).toBe('utf-8')
    expect(environment.PYTHONUTF8).toBe('1')
  })

  it('keeps protocol literals encoded in shell input and initializes Windows UTF-8', () => {
    const protocol = new TerminalProtocol('sessiontoken')
    const macBootstrap = getTerminalPlatformAdapter('macos').buildBootstrapCommand(protocol)
    const windowsBootstrap = getTerminalPlatformAdapter('windows').buildBootstrapCommand(protocol)

    expect(macBootstrap).not.toContain(protocol.readyMarker)
    expect(Buffer.byteLength(macBootstrap, 'utf8')).toBeLessThan(1024)
    expect(windowsBootstrap).not.toContain(protocol.readyMarker)
    expect(Buffer.byteLength(windowsBootstrap, 'utf8')).toBeLessThan(8192)
    expect(windowsBootstrap).toContain('[Console]::InputEncoding')
    expect(windowsBootstrap).toContain('[Console]::OutputEncoding')
    expect(windowsBootstrap).toContain('$OutputEncoding')
    expect(windowsBootstrap).toContain('chcp.com 65001')
  })
})
