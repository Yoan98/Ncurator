;(function () {
  var DEFAULT_PORT = 18723
  // 摘录用于证明窗口已换成磁盘新稿，采样窗口太小会漏掉正文末尾或右侧的改动。
  var EXCERPT_MAX_CHARS = 20000
  var EXCERPT_MAX_ROWS = 200
  var EXCERPT_MAX_COLUMNS = 50
  var EXCERPT_MAX_SLIDES = 10
  var EXCERPT_MAX_PARAGRAPHS = 2000
  var suppressEvents = false
  var eventSource = null
  var reconnectTimer = null
  var reconnectDelayMs = 1000
  var adapter = null
  // 同一组件可能同时活着多个实例（上一轮没退干净、或用户自己开了第二个窗口），
  // 只有页面级唯一 id 才能让馆长把 close / open 投给真正持有该文档的那个实例。
  var clientId = 'c' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
  // 组件关掉最后一个文档就会退出进程，close 前用它撑住，open 回来后再关掉。
  var placeholderItem = null

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

  function report(kind, data, sync) {
    var server = window.__ncuratorServer
    if (!server) return
    try {
      var body = JSON.stringify({
        kind: kind,
        component: adapter ? adapter.kind : 'unknown',
        clientId: clientId,
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
        }).catch(function () {
          return undefined
        })
        return
      }
      var asyncXhr = new XMLHttpRequest()
      asyncXhr.open('POST', server + '/report', true)
      asyncXhr.setRequestHeader('Content-Type', 'application/json')
      asyncXhr.send(body)
    } catch {
      // 上报失败时静默，由重连补偿。
    }
  }

  function detectKind(app) {
    try {
      var search = String((window.location && window.location.search) || '')
      var hash = String((window.location && window.location.hash) || '')
      var fromLocation = /(?:[?&#]host=)(wps|et|wpp)\b/.exec(search + hash)
      if (fromLocation) return fromLocation[1]
    } catch {
      // location 不可用时改读 Application.Name。
    }
    try {
      var name = String((app && (app.Name || app.Caption)) || '').toLowerCase()
      if (/spreadsheet|excel|\bet\b|表格|workbook/.test(name)) return 'et'
      if (/presentation|\bwpp\b|powerpoint|\bppt\b|演示/.test(name)) return 'wpp'
      if (/writer|\bword\b|文字/.test(name)) return 'wps'
    } catch {
      // Name 读失败时宁可不刷新，也不去碰其他组件的 COM 对象。
    }
    return ''
  }

  function markSavedThenClose(item, withFalse) {
    try {
      item.Saved = true
    } catch {
      // 部分组件不接受 Saved 赋值。
    }
    if (withFalse) {
      try {
        item.Close(false)
        return
      } catch {
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
        } catch {
          view.slideIndex = null
        }
        return view
      },
      restoreView: function (view) {
        if (view.slideIndex === null || view.slideIndex === undefined) return { slide: false }
        app.ActiveWindow.View.GotoSlide(view.slideIndex)
        return { slide: true }
      },
      excerpt: function (document) {
        try {
          var slides = (document || app.ActivePresentation).Slides
          var parts = []
          var slideLimit = Math.min(slides.Count, EXCERPT_MAX_SLIDES)
          for (var slideIndex = 1; slideIndex <= slideLimit; slideIndex += 1) {
            var shapes = slides.Item(slideIndex).Shapes
            for (var shapeIndex = 1; shapeIndex <= shapes.Count; shapeIndex += 1) {
              try {
                var text = String(shapes.Item(shapeIndex).TextFrame.TextRange.Text || '').trim()
                if (text) parts.push(text)
              } catch {
                // 非文本形状忽略。
              }
            }
          }
          return parts.join('\n').slice(0, EXCERPT_MAX_CHARS)
        } catch {
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
      excerpt: function (document) {
        var sheet = document ? document.ActiveSheet : app.ActiveSheet
        try {
          var range = sheet.UsedRange
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
              } catch {
                // 空单元格忽略。
              }
            }
          }
          if (parts.length) return parts.join('\n')
        } catch {
          // 回落到 A1。
        }
        try {
          return String(sheet.Cells.Item(1, 1).Text || '').slice(0, EXCERPT_MAX_CHARS)
        } catch {
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
        } catch {
          view.selectionStart = null
        }
        try {
          view.verticalPercentScrolled = app.ActiveWindow.ActivePane.VerticalPercentScrolled
        } catch {
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
      excerpt: function (document) {
        try {
          var content = (document || app.ActiveDocument).Content
          try {
            var text = String(content.Text || '')
            if (text) return text.slice(0, EXCERPT_MAX_CHARS)
          } catch {
            /* Some Writer builds expose text through paragraph ranges only. */
          }
          var paragraphs = content.Paragraphs,
            count = Math.min(paragraphs.Count, EXCERPT_MAX_PARAGRAPHS),
            parts = [],
            length = 0
          for (var i = 1; i <= count && length < EXCERPT_MAX_CHARS; i += 1) {
            var value = String(paragraphs.Item(i).Range.Text || '')
            parts.push(value)
            length += value.length
          }
          return parts.join('').slice(0, EXCERPT_MAX_CHARS)
        } catch {
          return ''
        }
      }
    }
  }

  function tryCollection(app, name) {
    try {
      return app[name] != null
    } catch {
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

  function addPlaceholder() {
    try {
      return adapter.collection().Add()
    } catch {
      return null
    }
  }

  function closePlaceholder() {
    if (!placeholderItem) return
    var item = placeholderItem
    placeholderItem = null
    try {
      markSavedThenClose(item, true)
    } catch {
      // 占位文档关不掉只是多一个空窗口，不影响正文已经换成新稿。
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
      } catch {
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
      if (!targetPath) return { ok: false, reason: 'never saved, no path' }
      if (!isOwnPath(targetPath))
        return { ok: false, reason: 'not open here', targetPath: targetPath }
      var viewKey = normalizePath(targetPath)
      var closedHere = Object.prototype.hasOwnProperty.call(pendingViews, viewKey)
      var view = closedHere ? pendingViews[viewKey] : null
      delete pendingViews[viewKey]
      suppressEvents = true
      var existing = findItem(targetPath)
      if (existing) {
        // 还开着说明上一步的 close 没落地，此刻内存里是写盘前的旧稿，必须真关掉再重开。
        if (!view) view = adapter.captureView()
        adapter.close(existing)
        if (findItem(targetPath)) {
          suppressEvents = false
          return {
            ok: false,
            reason: 'still open after close',
            targetPath: targetPath,
            elapsedMs: Date.now() - startedAt
          }
        }
      } else if (!closedHere) {
        // 本实例既没 close 过、当前也没开着，不能抢开别人的文档。
        suppressEvents = false
        return {
          ok: false,
          reason: 'not open here',
          targetPath: targetPath,
          elapsedMs: Date.now() - startedAt
        }
      }
      var reopened = adapter.open(targetPath)
      closePlaceholder()
      if (!reopened || !reopened.FullName) reopened = findItem(targetPath)
      if (!reopened || normalizePath(reopened.FullName) !== viewKey)
        throw new Error('WPS 未确认重新打开的目标文档')
      try {
        reopened.Activate()
      } catch {
        try {
          reopened.Windows.Item(1).Activate()
        } catch {
          /* The document may already be active. */
        }
      }
      var restored = view ? adapter.restoreView(view) : {}
      var excerpt = adapter.excerpt ? adapter.excerpt(reopened) : ''
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

  function normalizedText(value) {
    return (
      String(value == null ? '' : value)
        // WPS paragraph/cell text includes end-of-cell and layout control characters.
        // eslint-disable-next-line no-control-regex
        .replace(/[\r\n\t\u0007\u000b\u000c]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    )
  }

  function navigateDocx(item, target, app) {
    var ranges = []
    if (target.part === 'word/document.xml') ranges.push(item.Content)
    else {
      var types = /header/.test(target.part)
        ? [6, 7, 10]
        : /footer/.test(target.part)
          ? [8, 9, 11]
          : /footnote/.test(target.part)
            ? [2]
            : /endnote/.test(target.part)
              ? [3]
              : [5]
      for (var t = 0; t < types.length; t += 1) {
        try {
          var story = item.StoryRanges.Item(types[t]),
            seen = 0
          while (story && seen++ < 64) {
            ranges.push(story)
            story = story.NextStoryRange
          }
        } catch {
          /* This document does not have this story. */
        }
      }
    }
    var matches = [],
      deadline = Date.now() + 1200,
      exhausted = false
    var original = normalizedText(target.text),
      quoteText = normalizedText(target.quote)
    var quoteAt = quoteText ? original.indexOf(quoteText) : -1
    var left = quoteAt >= 0 ? original.slice(Math.max(0, quoteAt - 48), quoteAt) : ''
    var right =
      quoteAt >= 0
        ? original.slice(quoteAt + quoteText.length, quoteAt + quoteText.length + 48)
        : ''
    function consider(paragraph, previous, next) {
      var text = normalizedText(paragraph.Text)
      var retained = Boolean(original && text.indexOf(original) >= 0)
      var quoteRetained = Boolean(
        quoteText &&
        text.indexOf(quoteText) >= 0 &&
        ((left.length >= 8 && text.indexOf(left + quoteText) >= 0) ||
          (right.length >= 8 && text.indexOf(quoteText + right) >= 0))
      )
      var neighbors =
        Number(Boolean(target.previous && previous === normalizedText(target.previous))) +
        Number(Boolean(target.next && next === normalizedText(target.next)))
      var framed =
        neighbors === 2 &&
        Boolean(
          left.length >= 8 &&
          right.length >= 8 &&
          text.indexOf(left) >= 0 &&
          text.indexOf(right) > text.indexOf(left)
        )
      // An image-only paragraph has no searchable text; both real neighboring
      // paragraphs must establish its container before selecting it.
      var emptyContainer = !original && !text && neighbors === 2
      if (!retained && !quoteRetained && !framed && !emptyContainer) return
      var key = String(paragraph.Start) + ':' + String(paragraph.End)
      if (
        matches.some(function (m) {
          return m.key === key && m.story === r
        })
      )
        return
      matches.push({
        range: paragraph,
        key: key,
        story: r,
        context: neighbors
      })
    }
    for (var r = 0; r < ranges.length; r += 1) {
      var paragraphs = ranges[r].Paragraphs,
        count = paragraphs.Count
      if (!count) throw new Error('文档尚未加载完成')
      var center = Math.min(count, target.paragraph),
        indices = [center]
      for (var distance = 1; distance <= 32; distance += 1) {
        if (center - distance >= 1) indices.push(center - distance)
        if (center + distance <= count) indices.push(center + distance)
      }
      for (var n = 0; n < indices.length; n += 1) {
        if (Date.now() > deadline) {
          exhausted = true
          break
        }
        var i = indices[n]
        consider(
          paragraphs.Item(i).Range,
          i > 1 ? normalizedText(paragraphs.Item(i - 1).Range.Text) : '',
          i < count ? normalizedText(paragraphs.Item(i + 1).Range.Text) : ''
        )
      }
      // Native range search handles large moves without enumerating the whole document
      // through the host API. It never changes Selection or document bytes.
      var queries = [original.slice(0, 200)]
      if (left.length >= 8) queries.push(left.slice(-200))
      if (right.length >= 8) queries.push(right.slice(0, 200))
      var hits = 0
      try {
        for (var q = 0; q < queries.length; q += 1) {
          if (!queries[q]) continue
          var search = ranges[r].Duplicate,
            end = search.End
          while (search.Start < end) {
            if (Date.now() > deadline || hits++ >= 64) {
              exhausted = true
              break
            }
            var find = search.Find
            find.ClearFormatting()
            find.Execute(queries[q], true, false, false, false, false, true, 0, false)
            if (!find.Found) break
            consider(search.Paragraphs.Item(1).Range, '', '')
            var from = search.End
            if (from <= search.Start) break
            search.SetRange(from, end)
          }
        }
      } catch {
        // Without native search, accept only locally verified context, or a
        // unique retained paragraph when the complete story was examined.
        if (indices.length < count) {
          matches = matches.filter(function (m) {
            return m.story !== r || m.context > 0
          })
        }
      }
    }
    if (exhausted) throw new Error('定位查找超时，无法确认唯一位置，请在 WPS 中查找原文')
    if (matches.length > 1) {
      var contextual = matches.filter(function (m) {
        return m.context > 0
      })
      if (contextual.length === 1) matches = contextual
    }
    if (matches.length !== 1)
      throw new Error(
        matches.length
          ? '存在多处相同内容，无法唯一定位修改位置'
          : '当前文档内容已变化，无法确认原修改位置'
      )
    var range = matches[0].range.Duplicate
    var quote = target.quote || '',
      raw = String(range.Text || ''),
      offset = quote ? raw.indexOf(quote) : -1
    var exact = !target.container && offset >= 0 && raw.indexOf(quote, offset + 1) < 0
    if (exact) {
      range.SetRange(range.Start + offset, range.Start + offset + quote.length)
      if (normalizedText(range.Text) !== normalizedText(quote)) {
        exact = false
        range = matches[0].range.Duplicate
      }
    }
    range.Select()
    try {
      app.ActiveWindow.ScrollIntoView(range, true)
    } catch {
      /* Selection also reveals its range. */
    }
    var selected = app.Selection
    if (selected.Start !== range.Start || selected.End !== range.End)
      throw new Error('WPS 未确认目标文字选区')
    return {
      selection: { kind: 'docx', start: selected.Start, end: selected.End },
      status: exact ? 'located' : 'container',
      reason: exact ? undefined : '已定位到相关段落，原修改内容可能已有后续变化'
    }
  }

  function navigatePpt(item, target, app) {
    var deadline = Date.now() + 1200
    var slides = item.Slides,
      slide = null
    try {
      slide = slides.FindBySlideID(target.slideId)
    } catch {
      /* Some macOS WPS versions expose the method without implementing it. */
    }
    if (!slide || Number(slide.SlideID) !== target.slideId) {
      slide = null
      for (var index = 1; index <= slides.Count; index += 1) {
        if (Date.now() > deadline) throw new Error('幻灯片查找超时，无法确认原修改位置')
        var candidateSlide = slides.Item(index)
        if (Number(candidateSlide.SlideID) === target.slideId) {
          slide = candidateSlide
          break
        }
      }
    }
    if (!slide) throw new Error('当前文件中对应幻灯片已不存在')
    var shape = null
    if (target.shapeId) {
      for (var i = 1; i <= slide.Shapes.Count; i += 1) {
        if (Date.now() > deadline) throw new Error('幻灯片元素查找超时，无法确认原修改位置')
        var candidate = slide.Shapes.Item(i)
        if (Number(candidate.Id) === target.shapeId) {
          shape = candidate
          break
        }
      }
      // SlideID and ShapeId establish identity even when text was edited later.
    }
    app.ActiveWindow.View.GotoSlide(slide.SlideIndex)
    if (Number(app.ActiveWindow.View.Slide.SlideID) !== target.slideId)
      throw new Error('WPS 未确认目标幻灯片')
    if (shape) {
      shape.Select()
      var chosen = app.ActiveWindow.Selection.ShapeRange.Item(1)
      if (Number(chosen.Id) !== target.shapeId) throw new Error('WPS 未确认目标元素')
      return {
        status: 'located',
        selection: { kind: 'ppt', slideId: target.slideId, shapeId: Number(chosen.Id) }
      }
    }
    return {
      selection: { kind: 'ppt', slideId: Number(app.ActiveWindow.View.Slide.SlideID) },
      status: 'container',
      reason: target.shapeId ? '目标元素已变化，已定位到对应幻灯片' : '已定位到对应幻灯片'
    }
  }

  function navigateExcel(item, target, app) {
    var sheet = item.Worksheets.Item(target.sheet)
    if (!sheet) throw new Error('当前文件中对应工作表已不存在')
    var deadline = Date.now() + 1200
    function cellMatches(cell, expected) {
      var values = []
      try {
        if (cell.Formula) values.push(cell.Formula)
      } catch {
        /* error value */
      }
      try {
        values.push(cell.Value2)
      } catch {
        /* use display value */
      }
      try {
        values.push(cell.Text)
      } catch {
        /* raw value is sufficient */
      }
      return values.some(function (value) {
        return (
          normalizedText(value).replace(/^=/, '') === normalizedText(expected).replace(/^=/, '')
        )
      })
    }
    var anchors = target.anchors || [],
      candidates = [],
      complete = true
    var requiresContext =
      anchors.some(function (a) {
        return a.row === 0 && a.column !== 0
      }) &&
      anchors.some(function (a) {
        return a.column === 0 && a.row !== 0
      })
    function consider(cell) {
      var row = Number(cell.Row),
        column = Number(cell.Column)
      if (!row || !column) return
      var matching = anchors.filter(function (anchor) {
        if (row + anchor.row < 1 || column + anchor.column < 1) return false
        return cellMatches(sheet.Cells.Item(row + anchor.row, column + anchor.column), anchor.value)
      })
      var valueMatches = cellMatches(cell, target.value)
      // Two independent axes prevent repeated numbers in a table from appearing
      // to prove identity. A changed value may still identify its row/column.
      var rowAnchor = matching.some(function (a) {
        return a.row === 0 && a.column !== 0
      })
      var columnAnchor = matching.some(function (a) {
        return a.column === 0 && a.row !== 0
      })
      if (!(valueMatches || (rowAnchor && columnAnchor))) return
      if (requiresContext && !(rowAnchor && columnAnchor)) return
      var key = row + ':' + column
      if (
        !candidates.some(function (c) {
          return c.key === key
        })
      )
        candidates.push({
          cell: cell,
          key: key,
          changed: !valueMatches,
          anchored: rowAnchor && columnAnchor
        })
    }
    // Search exact values with explicit options; never rely on WPS's last Find settings.
    var seed = String(target.value || '') ? { row: 0, column: 0, value: target.value } : anchors[0]
    if (seed && String(seed.value)) {
      var used = sheet.UsedRange,
        found = null,
        firstAddress = '',
        hits = 0
      var what = String(seed.value).replace(/[~*?]/g, '~$&')
      try {
        while (true) {
          if (Date.now() > deadline || hits++ >= 64) {
            complete = false
            break
          }
          found = used.Find(what, found || undefined, -4123, 1, 1, 1, true, false, false)
          if (!found) break
          var address = String(found.Address(false, false))
          if (address === firstAddress) break
          if (!firstAddress) firstAddress = address
          var row = Number(found.Row) - seed.row,
            column = Number(found.Column) - seed.column
          if (row > 0 && column > 0) consider(sheet.Cells.Item(row, column))
        }
      } catch {
        complete = false
      }
    } else complete = false
    // If the target value itself changed, search one retained contextual anchor.
    if (complete && !candidates.length && anchors.length) {
      seed = anchors[0]
      try {
        var anchorHit = sheet.UsedRange.Find(
          String(seed.value).replace(/[~*?]/g, '~$&'),
          undefined,
          -4123,
          1,
          1,
          1,
          true,
          false,
          false
        )
        var startAddress = anchorHit && String(anchorHit.Address(false, false)),
          attempts = 0
        while (anchorHit) {
          if (Date.now() > deadline || attempts++ >= 64) {
            complete = false
            break
          }
          var rr = Number(anchorHit.Row) - seed.row,
            cc = Number(anchorHit.Column) - seed.column
          if (rr > 0 && cc > 0) consider(sheet.Cells.Item(rr, cc))
          anchorHit = sheet.UsedRange.Find(
            String(seed.value).replace(/[~*?]/g, '~$&'),
            anchorHit,
            -4123,
            1,
            1,
            1,
            true,
            false,
            false
          )
          if (anchorHit && String(anchorHit.Address(false, false)) === startAddress) break
        }
      } catch {
        complete = false
      }
    }
    if (candidates.length > 1) {
      var anchored = candidates.filter(function (c) {
        return c.anchored
      })
      if (anchored.length === 1) candidates = anchored
    }
    if (!complete || candidates.length !== 1)
      throw new Error(
        !complete
          ? '单元格查找未完成，无法确认唯一位置'
          : candidates.length
            ? '存在多处相同数据，无法唯一确认原单元格位置'
            : '单元格内容或表格结构已变化，无法确认原修改位置'
      )
    var candidate = candidates[0],
      range = candidate.cell
    // A merged area's dimensions may have changed. Resolve its current container,
    // rather than extending stale coordinates into unrelated cells.
    if (target.address.indexOf(':') >= 0) {
      try {
        range = candidate.cell.MergeArea
      } catch {
        throw new Error('无法确认当前合并区域')
      }
    }
    sheet.Activate()
    range.Select()
    try {
      app.Goto(range, true)
    } catch {
      try {
        app.ActiveWindow.ScrollRow = range.Row
        app.ActiveWindow.ScrollColumn = range.Column
      } catch {
        /* Frozen panes may limit scrolling. */
      }
    }
    if (String(app.ActiveSheet.Name) !== target.sheet) throw new Error('WPS 未确认目标工作表')
    var selectedAddress = String(app.Selection.Address(false, false))
    if (
      selectedAddress.replace(/\$/g, '').toUpperCase() !==
      String(range.Address(false, false)).replace(/\$/g, '').toUpperCase()
    )
      throw new Error('WPS 未确认目标单元格选区')
    return {
      selection: { kind: 'excel', sheet: String(app.ActiveSheet.Name), address: selectedAddress },
      status: target.container || candidate.changed ? 'container' : 'located',
      reason: candidate.changed
        ? '已定位到相关单元格，内容已有后续修改'
        : target.container
          ? '已定位到删除位置附近的有效单元格'
          : undefined
    }
  }

  function navigateForReview(payload) {
    var result = {
      requestId: payload.requestId,
      fullName: payload.path,
      status: 'opened',
      location: payload.target
    }
    try {
      bindAdapter()
      if (!adapter || !isOwnPath(payload.path)) throw new Error('WPS 组件不匹配')
      var item = findItem(payload.path)
      if (!item) throw new Error('目标文件未在此 WPS 实例中打开')
      var activeApp = getApp()
      try {
        activeApp.Activate()
      } catch {
        /* Some WPS hosts activate via their document window. */
      }
      try {
        activeApp.ActiveWindow.Activate()
      } catch {
        /* Document.Activate is used below. */
      }
      try {
        item.Activate()
      } catch {
        try {
          item.Windows.Item(1).Activate()
        } catch {
          /* Component activation differs. */
        }
      }
      var app = getApp()
      var activeItem =
        adapter.kind === 'wps'
          ? app.ActiveDocument
          : adapter.kind === 'wpp'
            ? app.ActivePresentation
            : app.ActiveWorkbook
      if (!activeItem || normalizePath(activeItem.FullName) !== normalizePath(payload.path))
        throw new Error('WPS 未激活目标文件，未完成定位')
      result.fullName = activeItem.FullName
      if (!payload.target) {
        result.reason = '该修改在当前文件中没有可定位的位置'
        return result
      }
      var target = payload.target,
        located
      if (target.kind === 'docx' && adapter.kind === 'wps')
        located = navigateDocx(item, target, app)
      else if (target.kind === 'ppt' && adapter.kind === 'wpp')
        located = navigatePpt(item, target, app)
      else if (target.kind === 'excel' && adapter.kind === 'et')
        located = navigateExcel(item, target, app)
      else throw new Error('修改区域与 WPS 组件不匹配')
      result.status = located.status
      result.selection = located.selection
      result.reason = located.reason
      activeItem =
        adapter.kind === 'wps'
          ? app.ActiveDocument
          : adapter.kind === 'wpp'
            ? app.ActivePresentation
            : app.ActiveWorkbook
      if (!activeItem || normalizePath(activeItem.FullName) !== normalizePath(payload.path)) {
        result.status = 'opened'
        delete result.selection
        throw new Error('WPS 活动文件已变化，未确认定位')
      }
      result.fullName = activeItem.FullName
    } catch (error) {
      result.status = 'opened'
      delete result.selection
      result.reason = describeError(error)
    }
    return result
  }

  var pendingNavigation = {}
  function handlePayload(payload) {
    if (!payload || payload.type === 'ping') return
    if (payload.type === 'navigate') {
      var navigationKey = normalizePath(payload.path)
      pendingNavigation[navigationKey] = payload.requestId
      var attempt = 0
      function locateWhenReady() {
        if (pendingNavigation[navigationKey] !== payload.requestId) return
        var result = navigateForReview(payload)
        if (result.reason === '文档尚未加载完成' && attempt++ < 30) {
          setTimeout(locateWhenReady, 100)
          return
        }
        delete pendingNavigation[navigationKey]
        report('navigate-result', result)
      }
      locateWhenReady()
      return
    }
    if (payload.type === 'close') {
      try {
        bindAdapter()
        var closed = closeForWrite(payload.path)
        var item = closed.item
        delete closed.item
        if (!closed.ok || !item) {
          report('close-result', closed, true)
          return
        }
        closed.placeholder = false
        try {
          suppressEvents = true
          // 关掉最后一个文档组件就会退出，先建一个空文档撑住进程，重开后再关掉它。
          if (closed.remaining <= 0) {
            placeholderItem = addPlaceholder()
            closed.placeholder = placeholderItem !== null
          }
          adapter.close(item)
        } catch (error) {
          closed.ok = false
          closed.reason = describeError(error)
        } finally {
          suppressEvents = false
        }
        // Close 失败在部分组件里是静默的，必须复查，否则馆长会以为锁已释放而照写。
        if (closed.ok && findItem(payload.path)) {
          closed.ok = false
          closed.reason = 'still open after close'
        }
        report('close-result', closed, true)
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
        closePlaceholder()
        try {
          existing.Activate()
        } catch {
          /* The target may already be active. */
        }
        var viewKey = normalizePath(payload.path),
          view = pendingViews[viewKey]
        delete pendingViews[viewKey]
        if (view) adapter.restoreView(view)
        report('reload-result', {
          ok: true,
          fullName: existing.FullName,
          excerpt: adapter.excerpt ? adapter.excerpt(existing) : '',
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
      var source = new EventSource(
        server +
          '/events?component=' +
          (adapter ? adapter.kind : 'none') +
          '&clientId=' +
          encodeURIComponent(clientId)
      )
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
        } catch {
          report('sse-bad-payload', { raw: String(event.data) })
        }
      }
    } catch {
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
    } catch {
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
          } catch {
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
    } catch {
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
    } catch {
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
        app.ApiEvent.AddApiEventListener(
          API_EVENTS[index],
          'ribbon.OnApiEvent_' + API_EVENTS[index]
        )
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
