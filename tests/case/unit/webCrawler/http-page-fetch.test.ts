import http from 'node:http'
import { describe, expect, it } from 'vitest'
import { fetchHttpPage } from '../../../../src/main/services/ai/human/tools/web/httpPageFetch'

describe('HTTP visible page content', () => {
  it('excludes scripts and falls through when only JavaScript can supply the body', async () => {
    const server = http.createServer((request, response) => {
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end(
        request.url === '/visible'
          ? '<title>资料</title><main>实际正文</main><script>secret_source()</script><style>.source{}</style><template>模板内容</template>'
          : '<title>只有标题</title><main id="facts"></main><script>document.querySelector("#facts").textContent = "渲染事实"</script>'
      )
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('test HTTP address unavailable')
    try {
      const url = `http://127.0.0.1:${address.port}`
      expect((await fetchHttpPage(`${url}/visible`)).markdown).toBe('实际正文')
      await expect(fetchHttpPage(`${url}/rendered`)).rejects.toThrow('网页正文为空')
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
