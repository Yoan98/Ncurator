import { wrapModelTextLines } from './shared'

export const renderTerminalStream = (input: { output: string; markers: string[] }): string => {
  const body = input.output.length > 0 ? input.output.replace(/\r\n/gu, '\n').replace(/\r/gu, '\n') : '(no output)'
  const trimmed = body.endsWith('\n') ? body : `${body}\n`
  const markerLines = input.markers.map((marker) => `[${marker}]`)
  return wrapModelTextLines(`${trimmed}${markerLines.join('\n')}`)
}

export const formatTerminalMarker = (key: string, value: string | number | boolean): string =>
  `${key}: ${String(value)}`
