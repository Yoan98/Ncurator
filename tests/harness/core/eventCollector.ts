import type { AiLlmIoRecord, AiRunEvent } from '../../../src/shared/types'
import { readJsonLinesSync } from './read-run-log'

type EventCollectorSink = {
  onRuntimeEvent?: (event: AiRunEvent) => void
  onLlmIo?: (record: AiLlmIoRecord) => void
}

type EventCollectorOptions = {
  sink?: EventCollectorSink
  retainRuntimeEvents?: boolean
  retainLlmIoRecords?: boolean
  runtimeEventsPath?: string
  llmIoPath?: string
}

export class EventCollector {
  private readonly runtimeEvents?: AiRunEvent[]
  private readonly llmIoList?: AiLlmIoRecord[]
  private readonly sink?: EventCollectorSink
  private readonly runtimeEventsPath?: string
  private readonly llmIoPath?: string

  public constructor(options?: EventCollectorOptions) {
    this.sink = options?.sink
    this.runtimeEventsPath = options?.runtimeEventsPath
    this.llmIoPath = options?.llmIoPath
    if (options?.retainRuntimeEvents !== false) {
      this.runtimeEvents = []
    }
    if (options?.retainLlmIoRecords !== false) {
      this.llmIoList = []
    }
  }

  public add(event: AiRunEvent): void {
    this.runtimeEvents?.push(event)
    this.sink?.onRuntimeEvent?.(event)
  }

  public addLlmIo(record: AiLlmIoRecord): void {
    this.llmIoList?.push(record)
    this.sink?.onLlmIo?.(record)
  }

  public snapshot(): AiRunEvent[] {
    if (this.runtimeEvents) {
      return [...this.runtimeEvents]
    }
    return this.runtimeEventsPath ? readJsonLinesSync<AiRunEvent>(this.runtimeEventsPath) : []
  }

  public snapshotLlmIo(): AiLlmIoRecord[] {
    if (this.llmIoList) {
      return [...this.llmIoList]
    }
    return this.llmIoPath ? readJsonLinesSync<AiLlmIoRecord>(this.llmIoPath) : []
  }
}
