import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/base';
import { LibraryPage } from '../pages/LibraryPage';

test.use({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' });

let fixtureDirectory: string;
let fixturePath: string;

test.beforeAll(async () => {
  await mkdir('/tmp/moshu-line-lock', { recursive: true });
  fixtureDirectory = await mkdtemp('/tmp/moshu-line-lock/book-');
  fixturePath = path.join(fixtureDirectory, 'locked-follow.epub');
  const paragraphs = Array.from({ length: 60 }, (_, index) => {
    const link = index === 2 ? '<a href="next.xhtml#target">打开链接目标</a>。' : '';
    return `<p>${link}第 ${index + 1} 段。阅读时，我们希望目光能顺着文字平稳前进，鼠标只提供轻轻的指引。手向上或向下移动时，已经读到的位置仍然留在当前这一行。读到行尾，再自然接到下一行，周围的文字始终完整清晰。遇到值得思考的句子，也可以停下来选中一段文字，留下自己的理解。</p>`;
  }).join('');
  await writeFile(
    fixturePath,
    zipSync({
      mimetype: [strToU8('application/epub+zip'), { level: 0 }],
      'META-INF/container.xml': strToU8(
        '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
      ),
      'book.opf': strToU8(
        '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">moshu-locked-follow-e2e</dc:identifier><dc:title>锁行跟随交互验证</dc:title><dc:language>zh-CN</dc:language><meta property="dcterms:modified">2026-09-27T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="next" href="next.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/><itemref idref="next"/></spine></package>',
      ),
      'nav.xhtml': strToU8(
        '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">开始阅读</a></li><li><a href="next.xhtml">链接目标章节</a></li></ol></nav></body></html>',
      ),
      'next.xhtml': strToU8(
        '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>链接目标章节</title></head><body><p id="target">链接目标：这里仍然可以正常阅读。普通正文链接保留原本的跳转行为，锁行引导不会接管点击链接的操作。</p></body></html>',
      ),
      'chapter.xhtml': strToU8(
        `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>开始阅读</title><style>body { font-size: 20px; line-height: 1.8; } p { margin: 0 0 1em; }</style></head><body>${paragraphs}</body></html>`,
      ),
    }),
  );
});

test.afterAll(async () => {
  if (fixtureDirectory) await rm(fixtureDirectory, { recursive: true, force: true });
});

test.afterEach(async ({ page }) => {
  expect((await page.pageErrors()).map((error) => error.message)).toEqual([]);
});

async function tools(page: Page) {
  if ((await page.locator('.moshu-root').getAttribute('data-chrome')) === 'hidden')
    await page.getByLabel('显示阅读工具栏', { exact: true }).click();
}

async function visibleLines(page: Page) {
  return page.evaluate(() => {
    const view = document.querySelector('foliate-view') as HTMLElement & {
      renderer: { getContents(): { doc: Document }[] };
    };
    const bounds = view.getBoundingClientRect();
    const lines: { left: number; right: number; top: number; bottom: number; y: number }[] = [];
    for (const { doc } of view.renderer.getContents()) {
      const iframe = doc.defaultView!.frameElement!;
      const frame = iframe.getBoundingClientRect();
      const clip = {
        left: Math.max(bounds.left, frame.left),
        right: Math.min(bounds.right, frame.right),
        top: Math.max(bounds.top, frame.top),
        bottom: Math.min(bounds.bottom, frame.bottom),
      };
      let ancestor: Element | null = iframe.parentElement;
      while (ancestor) {
        const style = getComputedStyle(ancestor);
        const box = ancestor.getBoundingClientRect();
        if (/(hidden|clip|scroll|auto)/.test(style.overflowX)) {
          clip.left = Math.max(clip.left, box.left);
          clip.right = Math.min(clip.right, box.right);
        }
        if (/(hidden|clip|scroll|auto)/.test(style.overflowY)) {
          clip.top = Math.max(clip.top, box.top);
          clip.bottom = Math.min(clip.bottom, box.bottom);
        }
        const root = ancestor.getRootNode();
        ancestor = ancestor.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
      }
      for (const paragraph of doc.querySelectorAll('p')) {
        const range = doc.createRange();
        range.selectNodeContents(paragraph);
        for (const rect of range.getClientRects()) {
          const left = frame.left + rect.left;
          const right = frame.left + rect.right;
          const top = frame.top + rect.top;
          const bottom = frame.top + rect.bottom;
          if (
            rect.width < 10 ||
            rect.height < 8 ||
            rect.height > 60 ||
            left < clip.left ||
            right > clip.right + 1 ||
            top < clip.top + 2 ||
            bottom > clip.bottom - 2
          )
            continue;
          const existing = lines.find((line) => Math.abs(line.top - top) < 2);
          if (existing) {
            existing.left = Math.min(existing.left, left);
            existing.right = Math.max(existing.right, right);
          } else lines.push({ left, right, top, bottom, y: (top + bottom) / 2 });
        }
      }
    }
    return lines.sort((a, b) => a.top - b.top);
  });
}

async function location(page: Page) {
  return page.evaluate(() => {
    const view = document.querySelector('foliate-view') as HTMLElement & {
      lastLocation?: { cfi?: string };
      renderer: { page: number; primaryIndex: number };
    };
    return {
      cfi: view.lastLocation?.cfi,
      page: view.renderer.page,
      section: view.renderer.primaryIndex,
    };
  });
}

async function open(page: Page, locked = true) {
  const library = new LibraryPage(page);
  await library.goto();
  await library.importBook(fixturePath);
  await library.openFirstBook();
  await page.getByRole('button', { name: /快速阅读/ }).click();
  await tools(page);
  const singlePage = page.getByRole('button', { name: '单页', exact: true });
  await singlePage.click();
  await expect(singlePage).toHaveAttribute('aria-pressed', 'true');
  await expect(singlePage).toBeEnabled();
  await expect.poll(async () => (await visibleLines(page)).length).toBeGreaterThan(4);
  if (locked) {
    await tools(page);
    await page.getByRole('button', { name: '跟随样式', exact: true }).click();
    await page.getByRole('switch', { name: '锁行', exact: true }).click();
    await expect(page.locator('[data-locked-line-guide]')).toBeAttached();
  }
}

async function capture(page: Page, name: string) {
  await page.screenshot({ path: `/tmp/moshu-line-lock/${name}.png` });
}

async function styleMenu(page: Page) {
  await tools(page);
  await page.getByRole('button', { name: '跟随样式', exact: true }).click();
  await expect(page.locator('.moshu-follow-menu')).toBeVisible();
  await expect(page.locator('.moshu-follow-menu').getByRole('radio')).toHaveCount(2);
  await expect(page.getByRole('switch', { name: '锁行', exact: true })).toBeVisible();
}

async function expectLockedVisual(page: Page, style: 'classic' | 'soft') {
  const guide = page.locator('[data-locked-line-guide]');
  await expect(guide).toHaveAttribute('data-follow-style', style);
  await expect(guide).toBeVisible();
  await expect(guide.locator('.moshu-focus-veil')).toHaveCount(style === 'classic' ? 1 : 0);
  if (style === 'classic') await expect(guide.locator('.moshu-focus-veil')).toBeVisible();
  await expect(page.locator('[data-locked-marker]')).toBeVisible();
}

for (const [style, label, otherStyle, otherLabel] of [
  ['classic', '经典聚焦', 'soft', '轻柔底纹'],
  ['soft', '轻柔底纹', 'classic', '经典聚焦'],
] as const) {
  test(`${label}可独立开关锁行，保留视觉与重开设置，切换样式不重置锁行`, async ({ page }) => {
    await open(page, false);
    await styleMenu(page);
    await expect(page.getByRole('radio', { name: '轻柔底纹', exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByRole('switch', { name: '锁行', exact: true })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await page.getByRole('radio', { name: label, exact: true }).click();
    await styleMenu(page);
    await page.getByRole('switch', { name: '锁行', exact: true }).click();
    await expect(page.locator('.moshu-follow-menu')).toBeHidden();
    await expect(page.locator('[data-locked-line-guide]')).toBeAttached();
    const line = (await visibleLines(page)).find((candidate) => candidate.top > 140)!;
    // Enabling the behavior must respond to the first pointer move, without a body click.
    await page.mouse.move(line.left + 40, line.y);
    await expectLockedVisual(page, style);
    await capture(page, `${style}-line-lock`);

    await page.reload();
    await expect(page.locator('foliate-view')).toBeVisible();
    await expect(page.locator('[data-locked-line-guide]')).toBeAttached();
    await styleMenu(page);
    await expect(page.getByRole('radio', { name: label, exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByRole('switch', { name: '锁行', exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await capture(page, `${style}-line-lock-menu`);
    await page.getByRole('radio', { name: otherLabel, exact: true }).click();
    await expect(page.locator('[data-locked-line-guide]')).toHaveAttribute(
      'data-follow-style',
      otherStyle,
    );
    const restored = (await visibleLines(page)).find((candidate) => candidate.top > 140)!;
    await page.mouse.move(restored.left + 40, restored.y);
    await expectLockedVisual(page, otherStyle);
    await styleMenu(page);
    await expect(page.getByRole('switch', { name: '锁行', exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.getByRole('switch', { name: '锁行', exact: true }).click();
    await expect(page.locator('.moshu-follow-menu')).toBeHidden();
    await expect(page.locator('[data-locked-line-guide]')).toHaveCount(0);
    await expect(page.locator('[data-sentence-guide]')).toHaveAttribute(
      'data-follow-style',
      otherStyle,
    );
    await styleMenu(page);
    await expect(page.getByRole('radio', { name: otherLabel, exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByRole('switch', { name: '锁行', exact: true })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });
}

test('菜单无按钮焦点时超过自动隐藏时间仍可选择锁行，关闭后恢复阅读', async ({ page }) => {
  await open(page, false);
  await tools(page);
  await page.getByRole('button', { name: '跟随样式', exact: true }).click();
  // WebKit does not always focus a mouse-clicked button. Remove Chromium's focus to match it.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect
    .poll(() => page.locator('.moshu-topbar').evaluate((el) => el.matches(':focus-within')))
    .toBe(false);
  // Exercise the actual 1600 ms chrome timer while the menu remains open.
  await page.waitForTimeout(1800);
  await expect(page.locator('.moshu-root')).toHaveAttribute('data-chrome', 'visible');
  await expect(page.locator('.moshu-topbar')).toHaveCSS('opacity', '1');
  await expect(page.locator('.moshu-topbar')).toHaveCSS('pointer-events', 'auto');
  await capture(page, 'locked-menu-without-focus');
  await page.getByRole('switch', { name: '锁行', exact: true }).click();
  await expect(page.locator('[data-locked-line-guide]')).toBeAttached();
  const line = (await visibleLines(page)).find((candidate) => candidate.top > 140)!;
  await page.mouse.move(line.left + 35, line.y);
  await expect(page.locator('[data-locked-marker]')).toBeVisible();
  await expect(page.locator('.moshu-root')).toHaveAttribute('data-chrome', 'hidden');
  await expect(page.locator('.moshu-topbar')).toHaveCSS('opacity', '0');
  await expect(page.locator('.moshu-topbar')).toHaveCSS('pointer-events', 'none');
});

test('首次移入正文即锁行，上下移动不跳行，水平推进且点击可重新定位', async ({ page }) => {
  await open(page);
  const line = (await visibleLines(page)).find(
    (candidate) => candidate.right - candidate.left > 500 && candidate.top > 140,
  )!;
  const initialLocation = await location(page);
  await page.mouse.move(line.left + 35, line.y);
  const guide = page.locator('[data-locked-line-guide]');
  const marker = page.locator('[data-locked-marker]');
  await expect(guide).toBeVisible();
  await expect(marker).toBeVisible();
  const anchored = (await marker.boundingBox())!;
  expect(Math.abs(anchored.y + anchored.height / 2 - line.y)).toBeLessThan(8);
  await page.mouse.move(line.left + 35, line.y + 120, { steps: 8 });
  await expect.poll(async () => (await marker.boundingBox())?.y).toBeCloseTo(anchored.y, 0);
  await expect.poll(async () => (await marker.boundingBox())?.x).toBeCloseTo(anchored.x, 0);
  await page.mouse.move(line.left + 115, line.y - 30, { steps: 8 });
  await expect.poll(async () => (await marker.boundingBox())!.x).toBeGreaterThan(anchored.x + 10);
  await expect.poll(async () => (await marker.boundingBox())?.y).toBeCloseTo(anchored.y, 0);
  // The reader intentionally delays a clean click by 250 ms to distinguish double-clicks.
  await page.waitForTimeout(350);
  expect(await location(page)).toEqual(initialLocation);
  await page.mouse.click(line.right - 35, line.y);
  await expect(marker).toBeVisible();
  await page.waitForTimeout(350);
  expect(await location(page)).toEqual(initialLocation);
  const relocateLine = (await visibleLines(page)).find(
    (candidate) => candidate.top > line.bottom + 100 && candidate.right - candidate.left > 500,
  )!;
  await page.mouse.click(relocateLine.left + 35, relocateLine.y);
  await expect.poll(async () => (await marker.boundingBox())!.y).toBeGreaterThan(anchored.y + 80);
  await expect.poll(async () => (await marker.boundingBox())!.y).toBeLessThan(relocateLine.bottom);
  await page.waitForTimeout(350);
  expect(await location(page)).toEqual(initialLocation);
  await capture(page, 'locked-horizontal-guide');
});

test('行尾自动接到下一行，向左返程只复位，再向右才继续推进', async ({ page }) => {
  await open(page);
  const lines = await visibleLines(page);
  const index = lines.findIndex((line) => line.right - line.left > 500 && line.top > 140);
  const line = lines[index]!;
  const next = lines[index + 1]!;
  const marker = page.locator('[data-locked-marker]');
  await page.mouse.move(line.left + 40, line.y);
  await expect(marker).toBeVisible();
  await page.mouse.move(line.right + 35, line.y, { steps: 20 });
  await expect
    .poll(async () => {
      const box = await marker.boundingBox();
      return box !== null && box.y >= next.top - 5 && box.y <= next.bottom;
    })
    .toBe(true);
  const wrapped = (await marker.boundingBox())!;
  expect(wrapped.x).toBeLessThan(next.left + 120);
  await page.mouse.move(next.left + 30, line.y, { steps: 20 });
  await expect.poll(async () => (await marker.boundingBox())?.x).toBeCloseTo(wrapped.x, 0);
  await expect.poll(async () => (await marker.boundingBox())?.y).toBeCloseTo(wrapped.y, 0);
  await page.mouse.move(next.left + 110, line.y, { steps: 8 });
  await expect.poll(async () => (await marker.boundingBox())!.x).toBeGreaterThan(wrapped.x + 10);
  await expect.poll(async () => (await marker.boundingBox())?.y).toBeCloseTo(wrapped.y, 0);
  await capture(page, 'locked-next-line');
});

test('读到当前页面末行时自动翻页并接续，鼠标返程不会倒退或连翻', async ({ page }) => {
  await open(page);
  await expect(page.locator('.moshu-page-footer')).toHaveCSS('opacity', '0');
  const lines = await visibleLines(page);
  const last = lines.at(-1)!;
  const initialLocation = await location(page);
  const marker = page.locator('[data-locked-marker]');
  await page.mouse.move(last.left + Math.min(25, (last.right - last.left) / 2), last.y);
  await expect(marker).toBeVisible();
  await expect(page.locator('.moshu-topbar')).toHaveCSS('opacity', '0');
  await expect(page.locator('.moshu-topbar')).toHaveCSS('pointer-events', 'none');
  await page.mouse.move(last.right + 45, last.y, { steps: 20 });
  await expect.poll(() => location(page)).not.toEqual(initialLocation);
  await expect(marker).toBeVisible();
  await expect(page.locator('.moshu-topbar')).toHaveCSS('opacity', '0');
  await expect(page.locator('.moshu-topbar')).toHaveCSS('pointer-events', 'none');
  const resumed = (await marker.boundingBox())!;
  const nextLines = await visibleLines(page);
  expect(resumed.y).toBeLessThan(nextLines[0]!.bottom + 12);
  expect(resumed.x).toBeLessThan(nextLines[0]!.left + 120);
  const resumedLocation = await location(page);
  await page.mouse.move(nextLines[0]!.left + 20, last.y, { steps: 20 });
  await expect.poll(async () => (await marker.boundingBox())?.y).toBeCloseTo(resumed.y, 0);
  await expect.poll(async () => (await marker.boundingBox())?.x).toBeCloseTo(resumed.x, 0);
  expect(await location(page)).toEqual(resumedLocation);
  await capture(page, 'locked-page-continuation');
});

test('锁行时拖选仍可打开选文工具，正文内部链接仍能正常跳转', async ({ page }) => {
  await open(page);
  const line = (await visibleLines(page)).find(
    (candidate) => candidate.right - candidate.left > 500 && candidate.top > 320,
  )!;
  await page.mouse.click(line.left + 40, line.y);
  await expect(page.locator('[data-locked-marker]')).toBeVisible();
  await page.mouse.move(line.left + 40, line.y);
  await page.mouse.down();
  await page.mouse.move(line.left + 220, line.y, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('.selection-popup')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.selection-popup')).toBeHidden();
  // Let the reader's 250 ms double-click window close after the drag's mouseup.
  await page.waitForTimeout(350);
  const linkPoint = await page.evaluate(() => {
    const view = document.querySelector('foliate-view') as HTMLElement & {
      renderer: { getContents(): { doc: Document }[] };
    };
    for (const { doc } of view.renderer.getContents()) {
      const link = doc.querySelector('a[href="next.xhtml#target"]');
      if (!link) continue;
      const frame = doc.defaultView!.frameElement!.getBoundingClientRect();
      const box = link.getBoundingClientRect();
      return { x: frame.left + box.left + box.width / 2, y: frame.top + box.top + box.height / 2 };
    }
    return null;
  });
  expect(linkPoint).not.toBeNull();
  const beforeLink = await location(page);
  await page.mouse.click(linkPoint!.x, linkPoint!.y);
  await expect.poll(() => location(page)).not.toEqual(beforeLink);
  await expect.poll(async () => (await location(page)).section).toBe(1);
  await capture(page, 'locked-link-navigation');
});
