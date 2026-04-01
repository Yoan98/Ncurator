import type { AiLlmIoRecord, AiRunEvent } from '../../../src/shared/types'

export class EventCollector {
  private readonly list: AiRunEvent[] = []
  private readonly llmIoList: AiLlmIoRecord[] = []

  public add(event: AiRunEvent): void {
    this.list.push(event)
  }

  public addLlmIo(record: AiLlmIoRecord): void {
    this.llmIoList.push(record)
  }

  public snapshot(): AiRunEvent[] {
    return [...this.list]
  }

  public snapshotLlmIo(): AiLlmIoRecord[] {
    return [...this.llmIoList]
  }
}
