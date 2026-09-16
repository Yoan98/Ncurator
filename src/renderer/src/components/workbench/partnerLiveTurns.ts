import type { AssistantTurnViewModel } from './types'

const longerList = <T>(left: readonly T[], right: readonly T[]): T[] =>
  left.length >= right.length ? [...left] : [...right]

const hasRunningRetry = (turn: AssistantTurnViewModel): boolean =>
  turn.processGroups.some((group) => group.kind === 'retry' && group.status === 'running')

export const resumeAssistantTurnFromLive = (
  snapshot: AssistantTurnViewModel,
  live: AssistantTurnViewModel | undefined
): AssistantTurnViewModel => {
  if (!live || snapshot.runFinished) return snapshot
  if (live.runFinished) return snapshot
  const liveRetryRunning = hasRunningRetry(live)
  return {
    ...snapshot,
    ...live,
    messageId: snapshot.messageId,
    runId: snapshot.runId || live.runId,
    processThoughts: longerList(live.processThoughts, snapshot.processThoughts),
    processGroups: liveRetryRunning
      ? [...live.processGroups]
      : longerList(live.processGroups, snapshot.processGroups),
    artifacts: longerList(live.artifacts, snapshot.artifacts),
    applyTargets: longerList(live.applyTargets, snapshot.applyTargets),
    streamingMarkdown: live.streamingMarkdown || snapshot.streamingMarkdown,
    finalAnswerMarkdown: live.finalAnswerMarkdown || snapshot.finalAnswerMarkdown,
    isBrainThinking: liveRetryRunning
      ? false
      : Boolean(live.isBrainThinking || snapshot.isBrainThinking)
  }
}
