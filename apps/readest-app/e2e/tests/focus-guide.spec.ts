import { mkdir } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/base';
import { SAMPLE_EPUB } from '../fixtures/books';
import { LibraryPage } from '../pages/LibraryPage';

test.use({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' });

test.afterEach(async ({ page }) => {
  expect((await page.pageErrors()).map((error) => error.message)).toEqual([]);
});

async function tools(page: Page) {
  if ((await page.locator('.moshu-root').getAttribute('data-chrome')) === 'hidden')
    await page.getByLabel('显示阅读工具栏', { exact: true }).click();
  await expect(page.locator('.moshu-topbar')).toHaveCSS('opacity', '1');
}

async function prose(page: Page) {
  return page.evaluate(() => {
    const view = document.querySelector('foliate-view') as HTMLElement & {
      renderer: { getContents(): { doc: Document }[] };
    };
    const bounds = view.getBoundingClientRect();
    for (const { doc } of view.renderer.getContents()) {
      const frame = doc.defaultView!.frameElement!.getBoundingClientRect();
      for (const paragraph of doc.querySelectorAll('p')) {
        if ((paragraph.textContent || '').length < 70) continue;
        const range = doc.createRange();
        range.selectNodeContents(paragraph);
        for (const rect of range.getClientRects()) {
          const x = frame.left + rect.left + 40;
          const y = frame.top + rect.top + rect.height / 2;
          if (
            rect.width > 250 &&
            rect.height < 50 &&
            x > bounds.left &&
            x < bounds.right - 280 &&
            y > bounds.top + 130 &&
            y < bounds.bottom - 180
          )
            return {
              x,
              y,
              lineTop: frame.top + rect.top,
              lineBottom: frame.top + rect.bottom,
              gapY: frame.top + rect.bottom + 3,
            };
        }
      }
    }
    return null;
  });
}

async function open(page: Page) {
  const library = new LibraryPage(page);
  await library.goto();
  await library.importBook(SAMPLE_EPUB);
  await library.openFirstBook();
  await page.getByRole('button', { name: /快速阅读/ }).click();
  await tools(page);
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await page.getByText('Chapter 1 - Down the Rabbit Hole', { exact: true }).first().click();
  await expect.poll(() => prose(page)).not.toBeNull();
}

async function followStyle(page: Page, name: '经典聚焦' | '轻柔底纹') {
  await tools(page);
  await page.getByRole('button', { name: '跟随样式', exact: true }).click();
  await page.getByRole('radio', { name, exact: true }).click();
  await expect(page.locator('[data-sentence-guide]')).toHaveAttribute(
    'data-follow-style',
    name === '经典聚焦' ? 'classic' : 'soft',
  );
}

async function capture(page: Page, name: string) {
  await mkdir('/tmp/moshu-focus-guide', { recursive: true });
  await page.screenshot({ path: `/tmp/moshu-focus-guide/${name}.png` });
}

test('两种跟随样式可切换，轻柔底纹保持单一标记且刷新后保留选择', async ({ page }) => {
  await open(page);
  await followStyle(page, '经典聚焦');
  const guide = page.locator('[data-sentence-guide]');
  await expect(guide).toHaveAttribute('data-follow-style', 'classic');
  await expect(guide.locator('.moshu-focus-veil')).toHaveCount(1);

  await followStyle(page, '轻柔底纹');
  await expect(guide).toHaveAttribute('data-follow-style', 'soft');
  await expect(guide.locator('.moshu-focus-veil')).toHaveCount(0);
  const marker = guide.locator('[data-focus-soft]');
  await expect(marker).toHaveCount(1);
  const point = (await prose(page))!;
  await page.mouse.move(point.x, point.y);
  await expect(guide).toHaveCSS('visibility', 'visible');
  const firstBounds = (await marker.boundingBox())!;
  await page.mouse.move(point.x + 12, point.y);
  await expect.poll(async () => (await marker.boundingBox())?.x).toBeCloseTo(firstBounds.x + 12, 0);
  await capture(page, 'soft-follow');

  await page.reload();
  await expect(guide).toHaveAttribute('data-follow-style', 'soft');
  await tools(page);
  await page.getByRole('button', { name: '跟随样式', exact: true }).click();
  await expect(page.getByRole('radio', { name: '轻柔底纹', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await capture(page, 'follow-style-menu');
  await page.keyboard.press('Escape');
  await tools(page);
  const follow = page.getByRole('button', { name: /^字句跟随/ });
  await follow.click();
  await expect(follow).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => prose(page)).not.toBeNull();
  const restoredPoint = (await prose(page))!;
  await page.mouse.move(restoredPoint.x, restoredPoint.y);
  await expect(guide).toHaveCSS('visibility', 'hidden');
  await tools(page);
  await follow.click();
  await expect(follow).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(restoredPoint.x, restoredPoint.y);
  await expect(guide).toHaveCSS('visibility', 'visible');
  await expect(guide).toHaveAttribute('data-follow-style', 'soft');
});

test('经典聚焦跨行间与正文外移动保持稳定，向下移动不再唤出导航', async ({ page }) => {
  await open(page);
  await followStyle(page, '经典聚焦');
  const guide = page.locator('[data-sentence-guide]');
  const point = (await prose(page))!;
  await page.mouse.move(point.x, point.y);
  await expect(guide).toHaveCSS('visibility', 'visible');
  const viewport = await page.locator('foliate-view').boundingBox();
  await page.mouse.move(point.x, point.gapY);
  await expect(guide).toHaveCSS('visibility', 'visible');
  await page.mouse.move(720, 2);
  await expect(guide).toHaveCSS('visibility', 'visible');
  await expect(page.locator('.moshu-root')).toHaveAttribute('data-chrome', 'hidden');
  for (const y of [750, 900, 995]) {
    await page.mouse.move(720, y, { steps: 8 });
    await expect(page.locator('.moshu-root')).toHaveAttribute('data-chrome', 'hidden');
    await expect(page.locator('.moshu-topbar')).toHaveCSS('opacity', '0');
    await expect(page.locator('.moshu-page-footer')).toHaveCSS('opacity', '0');
  }
  expect(await page.locator('foliate-view').boundingBox()).toEqual(viewport);
  await capture(page, 'classic-bottom-no-toolbar');
  await tools(page);
  expect(await page.locator('foliate-view').boundingBox()).toEqual(viewport);
  await page.mouse.move(720, 975);
  await expect(page.locator('.moshu-root')).toHaveAttribute('data-chrome', 'hidden');
  await expect(page.locator('.moshu-page-footer')).toHaveCSS('opacity', '0');
});

test('小墨在停留位置旁提醒，继续读同一行时立即消失', async ({ page }) => {
  await open(page);
  const point = (await prose(page))!;
  await page.mouse.move(point.x, point.y);
  const nudge = page.getByRole('button', { name: '小墨停留提醒', exact: true });
  await expect(nudge).toBeVisible({ timeout: 10000 });
  await expect(nudge.getByTestId('modian-mascot')).toHaveAttribute('src', '/modian/question.webp');
  await expect(nudge.getByTestId('modian-mascot')).toHaveAttribute('data-motion', 'none');
  await expect(nudge).not.toHaveText('');
  const box = (await nudge.boundingBox())!;
  const distanceX = Math.max(box.x - point.x, point.x - box.x - box.width, 0);
  const distanceY = Math.max(box.y - point.y, point.y - box.y - box.height, 0);
  expect(distanceX).toBeLessThan(80);
  expect(distanceY).toBeLessThan(80);
  expect(box.y >= point.lineBottom || box.y + box.height <= point.lineTop).toBe(true);
  await expect(page.locator('[data-question-highlight]')).toHaveCount(0);
  await capture(page, 'xiaomo-near-pointer');
  await page.mouse.move(point.x + 100, point.y, { steps: 5 });
  await expect(nudge).toHaveCount(0);
  await capture(page, 'xiaomo-dismissed-on-move');
});

test('鼠标可以直接移入小墨提醒并点击，展开后显式保存疑问', async ({ page }) => {
  await open(page);
  const point = (await prose(page))!;
  await page.mouse.move(point.x, point.y);
  const nudge = page.getByRole('button', { name: '小墨停留提醒', exact: true });
  await expect(nudge).toBeVisible({ timeout: 10000 });
  const box = (await nudge.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
  await expect(nudge).toBeVisible();
  await nudge.click();
  const card = page.getByRole('region', { name: '小墨停留提醒', exact: true });
  await expect(card).toBeVisible();
  await expect(page.locator('[data-question-highlight]')).toHaveCount(0);
  await capture(page, 'xiaomo-expanded');
  await card.getByRole('radio', { name: '字 横线' }).click();
  await card.getByRole('button', { name: '留下疑问', exact: true }).click();
  await expect(page.locator('[data-question-highlight]')).not.toHaveCount(0);
  await expect(card).toHaveCount(0);
});
