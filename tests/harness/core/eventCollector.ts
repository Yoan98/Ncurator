import type { AiLlmIoRecord, AiRunEvent } from '../../../src/shared/types'

type EventCollectorSink = {
  onRuntimeEvent?: (event: AiRunEvent) => void
  onLlmIo?: (record: AiLlmIoRecord) => void
}

export class EventCollector {
  private readonly list: AiRunEvent[] = []
  private readonly llmIoList: AiLlmIoRecord[] = []
  private readonly sink?: EventCollectorSink

  public constructor(sink?: EventCollectorSink) {
    this.sink = sink
  }

  public add(event: AiRunEvent): void {
    this.list.push(event)
    this.sink?.onRuntimeEvent?.(event)
  }

  public addLlmIo(record: AiLlmIoRecord): void {
    this.llmIoList.push(record)
    this.sink?.onLlmIo?.(record)
  }

  public snapshot(): AiRunEvent[] {
    return [...this.list]
  }

  public snapshotLlmIo(): AiLlmIoRecord[] {
    return [...this.llmIoList]
  }
}
