import { createHash } from 'node:crypto'
import type { Duplex } from 'node:stream'

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const MAX_PAYLOAD_BYTES = 32 * 1024 * 1024
const OP_CONTINUATION = 0x0
const OP_TEXT = 0x1
const OP_BINARY = 0x2
const OP_CLOSE = 0x8
const OP_PING = 0x9
const OP_PONG = 0xa

export const createWebSocketAcceptKey = (secWebSocketKey: string): string =>
  createHash('sha1').update(`${secWebSocketKey}${WS_GUID}`).digest('base64')

const unmask = (payload: Buffer, mask: Buffer): Buffer => {
  const output = Buffer.allocUnsafe(payload.length)
  for (let index = 0; index < payload.length; index += 1) {
    output[index] = payload[index]! ^ mask[index % 4]!
  }
  return output
}

const encodeFrame = (opcode: number, payload: Buffer): Buffer => {
  const length = payload.length
  let headerSize = 2
  if (length >= 65_536) headerSize = 10
  else if (length >= 126) headerSize = 4
  const header = Buffer.alloc(headerSize)
  header[0] = 0x80 | opcode
  if (length < 126) {
    header[1] = length
  } else if (length < 65_536) {
    header[1] = 126
    header.writeUInt16BE(length, 2)
  } else {
    header[1] = 127
    header.writeUInt32BE(0, 2)
    header.writeUInt32BE(length, 6)
  }
  return Buffer.concat([header, payload])
}

export class LoopbackWebSocket {
  private buffer = Buffer.alloc(0)
  private closed = false
  private fragments: Buffer[] = []
  private fragmentOpcode = 0
  private messageHandler: ((data: string) => void) | null = null
  private closeHandler: (() => void) | null = null

  public constructor(private readonly socket: Duplex) {
    socket.on('data', (chunk) => this.onData(chunk))
    socket.on('end', () => this.handleClose())
    socket.on('close', () => this.handleClose())
    socket.on('error', () => this.handleClose())
  }

  public onMessage(handler: (data: string) => void): void {
    this.messageHandler = handler
  }

  public onClose(handler: () => void): void {
    this.closeHandler = handler
  }

  public send(data: string): void {
    if (this.closed || this.socket.destroyed) return
    this.socket.write(encodeFrame(OP_TEXT, Buffer.from(data, 'utf8')))
  }

  public close(): void {
    if (this.closed) return
    this.closed = true
    if (!this.socket.destroyed) {
      try {
        this.socket.write(encodeFrame(OP_CLOSE, Buffer.alloc(0)))
        this.socket.end()
      } catch {
        this.socket.destroy()
      }
    }
    this.closeHandler?.()
  }

  private handleClose(): void {
    if (this.closed) return
    this.closed = true
    this.closeHandler?.()
  }

  private onData(chunk: Buffer): void {
    if (this.closed) return
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (this.parseFrame()) {
      // Keep draining complete frames from the buffer.
    }
  }

  private parseFrame(): boolean {
    if (this.buffer.length < 2) return false
    const first = this.buffer[0]!
    const second = this.buffer[1]!
    const fin = (first & 0x80) !== 0
    const opcode = first & 0x0f
    const masked = (second & 0x80) !== 0
    let payloadLength = second & 0x7f
    let offset = 2
    if (payloadLength === 126) {
      if (this.buffer.length < 4) return false
      payloadLength = this.buffer.readUInt16BE(2)
      offset = 4
    } else if (payloadLength === 127) {
      if (this.buffer.length < 10) return false
      const high = this.buffer.readUInt32BE(2)
      const low = this.buffer.readUInt32BE(6)
      if (high !== 0 || low > MAX_PAYLOAD_BYTES) {
        this.close()
        return false
      }
      payloadLength = low
      offset = 10
    }
    if (payloadLength > MAX_PAYLOAD_BYTES) {
      this.close()
      return false
    }
    const maskSize = masked ? 4 : 0
    if (this.buffer.length < offset + maskSize + payloadLength) return false
    const mask = masked ? this.buffer.subarray(offset, offset + 4) : Buffer.alloc(4)
    offset += maskSize
    const payload = this.buffer.subarray(offset, offset + payloadLength)
    this.buffer = this.buffer.subarray(offset + payloadLength)
    const data = masked ? unmask(payload, mask) : payload
    this.dispatchFrame(fin, opcode, data)
    return this.buffer.length >= 2
  }

  private dispatchFrame(fin: boolean, opcode: number, payload: Buffer): void {
    if (opcode === OP_CLOSE) {
      this.close()
      return
    }
    if (opcode === OP_PING) {
      if (!this.closed && !this.socket.destroyed) {
        this.socket.write(encodeFrame(OP_PONG, payload))
      }
      return
    }
    if (opcode === OP_PONG) return
    if (opcode === OP_CONTINUATION) {
      this.fragments.push(payload)
      if (fin) this.flushFragments()
      return
    }
    if (opcode !== OP_TEXT && opcode !== OP_BINARY) return
    if (!fin) {
      this.fragmentOpcode = opcode
      this.fragments = [payload]
      return
    }
    this.emitMessage(payload)
  }

  private flushFragments(): void {
    const payload = Buffer.concat(this.fragments)
    this.fragments = []
    this.fragmentOpcode = 0
    this.emitMessage(payload)
  }

  private emitMessage(payload: Buffer): void {
    if (this.fragmentOpcode === OP_BINARY) return
    this.messageHandler?.(payload.toString('utf8'))
  }
}
