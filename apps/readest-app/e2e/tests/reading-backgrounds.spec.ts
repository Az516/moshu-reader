import { expect, test } from '../fixtures/base';
import { SAMPLE_TXT } from '../fixtures/books';
import { LibraryPage } from '../pages/LibraryPage';

test.use({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });

test('阅读背景色票、页面和正文保持一致，重开保留选择', async ({ page }) => {
  test.setTimeout(120_000);
  const runtimeErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const library = new LibraryPage(page);
  await library.goto();
  await library.importBook(SAMPLE_TXT);
  await library.openFirstBook();
  await page.getByRole('button', { name: /分析阅读/ }).click();
  await page.getByLabel('显示阅读工具栏', { exact: true }).click();
  await page.getByRole('button', { name: '固定工具栏', exact: true }).click();
  await expect(page.locator('.foliate-viewer iframe').first()).toBeAttached();

  const choices = [
    ['纯白', '#ffffff', 'rgb(255, 255, 255)'],
    ['淡米白', '#faf8f3', 'rgb(250, 248, 243)'],
    ['冷白', '#f5f7fa', 'rgb(245, 247, 250)'],
    ['雾灰', '#eff0f1', 'rgb(239, 240, 241)'],
    ['灰绿', '#edf3ed', 'rgb(237, 243, 237)'],
    ['淡青', '#edf5f3', 'rgb(237, 245, 243)'],
    ['雾蓝', '#eef3f8', 'rgb(238, 243, 248)'],
    ['浅紫', '#f3eff8', 'rgb(243, 239, 248)'],
    ['淡粉', '#faf0f2', 'rgb(250, 240, 242)'],
    ['夜间', '#222222', 'rgb(34, 34, 34)'],
  ] as const;

  for (const [label, hex, rgb] of choices) {
    await page.getByRole('button', { name: '阅读背景', exact: true }).click();
    const menu = page.getByRole('menu', { name: '阅读背景' });
    await expect(menu.getByRole('radio')).toHaveCount(10);
    const option = menu.getByRole('radio', { name: label, exact: true });
    await expect(option.locator('.moshu-paper-swatch')).toHaveCSS('background-color', rgb);
    await option.click();
    await expect(page.locator('.moshu-root')).toHaveCSS('background-color', rgb);
    // Read the real Foliate iframe's injected CSS and the visible full-page
    // background painted by its paginator, not only the surrounding shell.
    await expect
      .poll(async () =>
        page
          .locator('.foliate-viewer iframe')
          .first()
          .evaluate((frame) => {
            const doc = (frame as HTMLIFrameElement).contentDocument;
            return doc?.defaultView
              ?.getComputedStyle(doc.documentElement)
              .getPropertyValue('--theme-bg-color')
              .trim();
          }),
      )
      .toBe(hex);
    await expect(page.locator('foliate-paginator #background')).toHaveCSS('background-color', rgb);
    await page.getByRole('button', { name: '阅读背景', exact: true }).click();
    await expect(menu.getByRole('radio', { name: label, exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(menu.locator('[role="radio"][aria-checked="true"]')).toHaveCount(1);
    if (label === '纯白' || label === '夜间') {
      await page.screenshot({ path: test.info().outputPath(`paper-${label}.png`) });
    }
    await page.getByRole('button', { name: '阅读背景', exact: true }).click();
  }

  await page.getByRole('button', { name: '阅读背景', exact: true }).click();
  await page.getByRole('radio', { name: '淡米白', exact: true }).click();
  await page.reload();
  await expect(page.locator('.moshu-root')).toHaveCSS('background-color', 'rgb(250, 248, 243)');
  await expect(page.locator('foliate-paginator #background')).toHaveCSS(
    'background-color',
    'rgb(250, 248, 243)',
  );
  await page.getByRole('button', { name: '阅读背景', exact: true }).click();
  await expect(page.getByRole('radio', { name: '淡米白', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByRole('button', { name: '自定义颜色', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/reader\//);
  await expect(page.locator('nextjs-portal')).not.toContainText('Runtime Error');
  await page.screenshot({ path: test.info().outputPath('paper-ivory-desktop.png') });
  await page.getByRole('button', { name: '阅读背景', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const sidebar = page.getByRole('navigation', { name: 'Sidebar', exact: true });
  if (await sidebar.isVisible()) {
    await sidebar.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(sidebar).toBeHidden();
  }
  await page.getByRole('button', { name: '阅读背景', exact: true }).click();
  const menuBounds = await page.getByRole('menu', { name: '阅读背景' }).boundingBox();
  expect(menuBounds).not.toBeNull();
  expect(menuBounds!.x).toBeGreaterThanOrEqual(0);
  expect(menuBounds!.x + menuBounds!.width).toBeLessThanOrEqual(390);
  await expect(page.getByRole('radio', { name: '淡米白', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('paper-ivory-mobile.png') });
  expect(runtimeErrors).toEqual([]);
  await test.info().attach('console-errors', {
    body: JSON.stringify(consoleErrors, null, 2),
    contentType: 'application/json',
  });
});
