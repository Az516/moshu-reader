import { mkdir } from 'node:fs/promises';
import { expect, test } from '../fixtures/base';
import { SAMPLE_EPUB } from '../fixtures/books';
import { LibraryPage } from '../pages/LibraryPage';

test.use({ viewport: { width: 390, height: 844 }, locale: 'en-US' });

test('窄屏正文保留可读宽度，地图可展开收起', async ({ page }) => {
  const library = new LibraryPage(page);
  await library.goto();
  await library.importBook(SAMPLE_EPUB);
  await library.openFirstBook();
  await page.getByRole('button', { name: /快速阅读/ }).click();
  await expect(page.locator('foliate-view')).toBeVisible();
  await page.getByText('Chapter 1 - Down the Rabbit Hole', { exact: true }).first().click();
  await expect
    .poll(async () => (await page.locator('.moshu-book-canvas').boundingBox())?.width || 0)
    .toBeGreaterThan(350);
  const map = page.getByRole('complementary', { name: '全书地图' });
  await expect(map).not.toBeVisible();
  await page.getByRole('button', { name: '展开阅读地图' }).click();
  await expect(map).toBeVisible();
  await page.getByRole('button', { name: '收起阅读地图' }).click();
  await expect(map).not.toBeVisible();
  await expect(page.getByRole('button', { name: /对话/ })).toBeVisible();
  await mkdir('/tmp/moshu-qa', { recursive: true });
  await page.screenshot({ path: '/tmp/moshu-qa/mobile-reading.png' });
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(map).toBeVisible();
  await expect(page.getByRole('button', { name: '展开阅读地图' })).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/moshu-qa/tablet-reading.png' });
});
