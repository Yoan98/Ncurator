import { AsyncLocalStorage } from 'node:async_hooks'

export type E2EResourcePhase = 'before-app-close' | 'after-app-close'

export type E2EResource = {
  name: string
  phase: E2EResourcePhase
  dispose: () => Promise<void>
}

export type E2EResourceDisposalError = {
  name: string
  phase: E2EResourcePhase
  error: Error
}

export class E2EResourceScope {
  private readonly resources: E2EResource[] = []
  private readonly disposedPhases = new Set<E2EResourcePhase>()

  register(resource: E2EResource): void {
    if (this.disposedPhases.has(resource.phase)) {
      throw new Error(`cannot register ${resource.name} after ${resource.phase} disposal`)
    }
    this.resources.push(resource)
  }

  async dispose(phase: E2EResourcePhase): Promise<E2EResourceDisposalError[]> {
    if (this.disposedPhases.has(phase)) return []
    this.disposedPhases.add(phase)

    const errors: E2EResourceDisposalError[] = []
    const resources = this.resources.filter((resource) => resource.phase === phase).reverse()
    for (const resource of resources) {
      try {
        await resource.dispose()
      } catch (error) {
        errors.push({
          name: resource.name,
          phase,
          error: error instanceof Error ? error : new Error(String(error))
        })
      }
    }
    return errors
  }
}

const activeScope = new AsyncLocalStorage<E2EResourceScope>()

export const runWithE2EResourceScope = async <TResult>(
  scope: E2EResourceScope,
  run: () => Promise<TResult>
): Promise<TResult> => await activeScope.run(scope, run)

export const registerE2EResource = (resource: E2EResource): void => {
  const scope = activeScope.getStore()
  if (!scope) {
    throw new Error(`E2E resource ${resource.name} was created outside runE2ECase`)
  }
  scope.register(resource)
}
