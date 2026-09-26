import { expect, test } from '../fixtures/base';
import { SAMPLE_EPUB } from '../fixtures/books';
import { LibraryPage } from '../pages/LibraryPage';

test.use({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });

test('分析阅读的跟随和纸张设置可操作，重开保留阅读模式及纸张', async ({ page }) => {
  const library = new LibraryPage(page);
  await library.goto();
  await library.importBook(SAMPLE_EPUB);
  await library.openFirstBook();
  await page.getByRole('button', { name: /分析阅读/ }).click();
  await page.getByLabel('显示阅读工具栏', { exact: true }).click();
  await page.getByRole('button', { name: '固定工具栏', exact: true }).click();
  const follow = page.getByRole('button', { name: /字句跟随/ });
  if ((await follow.getAttribute('aria-pressed')) !== 'true') await follow.click();
  await expect(follow).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '阅读背景', exact: true }).click();
  await page.getByRole('radio', { name: '纯白', exact: true }).click();
  await expect(page.locator('.moshu-root')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await follow.click();
  await expect(follow).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: /切换模式/ }).click();
  await page.getByRole('button', { name: /快速阅读/ }).click();
  await expect(page.locator('.moshu-root')).toHaveAttribute('data-mode', 'quick');
  await page.getByRole('button', { name: /切换模式/ }).click();
  await page.getByRole('button', { name: /分析阅读/ }).click();
  await expect(page.locator('.moshu-root')).toHaveAttribute('data-mode', 'analytical');
  await page.reload();
  await expect(page.locator('.moshu-root')).toHaveAttribute('data-mode', 'analytical');
  await expect(page.locator('foliate-view')).toBeVisible();
  await expect(page.locator('.moshu-root')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
});
