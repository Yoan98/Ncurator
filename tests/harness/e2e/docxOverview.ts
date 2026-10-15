import type { Page } from 'playwright'
import type { E2ETestRuntime } from './run-e2e-case'
import { workbenchSelectors } from '../../../src/renderer/src/testing/selectors'

export async function assertEmptyDocxOverview(runtime: E2ETestRuntime): Promise<void> {
  await runtime.page.waitForFunction((ids) => {
    const rail = document.querySelector(`[data-testid="${ids.docxOverview}"]`)
    return (
      rail?.getAttribute('data-mode') === 'references' &&
      !rail.querySelector('button') &&
      Math.abs(rail.getBoundingClientRect().width - 16) <= 0.05
    )
  }, workbenchSelectors)
  const evidence = await runtime.page
    .getByTestId(workbenchSelectors.docxOverview)
    .evaluate((rail) => ({
      mode: rail.getAttribute('data-mode'),
      width: rail.getBoundingClientRect().width,
      markerCount: rail.querySelectorAll('button').length
    }))
  await runtime.assertThat(
    evidence.mode === 'references' &&
      Math.abs(evidence.width - 16) <= 0.05 &&
      evidence.markerCount === 0,
    {
      name: 'docx-overview-empty-preview',
      message: '预览无引用时保留 16px 空条，没有审核残留。',
      data: evidence
    }
  )
}

async function readFocusedReference(page: Page): Promise<string[]> {
  return page.evaluate((ids) => {
    const boxes = [...document.querySelectorAll(`[data-testid="${ids.docxOverviewFocus}"]`)].map(
      (node) => node.getBoundingClientRect()
    )
    return [...CSS.highlights]
      .filter(([key]) => key.startsWith('docx-') && !/-(active|hover)$/.test(key))
      .flatMap(([, highlight]) => [...highlight])
      .filter((range): range is Range => range instanceof Range)
      .filter((range) =>
        [...range.getClientRects()].some((r) =>
          boxes.some((b) => Math.abs(b.left - r.left) < 2 && Math.abs(b.right - r.right) < 2)
        )
      )
      .map((range) => range.toString())
  }, workbenchSelectors)
}

export async function assertDocxReferenceOverview(runtime: E2ETestRuntime): Promise<void> {
  const { page } = runtime
  const marker = page.getByTestId(workbenchSelectors.docxOverviewMarker).first()
  await marker.waitFor({ state: 'visible' })
  const evidence = []
  for (const input of ['click', 'Enter', 'Space']) {
    if (input === 'click') await marker.click()
    else await marker.press(input)
    await page
      .getByTestId(workbenchSelectors.docxOverviewFocus)
      .first()
      .waitFor({ state: 'visible' })
    evidence.push(await readFocusedReference(page))
    // Wait for this activation's emphasis to end before checking the next one.
    // Otherwise a visible overlay from the previous click can satisfy the wait.
    await page
      .getByTestId(workbenchSelectors.docxOverviewFocus)
      .first()
      .waitFor({ state: 'detached' })
  }
  const color = await marker.evaluate((element) => getComputedStyle(element).backgroundColor)
  await runtime.assertThat(
    color === 'rgb(164, 128, 197)' &&
      evidence.map((quotes) => quotes.join(',')).join('|') === 'Hello|from|fixture',
    {
      name: 'docx-overview-reference-cycle',
      message: '同一行的三个引用压缩为紫色块，鼠标、Enter、Space 依次准确定位并强调对应原文。',
      data: { color, evidence }
    }
  )
  await runtime.captureScreenshot({
    name: 'docx-overview-references',
    message: 'DOCX 引用位置概览'
  })
  await page
    .getByTestId(workbenchSelectors.docxOverviewFocus)
    .first()
    .waitFor({ state: 'detached' })
}

export async function assertDocxReviewOverview(runtime: E2ETestRuntime): Promise<void> {
  const { page } = runtime
  const kinds = ['deleted', 'inserted', 'formatted']
  const evidence = []
  for (const kind of kinds) {
    const marker = page
      .getByTestId(workbenchSelectors.docxOverviewMarker)
      .and(page.locator(`[data-kinds~="${kind}"]`))
      .first()
    await marker.waitFor({ state: 'visible', timeout: 30_000 })
    await marker.click()
    await page
      .getByTestId(workbenchSelectors.docxOverviewFocus)
      .first()
      .waitFor({ state: 'visible' })
    evidence.push(
      await marker.evaluate(
        (element, { ids, kind }) => {
          const focus = document
            .querySelector(`[data-testid="${ids.docxOverviewFocus}"]`)!
            .getBoundingClientRect()
          const container = document.querySelector('.docx-content')!
          const viewport = container.getBoundingClientRect()
          const kinds = element.getAttribute('data-kinds')!.split(' ')
          const matches = [...container.querySelectorAll<HTMLElement>('[data-docx-change]')]
            .filter((target) => {
              if (!kinds.includes(target.dataset.docxChange || '')) return false
              return [...target.getClientRects()].some(
                (r) =>
                  Math.abs(Math.max(r.top, viewport.top) - focus.top) < 2 &&
                  Math.abs(Math.min(r.bottom, viewport.bottom) - focus.bottom) < 2
              )
            })
            .map((target) => target.textContent)
          return {
            kind,
            matches,
            color: getComputedStyle(element).backgroundColor,
            left: element.getBoundingClientRect().left,
            visible: focus.top >= viewport.top - 1 && focus.bottom <= viewport.bottom + 1
          }
        },
        { ids: workbenchSelectors, kind }
      )
    )
    await page
      .getByTestId(workbenchSelectors.docxOverviewFocus)
      .first()
      .waitFor({ state: 'detached' })
  }
  await runtime.assertThat(
    evidence.every((e) => e.visible && e.matches.length > 0) &&
      evidence[0].color === 'rgb(179, 38, 30)' &&
      evidence[1].color === 'rgb(47, 111, 78)' &&
      evidence[0].left < evidence[1].left,
    {
      name: 'docx-overview-review-navigation',
      message: '审核红删绿增分列，格式修改保留独立语义，点击定位真实变更范围。',
      data: evidence
    }
  )
  await runtime.captureScreenshot({
    name: 'docx-overview-review',
    message: 'DOCX 红删绿增位置概览'
  })
}

export async function assertDocxSharedScrollTrack(runtime: E2ETestRuntime): Promise<void> {
  const { page } = runtime
  const rail = page.getByTestId(workbenchSelectors.docxOverview)
  const thumb = page.getByTestId(workbenchSelectors.docxOverviewThumb)
  await thumb.waitFor({ state: 'visible' })
  const read = () =>
    rail.evaluate((element, ids) => {
      const container = document.querySelector<HTMLElement>('.docx-content')!
      const slider = element.querySelector<HTMLElement>(`[data-testid="${ids.docxOverviewThumb}"]`)!
      const bounds = element.getBoundingClientRect(),
        box = slider.getBoundingClientRect()
      const max = container.scrollHeight - container.clientHeight
      return {
        scrollTop: container.scrollTop,
        max,
        rail: { x: bounds.left, y: bounds.top, height: bounds.height, width: bounds.width },
        thumb: { x: box.left, y: box.top, height: box.height, width: box.width },
        expectedTop: max ? (container.scrollTop / max) * (bounds.height - box.height) : 0,
        thumbTop: box.top - bounds.top,
        nativeWidth: getComputedStyle(container, '::-webkit-scrollbar').width,
        focusCount: document.querySelectorAll(`[data-testid="${ids.docxOverviewFocus}"]`).length
      }
    }, workbenchSelectors)
  const waitSynchronized = () =>
    page.waitForFunction((ids) => {
      const container = document.querySelector<HTMLElement>('.docx-content')!
      const track = document.querySelector<HTMLElement>(`[data-testid="${ids.docxOverview}"]`)!
      const slider = track.querySelector<HTMLElement>(`[data-testid="${ids.docxOverviewThumb}"]`)
      if (!slider) return false
      const box = slider.getBoundingClientRect(),
        railBox = track.getBoundingClientRect()
      const expected =
        (container.scrollTop / (container.scrollHeight - container.clientHeight)) *
        (railBox.height - box.height)
      return Math.abs(box.top - railBox.top - expected) < 1
    }, workbenchSelectors)
  await rail.press('Home')
  await waitSynchronized()
  const initial = await read()
  await page.mouse.click(initial.rail.x + 7, initial.rail.y + initial.rail.height - 5)
  await page.waitForFunction(() => document.querySelector('.docx-content')!.scrollTop > 50)
  await waitSynchronized()
  const clicked = await read()
  await page.mouse.move(clicked.rail.x + 7, clicked.rail.y + clicked.rail.height / 2)
  await page.mouse.wheel(0, -120)
  await page.waitForFunction(
    (top) => document.querySelector('.docx-content')!.scrollTop < top,
    clicked.scrollTop
  )
  await waitSynchronized()
  const wheeled = await read()
  await page.mouse.move(wheeled.thumb.x + 7, wheeled.thumb.y + wheeled.thumb.height / 2)
  await page.mouse.down()
  await page.mouse.move(wheeled.rail.x + 7, wheeled.rail.y + wheeled.thumb.height / 2, {
    steps: 10
  })
  await page.mouse.up()
  await page.waitForFunction(() => document.querySelector('.docx-content')!.scrollTop < 1)
  await waitSynchronized()
  const dragged = await read()
  const marker = page.getByTestId(workbenchSelectors.docxOverviewMarker).first()
  const markerBox = await marker.boundingBox()
  if (!markerBox) throw new Error('引用标记不可见')
  const overlapsThumb =
    markerBox.y < dragged.thumb.y + dragged.thumb.height &&
    markerBox.y + markerBox.height > dragged.thumb.y
  await marker.click()
  await page.getByTestId(workbenchSelectors.docxOverviewFocus).first().waitFor({ state: 'visible' })
  const focused = await readFocusedReference(page)
  await page
    .getByTestId(workbenchSelectors.docxOverviewFocus)
    .first()
    .waitFor({ state: 'detached' })
  const markerBeforeDrag = await marker.boundingBox()
  if (!markerBeforeDrag) throw new Error('引用标记不可见')
  await page.mouse.move(
    markerBeforeDrag.x + markerBeforeDrag.width / 2,
    markerBeforeDrag.y + markerBeforeDrag.height / 2
  )
  await page.mouse.down()
  await page.mouse.move(
    markerBeforeDrag.x + markerBeforeDrag.width / 2,
    markerBeforeDrag.y + markerBeforeDrag.height / 2 + 50,
    { steps: 10 }
  )
  await page.mouse.up()
  await waitSynchronized()
  const draggedFromMarker = await read()
  await runtime.assertThat(
    initial.max > 50 &&
      Math.abs(initial.rail.width - 16) <= 0.05 &&
      initial.thumb.width === 14 &&
      initial.nativeWidth === '0px' &&
      clicked.scrollTop > 50 &&
      wheeled.scrollTop < clicked.scrollTop &&
      dragged.scrollTop < 1 &&
      dragged.focusCount === 0 &&
      overlapsThumb &&
      focused.length > 0 &&
      draggedFromMarker.focusCount === 0 &&
      draggedFromMarker.scrollTop > dragged.scrollTop &&
      [clicked, wheeled, dragged, draggedFromMarker].every(
        (e) => Math.abs(e.thumbTop - e.expectedTop) < 1
      ),
    {
      name: 'docx-shared-scroll-track',
      message:
        'DOCX 仅保留 16px 共用轨道；空白点击、滚轮与拖动同步滑块，覆盖色块可定位，从色块拖动不误触定位。',
      data: { initial, clicked, wheeled, dragged, overlapsThumb, focused, draggedFromMarker }
    }
  )
  await rail.press('Home')
  await page.locator('.docx-content').click({ position: { x: 5, y: 5 } })
  await runtime.captureScreenshot({
    name: 'docx-shared-scroll-track',
    message: 'DOCX 标记与滑块同轨叠层'
  })
}
