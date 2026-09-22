export type ScheduledTaskListItemOutput = {
  id: string
  name: string
  description: string
  scheduleType: 'daily' | 'weekly'
  timeOfDay: string
  weekday: number | null
  enabled: boolean
}

export type ScheduledTaskListOutput = {
  tasks: ScheduledTaskListItemOutput[]
}

export type ScheduledTaskMutationOutput = {
  id: string
}
