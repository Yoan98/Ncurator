import { BrowserWindow } from 'electron'
import type { ConfirmDialogRequest, ConfirmDialogResponse } from '../../shared/types'

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }
    return entities[character]
  })

const renderDialog = (request: ConfirmDialogRequest): string => `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
  <title>${escapeHtml(request.title)}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 100%; height: 100%; }
    body { color: #37352F; font: 14px/1.5715 "SF Pro Text", "PingFang SC", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; -webkit-app-region: no-drag; }
    #mask { position: fixed; inset: 0; overflow: auto; background: rgba(0, 0, 0, .45); padding: min(100px, 12vh) 16px 24px; }
    #dialog { position: relative; width: 520px; max-width: 100%; margin: 0 auto; padding: 20px 24px; border-radius: 8px; background: #fff; box-shadow: 0 16px 40px rgba(15, 15, 15, .12); }
    h1 { margin: 0 32px 16px 0; font-size: 16px; line-height: 24px; font-weight: 600; }
    p { margin: 0; color: #787774; white-space: pre-wrap; overflow-wrap: anywhere; }
    #detail { margin-top: 12px; padding: 8px 12px; background: #F7F7F5; border: 1px solid #EEEEEC; border-radius: 6px; font-weight: 500; white-space: pre-wrap; overflow-wrap: anywhere; }
    #error { margin-top: 12px; color: #B3261E; }
    [hidden] { display: none !important; }
    footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
    button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 34px; padding: 4px 15px; border: 1px solid #EEEEEC; border-radius: 6px; background: #fff; color: inherit; font: inherit; cursor: pointer; }
    button:hover { background: #F4F4F2; }
    button:focus-visible { outline: 2px solid #0B6BCB; outline-offset: 2px; }
    button:disabled { cursor: not-allowed; opacity: .65; }
    #confirm { color: #fff; border-color: #2F3437; background: #2F3437; }
    #confirm:hover { background: #474C50; }
    #confirm.danger { background: #ff4d4f; border-color: #ff4d4f; }
    #confirm.danger:hover { background: #ff7875; border-color: #ff7875; }
    #close { position: absolute; top: 12px; right: 12px; width: 32px; height: 32px; padding: 0; border: 0; color: #91918E; }
    #close svg { width: 16px; height: 16px; }
    #spinner { width: 12px; height: 12px; border: 1.5px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: spin .8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div id="mask">
    <section id="dialog" role="dialog" aria-modal="true" aria-labelledby="title" aria-describedby="message">
      <button id="close" aria-label="关闭"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m3 3 10 10M13 3 3 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
      <h1 id="title">${escapeHtml(request.title)}</h1>
      <p id="message">${escapeHtml(request.message)}</p>
      <div id="detail" ${request.detail ? '' : 'hidden'}>${escapeHtml(request.detail || '')}</div>
      <p id="error" role="alert" ${request.error ? '' : 'hidden'}>${escapeHtml(request.error || '')}</p>
      <footer>
        <button id="cancel">${escapeHtml(request.cancelText || '取消')}</button>
        <button id="confirm" class="${request.danger ? 'danger' : ''}"><span id="spinner" hidden aria-hidden="true"></span>${escapeHtml(request.confirmText)}</button>
      </footer>
    </section>
  </div>
  <script>
    let pending = false;
    function setPending(value) {
      pending = value;
      for (const id of ['close', 'cancel', 'confirm']) document.getElementById(id).disabled = value;
      document.getElementById('spinner').hidden = !value;
      document.getElementById('dialog').setAttribute('aria-busy', String(value));
    }
    function decide(action) {
      if (pending) return;
      if (action === 'confirm') setPending(true);
      window.open('ncurator-confirm://' + action, '_blank');
    }
    document.getElementById('confirm').addEventListener('click', () => decide('confirm'));
    for (const id of ['cancel', 'close']) document.getElementById(id).addEventListener('click', () => decide('cancel'));
    document.getElementById('mask').addEventListener('click', (event) => { if (event.target.id === 'mask') decide('cancel'); });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); decide('cancel'); }
      if (event.key !== 'Tab') return;
      const buttons = Array.from(document.querySelectorAll('button:not(:disabled)'));
      if (!buttons.length) { event.preventDefault(); return; }
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    document.getElementById('cancel').focus();
  </script>
</body>
</html>`

type DialogState = {
  window: BrowserWindow
  owner: BrowserWindow
  dialogId: string
  pending: boolean
  resolve: ((response: ConfirmDialogResponse) => void) | null
  cleanup: () => void
}

/** Native child window keeps confirmations above WebContentsView without changing browser state. */
export class ConfirmDialogWindowService {
  private active: DialogState | null = null

  public show(owner: BrowserWindow, request: ConfirmDialogRequest): Promise<ConfirmDialogResponse> {
    if (owner.isDestroyed()) return Promise.resolve({ success: true, action: 'cancel' })
    if (!request.dialogId || !request.title || !request.confirmText) {
      return Promise.resolve({ success: false, error: '确认弹窗参数不完整' })
    }
    const existing = this.active
    if (existing && existing.owner === owner && existing.dialogId === request.dialogId) {
      if (existing.resolve) {
        return Promise.resolve({ success: false, error: '确认弹窗正在等待操作' })
      }
      return new Promise((resolve) => {
        existing.resolve = resolve
        existing.pending = false
        void existing.window.webContents
          .executeJavaScript(
            `
            document.getElementById('error').textContent = ${JSON.stringify(request.error || '')};
            document.getElementById('error').hidden = ${!request.error};
            setPending(false);
            document.getElementById('cancel').focus();
          `
          )
          .catch((error: Error) => this.dispose(existing, { success: false, error: error.message }))
      })
    }
    if (existing) this.dispose(existing)

    return new Promise((resolve) => {
      const window = new BrowserWindow({
        parent: owner,
        ...owner.getContentBounds(),
        show: false,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        hasShadow: false,
        roundedCorners: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        acceptFirstMouse: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true
        }
      })
      const syncBounds = (): void => {
        if (!owner.isDestroyed() && !window.isDestroyed()) {
          window.setBounds(owner.getContentBounds(), false)
        }
      }
      const hide = (): void => window.hide()
      const restore = (): void => {
        if (window.isDestroyed()) return
        syncBounds()
        window.show()
      }
      const dismiss = (): void => this.dispose(state)
      const state: DialogState = {
        window,
        owner,
        dialogId: request.dialogId,
        pending: false,
        resolve,
        cleanup: () => {
          clearTimeout(loadTimer)
          owner.removeListener('move', syncBounds)
          owner.removeListener('resize', syncBounds)
          owner.removeListener('minimize', hide)
          owner.removeListener('restore', restore)
          owner.removeListener('closed', dismiss)
          owner.webContents.removeListener('render-process-gone', dismiss)
          owner.webContents.removeListener('destroyed', dismiss)
        }
      }
      this.active = state
      owner.on('move', syncBounds)
      owner.on('resize', syncBounds)
      owner.on('minimize', hide)
      owner.on('restore', restore)
      owner.once('closed', dismiss)
      owner.webContents.once('render-process-gone', dismiss)
      owner.webContents.once('destroyed', dismiss)
      window.once('closed', dismiss)
      window.on('close', (event) => {
        event.preventDefault()
        if (!state.pending) dismiss()
      })
      window.webContents.once('render-process-gone', () =>
        this.dispose(state, { success: false, error: '确认弹窗异常关闭，请重试' })
      )
      window.webContents.setWindowOpenHandler(({ url }) => {
        if (this.active !== state || state.pending || !state.resolve) return { action: 'deny' }
        if (url === 'ncurator-confirm://cancel') dismiss()
        if (url === 'ncurator-confirm://confirm') {
          state.pending = true
          const respond = state.resolve
          state.resolve = null
          respond({ success: true, action: 'confirm' })
        }
        return { action: 'deny' }
      })
      window.webContents.on('will-navigate', (event) => event.preventDefault())
      const loadTimer = setTimeout(
        () => this.dispose(state, { success: false, error: '确认弹窗加载超时，请重试' }),
        3_000
      )
      window.once('ready-to-show', () => {
        clearTimeout(loadTimer)
        if (this.active !== state || window.isDestroyed() || owner.isMinimized()) return
        syncBounds()
        window.show()
        window.focus()
      })
      void window
        .loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(renderDialog(request))}`)
        .catch((error: Error) => this.dispose(state, { success: false, error: error.message }))
    })
  }

  public close(owner: BrowserWindow, dialogId: string): void {
    const state = this.active
    if (state && state.owner === owner && state.dialogId === dialogId) this.dispose(state)
  }

  private dispose(
    state: DialogState,
    response: ConfirmDialogResponse = { success: true, action: 'cancel' }
  ): void {
    if (this.active !== state) return
    this.active = null
    state.cleanup()
    const restoreFocus = !state.window.isDestroyed() && state.window.isFocused()
    if (!state.window.isDestroyed()) state.window.destroy()
    state.resolve?.(response)
    state.resolve = null
    if (restoreFocus && !state.owner.isDestroyed() && !state.owner.isMinimized())
      state.owner.focus()
  }
}
