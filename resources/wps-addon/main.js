;(function () {
  var DEFAULT_PORT = 58123
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

  function report(kind, data) {
    var server = window.__ncuratorServer
    if (!server) return
    try {
      var body = JSON.stringify({
        kind: kind,
        component: adapter ? adapter.kind : 'unknown',
        at: Date.now(),
        data: data === undefined ? null : data
      })
      if (typeof fetch === 'function') {
        fetch(server + '/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body
        }).catch(function () {})
        return
      }
      var xhr = new XMLHttpRequest()
      xhr.open('POST', server + '/report', true)
      xhr.setRequestHeader('Content-Type', 'application/json')
      xhr.send(body)
    } catch (error) {
      // 上报失败时静默，由重连补偿。
    }
  }

  function createAdapter(app) {
    if (!app) return null

    function tryCollection(name) {
      try {
        return app[name] || null
      } catch (error) {
        return null
      }
    }

    if (tryCollection('Presentations')) {
      return {
        kind: 'wpp',
        collection: function () {
          return app.Presentations
        },
        open: function (filePath) {
          return app.Presentations.Open(filePath)
        },
        close: function (item) {
          item.Saved = true
          item.Close()
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
            return String(
              app.ActivePresentation.Slides.Item(1).Shapes.Item(1).TextFrame.TextRange.Text || ''
            ).slice(0, 2000)
          } catch (error) {
            return ''
          }
        }
      }
    }

    if (tryCollection('Workbooks')) {
      return {
        kind: 'et',
        collection: function () {
          return app.Workbooks
        },
        open: function (filePath) {
          return app.Workbooks.Open(filePath)
        },
        close: function (item) {
          item.Close(false)
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
            return String(app.ActiveSheet.UsedRange.Text || '').slice(0, 2000)
          } catch (error) {
            try {
              return String(app.ActiveSheet.Cells.Item(1, 1).Text || '').slice(0, 2000)
            } catch (inner) {
              return ''
            }
          }
        }
      }
    }

    if (tryCollection('Documents')) {
      return {
        kind: 'wps',
        collection: function () {
          return app.Documents
        },
        open: function (filePath) {
          return app.Documents.Open(filePath)
        },
        close: function (item) {
          item.Close(false)
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
            return String(app.ActiveDocument.Content.Text || '').slice(0, 2000)
          } catch (error) {
            return ''
          }
        }
      }
    }

    return null
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

  function handlePayload(payload) {
    if (!payload || payload.type === 'ping') return
    if (payload.type === 'reload') {
      try {
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
    if (!adapter) adapter = createAdapter(getApp())
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

  function readPortFile(done) {
    try {
      var xhr = new XMLHttpRequest()
      xhr.open('GET', 'port.json?t=' + Date.now(), true)
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
      xhr.send()
    } catch (error) {
      done(DEFAULT_PORT)
    }
  }

  function resolveServer(done) {
    try {
      var loc = window.location
      if (loc && /^https?:$/i.test(loc.protocol)) {
        var host = loc.hostname
        var port = Number(loc.port || (loc.protocol === 'https:' ? 443 : 80))
        if ((host === '127.0.0.1' || host === 'localhost') && port > 0) {
          window.__ncuratorServer = 'http://127.0.0.1:' + port
          done()
          return
        }
      }
    } catch (error) {
      // 非 HTTP 加载时改读 port.json。
    }
    readPortFile(function (port) {
      window.__ncuratorServer = 'http://127.0.0.1:' + port
      done()
    })
  }

  var API_EVENTS = ['DocumentOpen', 'DocumentBeforeSave', 'DocumentAfterClose', 'DocumentChange']

  function registerApiEvents() {
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
    adapter = createAdapter(getApp())
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
  setTimeout(startSync, 0)
})()
