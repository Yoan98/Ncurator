import type { IpcJsonObject, IpcJsonValue } from '../../../../shared/types'
import type { AssistantProcessGroup, SubagentTaskView } from './types'

const readValue = (input: IpcJsonObject, key: string): IpcJsonValue | undefined =>
  (input as Record<string, IpcJsonValue>)[key]

const readString = (input: IpcJsonObject, key: string): string | undefined => {
  const value = readValue(input, key)
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

const isObject = (value: IpcJsonValue): value is IpcJsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** Keep dispatch failures in the same avatar flow as real executions, never in Activity. */
export const presentSubagentGroups = (groups: AssistantProcessGroup[]): AssistantProcessGroup[] => {
  const names = new Map(
    groups.flatMap((group) => (group.subagents || []).map((child) => [child.agentId, child.name]))
  )
  const rows = new Map<string, { groupId: string; child: SubagentTaskView }>()
  const agentRows = new Map<string, string>()
  const pendingCreations = new Map<string, string[]>()

  const upsert = (groupId: string, child: SubagentTaskView): void => {
    const assignmentKey = JSON.stringify([child.name, child.task])
    const pendingIds = pendingCreations.get(assignmentKey) || []
    const pendingId = pendingIds.find((id) => rows.get(id)?.child.toolCallId !== child.toolCallId)
    const previousId = child.agentId
      ? agentRows.get(child.agentId) || pendingId
      : pendingId
    const id = previousId || child.id
    const previous = rows.get(id)
    rows.set(id, { groupId: previous?.groupId || groupId, child: { ...child, id } })
    if (child.agentId) agentRows.set(child.agentId, id)
    if (child.childRunId) {
      pendingCreations.set(assignmentKey, pendingIds.filter((pending) => pending !== id))
    } else if (!child.agentId && !pendingIds.includes(id)) {
      pendingCreations.set(assignmentKey, [...pendingIds, id])
    }
  }

  for (const group of groups) {
    if (group.subagents?.length) {
      group.subagents.forEach((child) => upsert(group.id, child))
      continue
    }
    for (const item of group.items) {
      if (item.toolName !== 'delegate_to_subagent' || item.status !== 'failed') continue
      const agents = item.input ? readValue(item.input, 'agents') : undefined
      const assignments = Array.isArray(agents) ? agents.filter(isObject) : []
      // A malformed whole call still needs a visible place for its error.
      for (const [index, assignment] of (assignments.length ? assignments : [{}]).entries()) {
        const agentId = readString(assignment, 'agentId')
        const result = item.error?.trim() || '未知错误'
        upsert(group.id, {
          id: agentId || `${item.id}:${index}`,
          agentId,
          toolCallId: item.id,
          name: (agentId && names.get(agentId)) || readString(assignment, 'name') || '临时帮手',
          task: readString(assignment, 'instruction') || '',
          status: 'failed',
          result,
          message: result,
          messageId: `failure:${item.id}`,
          messageStartedAt: item.failureStartedAt,
          actions: []
        })
      }
    }
  }

  const childrenByGroup = new Map<string, SubagentTaskView[]>()
  for (const { groupId, child } of rows.values()) {
    const children = childrenByGroup.get(groupId) || []
    children.push(child)
    childrenByGroup.set(groupId, children)
  }
  return groups.flatMap((group) => {
    const isDispatch =
      group.toolName === 'delegate_to_subagent' ||
      group.items.some((item) => item.toolName === 'delegate_to_subagent') ||
      Boolean(group.subagents?.length)
    if (!isDispatch) return [group]
    const items = group.items.filter((item) => item.toolName !== 'delegate_to_subagent')
    const subagents = childrenByGroup.get(group.id)
    return items.length || subagents?.length ? [{ ...group, items, subagents }] : []
  })
}
