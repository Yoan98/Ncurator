import { describe, expect, it } from 'vitest'
import {
  TerminalProtocol,
  type TerminalProtocolEvent
} from '../../../../src/main/services/ai/human/tools/terminal/protocol/TerminalProtocol'

describe('terminal protocol', () => {
  it('parses unicode output and markers split across arbitrary chunks', () => {
    const protocol = new TerminalProtocol('sessiontoken')
    const cwd = Buffer.from('/tmp/中文目录', 'utf8').toString('base64')
    const stream = [
      '启动😀\n',
      protocol.readyMarker,
      protocol.startMarker('command-1'),
      '中文输出\n',
      `${protocol.cwdPrefix}${cwd}__`,
      `${protocol.donePrefix}command-1:0:${cwd}__`,
      '结束\n'
    ].join('')
    const rawEvents = Array.from(stream).flatMap((character) => protocol.consume(character))
    const events: TerminalProtocolEvent[] = []
    for (const event of rawEvents) {
      const previous = events.at(-1)
      if (event.type === 'output' && previous?.type === 'output') {
        previous.data += event.data
      } else {
        events.push(event)
      }
    }

    expect(events).toEqual([
      { type: 'output', data: '启动😀\n' },
      { type: 'ready' },
      { type: 'start', commandId: 'command-1' },
      { type: 'output', data: '中文输出\n' },
      { type: 'cwd', encodedCwd: cwd },
      { type: 'done', commandId: 'command-1', exitCodeText: '0', encodedCwd: cwd },
      { type: 'output', data: '结束\n' }
    ])
  })

  it('does not treat another session marker as protocol', () => {
    const protocol = new TerminalProtocol('currenttoken')
    const otherMarker = '__NCURATOR_othertoken_DONE:command-1:0:Y3dk__'

    expect(protocol.consume(`${otherMarker}\n`)).toEqual([
      { type: 'output', data: `${otherMarker}\n` }
    ])
  })

  it('releases short incremental output without waiting for a fixed buffer size', () => {
    const protocol = new TerminalProtocol('sessiontoken')

    expect(protocol.consume('tick\n')).toEqual([{ type: 'output', data: 'tick\n' }])
  })
})
