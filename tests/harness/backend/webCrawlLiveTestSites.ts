import http from 'node:http'

type RunningServer = {
  port: number
  close: () => Promise<void>
}

export type MultiHopCrossDomainWebCrawlSite = {
  entryUrl: string
  employmentHubUrl: string
  noticeUrl: string
  guideUrl: string
  applyUrl: string
  close: () => Promise<void>
}

const createServer = async (
  handler: http.RequestListener<typeof http.IncomingMessage, typeof http.ServerResponse>
): Promise<RunningServer> => {
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    handler(request, response)
  })
  await new Promise<void>((resolve) => {
    server.listen(0, resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('local server address unavailable')
  }
  return {
    port: address.port,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    }
  }
}

export const createMultiHopCrossDomainWebCrawlSite = async (): Promise<MultiHopCrossDomainWebCrawlSite> => {
  let policyBaseUrl = ''
  const policyServer = await createServer((request, response) => {
    const currentPath = request.url || '/'
    if (currentPath === '/notice/2026-flexible-employment') {
      response.statusCode = 200
      response.end(`
        <html>
          <head>
            <title>2026年杭州市灵活就业补贴申报通知</title>
            <meta property="article:published_time" content="2026-06-10" />
          </head>
          <body>
            <main>
              申请对象为杭州市灵活就业人员。谁可以申请：杭州市灵活就业人员。申报截止时间为 2026-09-30。办理材料和线上申报方式请继续查看办理指南。
            </main>
            <a href="/guide/flexible-employment">查看办理指南</a>
            <a href="/faq/flexible-employment">查看常见问题</a>
          </body>
        </html>
      `)
      return
    }
    if (currentPath === '/guide/flexible-employment') {
      response.statusCode = 200
      response.end(`
        <html>
          <head><title>灵活就业补贴办理指南</title></head>
          <body>
            <main>
              办理材料包括身份证、社保缴费证明和申请表。线上办理方式说明不在本页，请进入灵活就业补贴申报入口查看在线提交步骤。
            </main>
            <a href="/platform/flexible-employment/apply">进入灵活就业补贴申报入口</a>
            <a href="/offline/service-window">查看线下窗口</a>
            <a href="/faq/flexible-employment">查看常见问题</a>
          </body>
        </html>
      `)
      return
    }
    if (currentPath === '/platform/flexible-employment/apply') {
      response.statusCode = 200
      response.end(`
        <html>
          <head><title>灵活就业补贴线上申报入口</title></head>
          <body>
            <main>
              线上办理方式为：登录就业服务平台后，选择“灵活就业补贴申报”在线提交申请。申请表可下载后上传，提交时需一并上传身份证和社保缴费证明。
            </main>
            <a href="/guide/flexible-employment">返回办理指南</a>
          </body>
        </html>
      `)
      return
    }
    if (currentPath === '/offline/service-window') {
      response.statusCode = 200
      response.end(`
        <html>
          <head><title>线下窗口信息</title></head>
          <body>
            <main>
              本页仅提供线下窗口列表，不包含灵活就业补贴的线上申报流程。
            </main>
            <a href="/guide/flexible-employment">返回办理指南</a>
          </body>
        </html>
      `)
      return
    }
    response.statusCode = 200
    response.end(`
      <html>
        <head><title>灵活就业补贴常见问题</title></head>
        <body>
          <main>
            谁可以申请？杭州市灵活就业人员。常见问题页不重复完整材料和线上办理方式，如需材料请返回办理指南，如需线上办理步骤请进入申报入口页面。
          </main>
          <a href="/guide/flexible-employment">返回办理指南</a>
          <a href="/notice/2026-flexible-employment">返回申报通知</a>
        </body>
      </html>
    `)
  })
  policyBaseUrl = `http://localhost:${String(policyServer.port)}`

  const entryServer = await createServer((request, response) => {
    const currentPath = request.url || '/'
    if (currentPath === '/employment') {
      response.statusCode = 200
      response.end(`
        <html>
          <head><title>灵活就业补贴申请专题</title></head>
          <body>
            <main>
              杭州市灵活就业补贴申请专题汇总了申请对象、办理材料、截止时间和线上办理入口。正式申报信息请继续查看申报通知、办理指南和申报入口。
            </main>
            <a href="${policyBaseUrl}/notice/2026-flexible-employment">2026年杭州市灵活就业补贴申报通知</a>
            <a href="/graduates">毕业生求职创业支持</a>
            <a href="/insurance">失业保险稳岗返还</a>
          </body>
        </html>
      `)
      return
    }
    if (currentPath === '/graduates') {
      response.statusCode = 200
      response.end(`
        <html>
          <head><title>毕业生求职创业支持</title></head>
          <body>
            <main>
              本页介绍毕业生求职创业支持事项，不适用于灵活就业补贴申请。
            </main>
            <a href="/employment">返回就业补贴专题</a>
          </body>
        </html>
      `)
      return
    }
    if (currentPath === '/insurance') {
      response.statusCode = 200
      response.end(`
        <html>
          <head><title>失业保险稳岗返还</title></head>
          <body>
            <main>
              本页介绍稳岗返还事项，不包含灵活就业补贴办理要求。
            </main>
            <a href="/employment">返回就业补贴专题</a>
          </body>
        </html>
      `)
      return
    }
    response.statusCode = 200
    response.end(`
      <html>
        <head><title>城市公共服务导航首页</title></head>
        <body>
          <main>
            本页汇总社保、医保、就业和补贴事项，请按专题继续查看。其中灵活就业补贴申请专题汇总了申请对象、材料、截止时间和线上办理信息。
          </main>
          <a href="/employment">灵活就业补贴申请专题</a>
          <a href="/insurance">失业保险稳岗返还</a>
          <a href="/graduates">毕业生求职创业支持</a>
        </body>
      </html>
    `)
  })

  const entryBaseUrl = `http://127.0.0.1:${String(entryServer.port)}`
  return {
    entryUrl: `${entryBaseUrl}/`,
    employmentHubUrl: `${entryBaseUrl}/employment`,
    noticeUrl: `${policyBaseUrl}/notice/2026-flexible-employment`,
    guideUrl: `${policyBaseUrl}/guide/flexible-employment`,
    applyUrl: `${policyBaseUrl}/platform/flexible-employment/apply`,
    close: async () => {
      await policyServer.close()
      await entryServer.close()
    }
  }
}
