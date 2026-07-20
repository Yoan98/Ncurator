export type TerminalProtocolEvent =
  | { type: 'output'; data: string }
  | { type: 'ready' }
  | { type: 'cwd'; encodedCwd: string }
  | { type: 'start'; commandId: string }
  | { type: 'done'; commandId: string; exitCodeText: string; encodedCwd: string }

const MARKER_SUFFIX = '__'

export class TerminalProtocol {
  public readonly readyMarker: string
  public readonly cwdPrefix: string
  public readonly startPrefix: string
  public readonly donePrefix: string
  private buffer = ''

  public constructor(token: string) {
    const normalizedToken = token.replaceAll('-', '')
    if (!/^[a-zA-Z0-9]+$/u.test(normalizedToken)) {
      throw new Error('invalid_terminal_protocol_token')
    }
    const markerBase = `__NCURATOR_${normalizedToken}_`
    this.readyMarker = `${markerBase}READY${MARKER_SUFFIX}`
    this.cwdPrefix = `${markerBase}CWD:`
    this.startPrefix = `${markerBase}START:`
    this.donePrefix = `${markerBase}DONE:`
  }

  public startMarker(commandId: string): string {
    return `${this.startPrefix}${commandId}${MARKER_SUFFIX}`
  }

  public consume(data: string): TerminalProtocolEvent[] {
    this.buffer += data
    const events: TerminalProtocolEvent[] = []
    const markerStarts = [this.readyMarker, this.cwdPrefix, this.startPrefix, this.donePrefix]

    for (;;) {
      const markerIndexes = markerStarts
        .map((marker) => this.buffer.indexOf(marker))
        .filter((index) => index >= 0)

      if (markerIndexes.length === 0) {
        const keepLength = markerStarts.reduce((longest, marker) => {
          const maxCandidateLength = Math.min(this.buffer.length, marker.length - 1)
          for (let length = maxCandidateLength; length > longest; length -= 1) {
            if (marker.startsWith(this.buffer.slice(-length))) return length
          }
          return longest
        }, 0)
        const flushLength = this.buffer.length - keepLength
        if (flushLength > 0) {
          events.push({ type: 'output', data: this.buffer.slice(0, flushLength) })
          this.buffer = this.buffer.slice(flushLength)
        }
        return events
      }

      const markerIndex = Math.min(...markerIndexes)
      if (markerIndex > 0) {
        events.push({ type: 'output', data: this.buffer.slice(0, markerIndex) })
        this.buffer = this.buffer.slice(markerIndex)
      }

      if (this.buffer.startsWith(this.readyMarker)) {
        this.buffer = this.buffer.slice(this.readyMarker.length)
        events.push({ type: 'ready' })
        continue
      }

      const variableMarker = [
        { prefix: this.cwdPrefix, type: 'cwd' as const },
        { prefix: this.startPrefix, type: 'start' as const },
        { prefix: this.donePrefix, type: 'done' as const }
      ].find((candidate) => this.buffer.startsWith(candidate.prefix))
      if (!variableMarker) continue

      const endIndex = this.buffer.indexOf(MARKER_SUFFIX, variableMarker.prefix.length)
      if (endIndex < 0) return events
      const payload = this.buffer.slice(variableMarker.prefix.length, endIndex)
      this.buffer = this.buffer.slice(endIndex + MARKER_SUFFIX.length)

      if (variableMarker.type === 'cwd') {
        events.push({ type: 'cwd', encodedCwd: payload })
        continue
      }
      if (variableMarker.type === 'start') {
        events.push({ type: 'start', commandId: payload })
        continue
      }
      const [commandId = '', exitCodeText = '', encodedCwd = ''] = payload.split(':')
      events.push({ type: 'done', commandId, exitCodeText, encodedCwd })
    }
  }
}
