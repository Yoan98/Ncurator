;(function () {
  var DEFAULT_PORT = 58123
  // 摘录用于证明窗口已换成磁盘新稿，采样窗口太小会漏掉正文末尾或右侧的改动。
  var EXCERPT_MAX_CHARS = 20000
  var EXCERPT_MAX_ROWS = 200
  var EXCERPT_MAX_COLUMNS = 50
  var EXCERPT_MAX_SLIDES = 10
  var suppressEvents = false
  var eventSource = null
  var reconnectTimer = null
  var reconnectDelayMs = 1000
  var adapter = null

  function getApp() {
    if (typeof window.Application !== 'undefined' && window.Application) return window.Application
    if (typeof window.wps !== 'undefined' && window.wps && window.wps.Application) {
      return window.wps.Application
    }
    return null
  }

  function describeError(error) {
    if (!error) return 'unknown'
    return error.message ? String(error.message) : String(error)
  }

  function isDirty(saved) {
    return saved === false || saved === 0
  }

  function report(kind, data, sync) {
    var server = window.__ncuratorServer
    if (!server) return
    try {
      var body = JSON.stringify({
        kind: kind,
        component: adapter ? adapter.kind : 'unknown',
        at: Date.now(),
        data: data === undefined ? null : data
      })
      if (sync) {
        var xhr = new XMLHttpRequest()
        xhr.open('POST', server + '/report', false)
        xhr.setRequestHeader('Content-Type', 'application/json')
        xhr.send(body)
        return
      }
      if (typeof fetch === 'function') {
        fetch(server + '/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body
        }).catch(function () {})
        return
      }
      var asyncXhr = new XMLHttpRequest()
      asyncXhr.open('POST', server + '/report', true)
      asyncXhr.setRequestHeader('Content-Type', 'application/json')
      asyncXhr.send(body)
    } catch (error) {
      // 上报失败时静默，由重连补偿。
    }
  }

  function detectKind(app) {
    try {
      var search = String((window.location && window.location.search) || '')
      var hash = String((window.location && window.location.hash) || '')
      var fromLocation = /(?:[?&#]host=)(wps|et|wpp)\b/.exec(search + hash)
      if (fromLocation) return fromLocation[1]
    } catch (error) {
      // location 不可用时改读 Application.Name。
    }
    try {
      var name = String((app && (app.Name || app.Caption)) || '').toLowerCase()
      if (/spreadsheet|excel|\bet\b|表格|workbook/.test(name)) return 'et'
      if (/presentation|\bwpp\b|powerpoint|\bppt\b|演示/.test(name)) return 'wpp'
      if (/writer|\bword\b|文字/.test(name)) return 'wps'
    } catch (error) {
      // Name 读失败时宁可不刷新，也不去碰其他组件的 COM 对象。
    }
    return ''
  }

  function markSavedThenClose(item, withFalse) {
    try {
      item.Saved = true
    } catch (error) {
      // 部分组件不接受 Saved 赋值。
    }
    if (withFalse) {
      try {
        item.Close(false)
        return
      } catch (error) {
        // 回落到无参 Close。
      }
    }
    item.Close()
  }

  function createWppAdapter(app) {
    return {
      kind: 'wpp',
      collection: function () {
        return app.Presentations
      },
      open: function (filePath) {
        return app.Presentations.Open(filePath)
      },
      close: function (item) {
        markSavedThenClose(item, false)
      },
      captureView: function () {
        var view = {}
        try {
          view.slideIndex = app.ActiveWindow.View.Slide.SlideIndex
        } catch (error) {
          view.slideIndex = null
        }
        return view
      },
      restoreView: function (view) {
        if (view.slideIndex === null || view.slideIndex === undefined) return { slide: false }
        app.ActiveWindow.View.GotoSlide(view.slideIndex)
        return { slide: true }
      },
      excerpt: function () {
        try {
          var slides = app.ActivePresentation.Slides
          var parts = []
          var slideLimit = Math.min(slides.Count, EXCERPT_MAX_SLIDES)
          for (var slideIndex = 1; slideIndex <= slideLimit; slideIndex += 1) {
            var shapes = slides.Item(slideIndex).Shapes
            for (var shapeIndex = 1; shapeIndex <= shapes.Count; shapeIndex += 1) {
              try {
                var text = String(shapes.Item(shapeIndex).TextFrame.TextRange.Text || '').trim()
                if (text) parts.push(text)
              } catch (error) {
                // 非文本形状忽略。
              }
            }
          }
          return parts.join('\n').slice(0, EXCERPT_MAX_CHARS)
        } catch (error) {
          return ''
        }
      }
    }
  }

  function createEtAdapter(app) {
    return {
      kind: 'et',
      collection: function () {
        return app.Workbooks
      },
      open: function (filePath) {
        return app.Workbooks.Open(filePath)
      },
      close: function (item) {
        markSavedThenClose(item, true)
      },
      captureView: function () {
        var view = {}
        try {
          view.sheetName = app.ActiveSheet.Name
          view.scrollRow = app.ActiveWindow.ScrollRow
          view.scrollColumn = app.ActiveWindow.ScrollColumn
          view.selection = app.Selection ? app.Selection.Address : null
        } catch (error) {
          view.error = describeError(error)
        }
        return view
      },
      restoreView: function (view) {
        var restored = {}
        try {
          if (view.sheetName) {
            app.Worksheets.Item(view.sheetName).Activate()
            restored.sheet = true
          }
          if (view.scrollRow) app.ActiveWindow.ScrollRow = view.scrollRow
          if (view.scrollColumn) app.ActiveWindow.ScrollColumn = view.scrollColumn
          restored.scroll = true
          if (view.selection) {
            app.Range(view.selection).Select()
            restored.selection = true
          }
        } catch (error) {
          restored.error = describeError(error)
        }
        return restored
      },
      excerpt: function () {
        try {
          var range = app.ActiveSheet.UsedRange
          var parts = []
          var used = 0
          var rowCount = Math.min(range.Rows.Count, EXCERPT_MAX_ROWS)
          var columnCount = Math.min(range.Columns.Count, EXCERPT_MAX_COLUMNS)
          for (var row = 1; row <= rowCount; row += 1) {
            for (var column = 1; column <= columnCount; column += 1) {
              try {
                var text = String(range.Cells.Item(row, column).Text || '').trim()
                if (!text) continue
                if (used + text.length > EXCERPT_MAX_CHARS) {
                  parts.push('...')
                  row = rowCount
                  break
                }
                parts.push(text)
                used += text.length + 1
              } catch (error) {
                // 空单元格忽略。
              }
            }
          }
          if (parts.length) return parts.join('\n')
        } catch (error) {
          // 回落到 A1。
        }
        try {
          return String(app.ActiveSheet.Cells.Item(1, 1).Text || '').slice(0, EXCERPT_MAX_CHARS)
        } catch (inner) {
          return ''
        }
      }
    }
  }

  function createWpsAdapter(app) {
    return {
      kind: 'wps',
      collection: function () {
        return app.Documents
      },
      open: function (filePath) {
        return app.Documents.Open(filePath)
      },
      close: function (item) {
        markSavedThenClose(item, true)
      },
      captureView: function () {
        var view = {}
        try {
          view.selectionStart = app.Selection ? app.Selection.Start : null
        } catch (error) {
          view.selectionStart = null
        }
        try {
          view.verticalPercentScrolled = app.ActiveWindow.ActivePane.VerticalPercentScrolled
        } catch (error) {
          view.verticalPercentScrolled = null
        }
        return view
      },
      restoreView: function (view) {
        var restored = {}
        try {
          if (view.selectionStart !== null && view.selectionStart !== undefined && app.Selection) {
            app.Selection.SetRange(view.selectionStart, view.selectionStart)
            restored.selection = true
          }
        } catch (error) {
          restored.selectionError = describeError(error)
        }
        try {
          if (view.verticalPercentScrolled !== null && view.verticalPercentScrolled !== undefined) {
            app.ActiveWindow.ActivePane.VerticalPercentScrolled = view.verticalPercentScrolled
            restored.scroll = true
          }
        } catch (error) {
          restored.scrollError = describeError(error)
        }
        return restored
      },
      excerpt: function () {
        try {
          return String(app.ActiveDocument.Content.Text || '').slice(0, EXCERPT_MAX_CHARS)
        } catch (error) {
          return ''
        }
      }
    }
  }

  function tryCollection(app, name) {
    try {
      return app[name] != null
    } catch (error) {
      return false
    }
  }

  function createAdapter(app) {
    if (!app) return null
    var kind = detectKind(app)
    if (!kind) {
      if (tryCollection(app, 'Workbooks')) kind = 'et'
      else if (tryCollection(app, 'Presentations')) kind = 'wpp'
      else if (tryCollection(app, 'Documents')) kind = 'wps'
    }
    if (kind === 'et') return createEtAdapter(app)
    if (kind === 'wpp') return createWppAdapter(app)
    if (kind === 'wps') return createWpsAdapter(app)
    return null
  }

  function bindAdapter() {
    var next = createAdapter(getApp())
    if (next) adapter = next
    return adapter
  }

  function listItems() {
    if (!adapter) return { error: 'no adapter', items: [] }
    try {
      var collection = adapter.collection()
      var count = collection.Count
      var items = []
      for (var index = 1; index <= count; index += 1) {
        var item = collection.Item(index)
        items.push({ name: item.Name, fullName: item.FullName, saved: item.Saved })
      }
      return { count: count, items: items }
    } catch (error) {
      return { error: describeError(error), items: [] }
    }
  }

  function normalizePath(value) {
    return String(value || '')
      .replace(/\\/g, '/')
      .toLowerCase()
  }

  function extensionOf(filePath) {
    var value = String(filePath || '')
    var slash = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'))
    var base = slash >= 0 ? value.slice(slash + 1) : value
    var dot = base.lastIndexOf('.')
    return dot >= 0 ? base.slice(dot).toLowerCase() : ''
  }

  function isOwnPath(filePath) {
    if (!adapter) return false
    var ext = extensionOf(filePath)
    if (adapter.kind === 'et') return ext === '.xlsx'
    if (adapter.kind === 'wpp') return ext === '.pptx'
    if (adapter.kind === 'wps') return ext === '.docx'
    return false
  }

  function findItem(targetPath) {
    var collection = adapter.collection()
    var count = collection.Count
    var normalized = normalizePath(targetPath)
    for (var index = 1; index <= count; index += 1) {
      var item = collection.Item(index)
      if (normalizePath(item.FullName) === normalized) return item
    }
    return null
  }

  function reload(targetPath) {
    if (!adapter) return { ok: false, reason: 'no adapter' }
    var startedAt = Date.now()
    try {
      var item = targetPath ? findItem(targetPath) : null
      if (!item) return { ok: false, reason: 'not open here', targetPath: targetPath }
      var fullName = item.FullName
      if (!fullName) return { ok: false, reason: 'never saved, no path' }
      var wasDirty = isDirty(item.Saved)
      var view = adapter.captureView()
      suppressEvents = true
      adapter.close(item)
      adapter.open(fullName)
      var restored = adapter.restoreView(view)
      var excerpt = adapter.excerpt ? adapter.excerpt() : ''
      suppressEvents = false
      return {
        ok: true,
        fullName: fullName,
        wasDirty: wasDirty,
        elapsedMs: Date.now() - startedAt,
        view: view,
        restored: restored,
        excerpt: excerpt
      }
    } catch (error) {
      suppressEvents = false
      return { ok: false, reason: describeError(error), elapsedMs: Date.now() - startedAt }
    }
  }

  var pendingViews = {}

  function closeForWrite(targetPath) {
    if (!adapter) return { ok: false, reason: 'no adapter', targetPath: targetPath }
    try {
      var item = targetPath ? findItem(targetPath) : null
      if (!item) return { ok: false, reason: 'not open here', targetPath: targetPath }
      var fullName = item.FullName
      if (!fullName) return { ok: false, reason: 'never saved, no path', targetPath: targetPath }
      var view = adapter.captureView()
      pendingViews[normalizePath(fullName)] = view
      if (targetPath) pendingViews[normalizePath(targetPath)] = view
      var remaining = 0
      try {
        remaining = Math.max(0, adapter.collection().Count - 1)
      } catch (error) {
        remaining = 0
      }
      return { ok: true, fullName: fullName, view: view, remaining: remaining, item: item }
    } catch (error) {
      return { ok: false, reason: describeError(error), targetPath: targetPath }
    }
  }

  function openAfterWrite(targetPath) {
    if (!adapter) return { ok: false, reason: 'no adapter', targetPath: targetPath }
    var startedAt = Date.now()
    try {
      var existing = targetPath ? findItem(targetPath) : null
      if (existing) {
        return {
          ok: true,
          fullName: existing.FullName,
          excerpt: adapter.excerpt ? adapter.excerpt() : '',
          alreadyOpen: true,
          elapsedMs: Date.now() - startedAt
        }
      }
      if (!targetPath) return { ok: false, reason: 'never saved, no path' }
      if (!isOwnPath(targetPath)) return { ok: false, reason: 'not open here', targetPath: targetPath }
      var viewKey = normalizePath(targetPath)
      if (!Object.prototype.hasOwnProperty.call(pendingViews, viewKey)) {
        return { ok: false, reason: 'not open here', targetPath: targetPath }
      }
      var view = pendingViews[viewKey]
      delete pendingViews[viewKey]
      suppressEvents = true
      adapter.open(targetPath)
      var restored = view ? adapter.restoreView(view) : {}
      var excerpt = adapter.excerpt ? adapter.excerpt() : ''
      suppressEvents = false
      return {
        ok: true,
        fullName: targetPath,
        excerpt: excerpt,
        restored: restored,
        view: view,
        elapsedMs: Date.now() - startedAt
      }
    } catch (error) {
      suppressEvents = false
      return {
        ok: false,
        reason: describeError(error),
        targetPath: targetPath,
        elapsedMs: Date.now() - startedAt
      }
    }
  }

  function handlePayload(payload) {
    if (!payload || payload.type === 'ping') return
    if (payload.type === 'close') {
      try {
        bindAdapter()
        var closed = closeForWrite(payload.path)
        var item = closed.item
        delete closed.item
        report('close-result', closed, closed.ok)
        if (item) {
          suppressEvents = true
          try {
            adapter.close(item)
          } finally {
            suppressEvents = false
          }
        }
      } catch (error) {
        report('close-result', {
          ok: false,
          reason: describeError(error),
          targetPath: payload.path
        })
      }
      return
    }
    if (payload.type === 'excerpt') {
      try {
        bindAdapter()
        var existing = payload.path ? findItem(payload.path) : null
        if (!existing) {
          report('reload-result', {
            ok: false,
            reason: adapter ? 'not open here' : 'no adapter',
            targetPath: payload.path
          })
          return
        }
        report('reload-result', {
          ok: true,
          fullName: existing.FullName,
          excerpt: adapter.excerpt ? adapter.excerpt() : '',
          alreadyOpen: true,
          items: listItems().items
        })
      } catch (error) {
        report('reload-result', {
          ok: false,
          reason: describeError(error),
          targetPath: payload.path
        })
      }
      return
    }
    if (payload.type === 'open') {
      try {
        bindAdapter()
        var opened = openAfterWrite(payload.path)
        if (opened.ok) opened.items = listItems().items
        report('reload-result', opened)
      } catch (error) {
        report('reload-result', {
          ok: false,
          reason: describeError(error),
          targetPath: payload.path
        })
      }
      return
    }
    if (payload.type === 'reload') {
      try {
        bindAdapter()
        if (!adapter || !findItem(payload.path)) {
          report('reload-result', {
            ok: false,
            reason: adapter ? 'not open here' : 'no adapter',
            targetPath: payload.path
          })
          return
        }
        report('reload-result', reload(payload.path))
      } catch (error) {
        report('reload-result', {
          ok: false,
          reason: describeError(error),
          targetPath: payload.path
        })
      }
      return
    }
    if (payload.type === 'list') report('items', { items: listItems().items })
  }

  function connectEvents() {
    bindAdapter()
    var server = window.__ncuratorServer
    if (!server || typeof EventSource !== 'function') {
      scheduleReconnect()
      return
    }
    try {
      if (eventSource) {
        eventSource.close()
        eventSource = null
      }
      var source = new EventSource(server + '/events?component=' + (adapter ? adapter.kind : 'none'))
      eventSource = source
      source.onopen = function () {
        reconnectDelayMs = 1000
        report('sse-open')
        report('items', { items: listItems().items })
      }
      source.onerror = function () {
        source.close()
        if (eventSource === source) eventSource = null
        scheduleReconnect()
      }
      source.onmessage = function (event) {
        try {
          handlePayload(JSON.parse(event.data))
        } catch (error) {
          report('sse-bad-payload', { raw: String(event.data) })
        }
      }
    } catch (error) {
      scheduleReconnect()
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) return
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null
      reconnectDelayMs = Math.min(reconnectDelayMs * 2, 15000)
      resolveServer(function () {
        connectEvents()
      })
    }, reconnectDelayMs)
  }

  function uniquePorts(ports) {
    var out = []
    for (var index = 0; index < ports.length; index += 1) {
      var port = Number(ports[index])
      if (port > 0 && out.indexOf(port) === -1) out.push(port)
    }
    return out
  }

  function probePort(port, done) {
    try {
      var xhr = new XMLHttpRequest()
      xhr.open('GET', 'http://127.0.0.1:' + port + '/status', true)
      xhr.timeout = 800
      xhr.onload = function () {
        done(xhr.status >= 200 && xhr.status < 300)
      }
      xhr.onerror = function () {
        done(false)
      }
      xhr.ontimeout = function () {
        done(false)
      }
      xhr.send()
    } catch (error) {
      done(false)
    }
  }

  function readPortFile(done) {
    try {
      var xhr = new XMLHttpRequest()
      xhr.open('GET', 'port.json?t=' + Date.now(), true)
      xhr.timeout = 800
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            var parsed = JSON.parse(xhr.responseText)
            if (parsed && parsed.port) {
              done(Number(parsed.port))
              return
            }
          } catch (error) {
            // 回落到默认端口。
          }
        }
        done(DEFAULT_PORT)
      }
      xhr.onerror = function () {
        done(DEFAULT_PORT)
      }
      xhr.ontimeout = function () {
        done(DEFAULT_PORT)
      }
      xhr.send()
    } catch (error) {
      done(DEFAULT_PORT)
    }
  }

  function locationPort() {
    try {
      var loc = window.location
      if (!loc || !/^https?:$/i.test(loc.protocol)) return 0
      var host = loc.hostname
      var port = Number(loc.port || (loc.protocol === 'https:' ? 443 : 80))
      if ((host === '127.0.0.1' || host === 'localhost') && port > 0) return port
    } catch (error) {
      // 非 HTTP 加载时改读 port.json。
    }
    return 0
  }

  function resolveServer(done) {
    readPortFile(function (filePort) {
      var candidates = uniquePorts([locationPort(), DEFAULT_PORT, filePort])
      if (candidates.length === 0) {
        window.__ncuratorServer = 'http://127.0.0.1:' + DEFAULT_PORT
        done()
        return
      }
      var tryAt = function (index) {
        if (index >= candidates.length) {
          window.__ncuratorServer = 'http://127.0.0.1:' + candidates[0]
          done()
          return
        }
        probePort(candidates[index], function (ok) {
          if (ok) {
            window.__ncuratorServer = 'http://127.0.0.1:' + candidates[index]
            done()
            return
          }
          tryAt(index + 1)
        })
      }
      tryAt(0)
    })
  }

  var API_EVENTS = ['DocumentOpen', 'DocumentBeforeSave', 'DocumentAfterClose', 'DocumentChange']

  function registerApiEvents() {
    if (!adapter || adapter.kind !== 'wps') return
    var app = getApp()
    if (!app || !app.ApiEvent) return
    for (var index = 0; index < API_EVENTS.length; index += 1) {
      try {
        app.ApiEvent.AddApiEventListener(API_EVENTS[index], 'ribbon.OnApiEvent_' + API_EVENTS[index])
      } catch (error) {
        report('apievent-register-failed', {
          name: API_EVENTS[index],
          error: describeError(error)
        })
      }
    }
  }

  function makeApiEventHandler(name) {
    return function () {
      if (suppressEvents) return
      report('apievent', { name: name, items: listItems().items })
    }
  }

  var started = false
  function startSync() {
    if (started) return
    started = true
    bindAdapter()
    registerApiEvents()
    resolveServer(function () {
      report('addin-load', { items: listItems().items })
      connectEvents()
    })
  }

  var ribbon = {
    OnAddinLoad: function () {
      startSync()
      return true
    },
    OnStatus: function () {
      startSync()
      return true
    }
  }

  for (var index = 0; index < API_EVENTS.length; index += 1) {
    ribbon['OnApiEvent_' + API_EVENTS[index]] = makeApiEventHandler(API_EVENTS[index])
  }

  window.ribbon = ribbon
  window.OnAddinLoad = ribbon.OnAddinLoad
  window.OnStatus = ribbon.OnStatus
  setTimeout(function () {
    if (!started) startSync()
  }, 1500)
})()
