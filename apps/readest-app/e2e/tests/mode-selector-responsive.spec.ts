import { expect, test } from '../fixtures/base';
import { SAMPLE_EPUB } from '../fixtures/books';
import { LibraryPage } from '../pages/LibraryPage';

test.use({ viewport: { width: 1366, height: 768 }, locale: 'en-US' });

test('阅读入口在不同窗口完整显示，切换和返回保持可操作', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const library = new LibraryPage(page);
  await library.goto();
  await library.importBook(SAMPLE_EPUB);
  await library.openFirstBook();
  const selector = page.getByRole('region', { name: '选择阅读方式' });
  const mascot = selector.locator('.moshu-selector-mascot');
  await expect(selector).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Sidebar', exact: true })).toBeHidden();

  await page.setViewportSize({ width: 1366, height: 768 });
  const contentBox = await selector.locator('.moshu-selector-content').boundingBox();
  const cardBox = await selector.getByRole('button', { name: /快速阅读/ }).boundingBox();
  const mascotBox = await mascot.boundingBox();
  const coverBox = await selector.locator('.moshu-book-intro img').first().boundingBox();
  expect(contentBox!.width).toBeGreaterThanOrEqual(1040);
  expect(cardBox!.height).toBeGreaterThanOrEqual(205);
  expect(mascotBox!.width).toBeGreaterThanOrEqual(76);
  expect(coverBox!.height).toBeGreaterThanOrEqual(120);

  for (const [width, height] of [
    [1366, 768],
    [1280, 600],
    [1920, 1080],
    [2560, 1440],
    [1024, 600],
    [800, 480],
    [390, 667],
  ]) {
    await page.setViewportSize({ width: width!, height: height! });
    await expect(page.getByRole('button', { name: '墨书 · 返回书库' })).toBeInViewport({
      ratio: 1,
    });
    await expect(mascot).toBeInViewport({ ratio: 1 });
    await expect
      .poll(() =>
        selector.evaluate((element) => ({
          vertical: element.scrollHeight > element.clientHeight + 1,
          horizontal: element.scrollWidth > element.clientWidth + 1,
        })),
      )
      .toEqual({ vertical: false, horizontal: false });
    for (const name of ['快速阅读', '分析阅读', '主题阅读']) {
      await expect(selector.getByRole('button', { name: new RegExp(name) })).toBeInViewport({
        ratio: 1,
      });
      await selector
        .getByRole('button', { name: new RegExp(name) })
        .click({ trial: true, timeout: 2000 });
    }
    await page.screenshot({ path: `/tmp/moshu-selector-${width}x${height}.png` });
  }

  await page.setViewportSize({ width: 1280, height: 600 });
  await selector.getByRole('button', { name: /快速阅读/ }).focus();
  await page.keyboard.press('Enter');
  await expect(selector).toBeHidden();
  await expect(page.locator('foliate-view')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Sidebar', exact: true })).toBeVisible();
  if ((await page.locator('.moshu-root').getAttribute('data-chrome')) === 'hidden')
    await page.getByLabel('显示阅读工具栏', { exact: true }).click();
  await page.getByRole('button', { name: /切换模式/ }).click();
  await expect(selector).toBeVisible();
  await expect(selector.getByRole('button', { name: /返回阅读/ })).toBeInViewport({ ratio: 1 });
  const header = await page.locator('.moshu-topbar').boundingBox();
  const content = await page.locator('.moshu-book-intro').boundingBox();
  expect(content!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
  await selector.getByRole('button', { name: /返回阅读/ }).click();
  await expect(selector).toBeHidden();
  await expect(page.locator('foliate-view')).toBeVisible();
  expect(errors).toEqual([]);
});
