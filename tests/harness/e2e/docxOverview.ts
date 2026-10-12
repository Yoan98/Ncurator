import type { Page } from 'playwright'
import type { E2ETestRuntime } from './run-e2e-case'
import { workbenchSelectors } from '../../../src/renderer/src/testing/selectors'

export async function assertEmptyDocxOverview(runtime: E2ETestRuntime): Promise<void> {
  await runtime.page.waitForFunction((ids) => {
    const rail = document.querySelector(`[data-testid="${ids.docxOverview}"]`)
    return (
      rail?.getAttribute('data-mode') === 'references' &&
      !rail.querySelector('button') &&
      rail.getBoundingClientRect().width === 16
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
    evidence.mode === 'references' && evidence.width === 16 && evidence.markerCount === 0,
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
