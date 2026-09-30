import { describe, it, expect } from 'vitest'
import { SerialRequestQueue } from '../../../../src/main/services/webCrawler/SerialRequestQueue'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('shared sidecar FIFO', () => {
  it('serializes all requests and retains an active cancelled slot', async () => {
    const queue = new SerialRequestQueue()
    const first = deferred<string>()
    const controller = new AbortController()
    const calls: string[] = []
    const a = queue.enqueue(async () => {
      calls.push('crawl')
      return await first.promise
    }, controller.signal)
    const aRejected = expect(a).rejects.toMatchObject({ code: 'CANCELLED' })
    const b = queue.enqueue(async () => {
      calls.push('search')
      return 'search-result'
    })
    controller.abort()
    await aRejected
    expect(calls).toEqual(['crawl'])
    first.resolve('ignored')
    expect(await b).toBe('search-result')
    expect(calls).toEqual(['crawl', 'search'])
  })
  it('does not submit cancelled queued requests', async () => {
    const queue = new SerialRequestQueue()
    const first = deferred<void>()
    const a = queue.enqueue(() => first.promise)
    const controller = new AbortController()
    let submitted = false
    const b = queue.enqueue(async () => {
      submitted = true
    }, controller.signal)
    const rejected = expect(b).rejects.toMatchObject({ code: 'CANCELLED' })
    controller.abort()
    await rejected
    first.resolve()
    await a
    await queue.enqueue(async () => 'next')
    expect(submitted).toBe(false)
  })
  it('advances after timeout/failure and closes pending callers', async () => {
    const queue = new SerialRequestQueue()
    const a = queue.enqueue(async () => {
      throw new Error('request timeout')
    })
    const b = queue.enqueue(async () => 42)
    await expect(a).rejects.toThrow('request timeout')
    expect(await b).toBe(42)
    queue.close()
    await expect(queue.enqueue(async () => 1)).rejects.toThrow('closed')
  })
})
