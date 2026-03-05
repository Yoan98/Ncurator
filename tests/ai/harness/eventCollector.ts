import type { AiRunEvent } from '../../../src/shared/types'

export class EventCollector {
  private readonly list: AiRunEvent[] = []

  public add(event: AiRunEvent): void {
    this.list.push(event)
  }

  public snapshot(): AiRunEvent[] {
    return [...this.list]
  }
}
