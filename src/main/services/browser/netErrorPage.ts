export const NET_ERROR_PAGE_TITLE = '无法访问此站点'
export const BROWSER_RELOAD_CONSOLE_TOKEN = 'ncurator:browser-reload'

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

export const netErrorDisplayHost = (attemptedUrl: string): string => {
  const raw = String(attemptedUrl || '').trim()
  if (!raw) return ''
  try {
    return new URL(raw).host || raw
  } catch {
    return raw.replace(/^[a-z][a-z\d+.-]*:\/\//iu, '').split('/')[0] || raw
  }
}

export const buildNetErrorDocumentHtml = (code: string, attemptedUrl: string): string => {
  const safeCode = escapeHtml(String(code || 'ERR_FAILED').trim() || 'ERR_FAILED')
  const host = escapeHtml(netErrorDisplayHost(attemptedUrl) || '此网站')
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>${NET_ERROR_PAGE_TITLE}</title>
    <style>
      html,body{height:100%;margin:0;background:#fff;color:#5f6368;font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
      main{box-sizing:border-box;max-width:600px;padding:18vh 0 0 10vw}
      .icon{display:block;width:48px;height:48px;margin:0 0 18px}
      h1{margin:0 0 8px;font-size:24px;font-weight:500;color:#202124;line-height:1.3}
      .lead{margin:0 0 20px;font-size:16px;color:#5f6368}
      .hints{margin:0;font-size:14px;color:#5f6368}
      .hints p{margin:0 0 6px}
      .hints ul{margin:0;padding-left:1.3em}
      .hints li{margin:2px 0}
      .code{margin:28px 0 0;font-size:13px;color:#80868b;letter-spacing:.01em}
      button{margin-top:28px;padding:8px 16px;border:0;border-radius:16px;background:#f1f3f4;color:#202124;font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;cursor:pointer}
      button:hover{background:#e8eaed}
    </style>
  </head>
  <body>
    <main>
      <svg class="icon" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="none" stroke="#1a73e8" stroke-width="4.5" stroke-linecap="round" d="M24 7.5c9.1 0 16.5 7.4 16.5 16.5S33.1 40.5 24 40.5 7.5 33.1 7.5 24c0-6.1 3.3-11.4 8.2-14.3"/>
        <path fill="none" stroke="#1a73e8" stroke-width="4.5" stroke-linecap="round" d="M24 15c5 0 9 4 9 9s-4 9-9 9-9-4-9-9c0-3.3 1.8-6.2 4.4-7.8"/>
        <path fill="none" stroke="#1a73e8" stroke-width="4.5" stroke-linecap="round" d="M24 22.5c1.4 0 2.5 1.1 2.5 2.5"/>
      </svg>
      <h1>${NET_ERROR_PAGE_TITLE}</h1>
      <p class="lead">无法加载 ${host}</p>
      <div class="hints">
        <p>尝试：</p>
        <ul>
          <li>检查网络连接</li>
          <li>检查代理、防火墙和 DNS 配置</li>
        </ul>
      </div>
      <p class="code">${safeCode}</p>
      <button id="reload" type="button">重新加载</button>
    </main>
    <script>
      document.getElementById('reload')?.addEventListener('click', function (event) {
        event.preventDefault();
        console.debug(${JSON.stringify(BROWSER_RELOAD_CONSOLE_TOKEN)});
      });
    </script>
  </body>
</html>`
}
