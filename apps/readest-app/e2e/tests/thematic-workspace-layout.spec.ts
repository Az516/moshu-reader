import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/base';
import { connectThematicAI, startThematicAI } from '../fixtures/ai';
import { SAMPLE_EPUB } from '../fixtures/books';
import { LibraryPage } from '../pages/LibraryPage';

test.use({ viewport: { width: 1280, height: 800 }, locale: 'en-US', colorScheme: 'light' });

async function openThematic(page: Page) {
  const errors: string[] = [];
  const externalRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      !['localhost', '127.0.0.1'].includes(url.hostname)
    ) {
      externalRequests.push(`${url.origin}${url.pathname}`);
      await route.abort();
    } else await route.continue();
  });
  const library = new LibraryPage(page);
  await library.goto();
  await library.importBook(SAMPLE_EPUB);
  await library.openFirstBook();
  await page.getByRole('button', { name: /主题阅读/ }).click();
  const workspace = page.getByTestId('thematic-workspace');
  await expect(workspace).toBeVisible();
  return { workspace, errors, externalRequests };
}

async function askTopic(page: Page, topic: string, answerHeading: string) {
  const question = page.getByLabel('主题或问题', { exact: true });
  await question.fill(topic);
  await question.press('Enter');
  await expect(page.getByRole('heading', { name: answerHeading, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '停止回答', exact: true })).toBeHidden();
}

test('桌面历史常驻左侧，搜索后切换主题并刷新仍保留原问答和引用', async ({ page }) => {
  test.setTimeout(120_000);
  const ai = await startThematicAI();
  let modelRequests = 0;
  page.on('request', (request) => {
    if (request.url().startsWith(ai.baseURL) && request.method() === 'POST') modelRequests++;
  });
  try {
    const { workspace, errors, externalRequests } = await openThematic(page);
    const history = page.getByTestId('thematic-history-panel');
    await expect(history).toBeVisible();
    await connectThematicAI(page, ai.baseURL);
    await askTopic(page, 'Alice 第一主题', '第一主题回答');
    await history.getByRole('button', { name: '新主题', exact: true }).click();
    await askTopic(page, 'Alice 第二主题', '第二主题回答');

    const search = history.getByLabel('搜索主题历史', { exact: true });
    await search.fill('不存在的测试主题');
    await expect(history.getByRole('button', { name: /Alice/ })).toHaveCount(0);
    await search.fill('第一主题');
    await expect(history.getByRole('button', { name: /Alice 第一主题/ })).toHaveCount(1);
    await expect(history.getByRole('button', { name: /Alice 第二主题/ })).toHaveCount(0);
    const requestsBeforeRestore = modelRequests;
    expect(requestsBeforeRestore).toBeGreaterThan(0);
    await history.getByRole('button', { name: /Alice 第一主题/ }).click();
    await expect(workspace.getByRole('heading', { name: '第一主题回答' })).toBeVisible();
    await expect(workspace.getByRole('heading', { name: '第二主题回答' })).toBeHidden();
    await expect(history.locator('[aria-current="page"]')).toContainText('Alice 第一主题');

    const historyBox = await history.boundingBox();
    const conversationBox = await workspace.getByRole('region', { name: '主题对话' }).boundingBox();
    expect(historyBox).not.toBeNull();
    expect(conversationBox).not.toBeNull();
    expect(historyBox!.x + historyBox!.width).toBeLessThanOrEqual(conversationBox!.x);

    await page.reload();
    await expect(workspace.getByRole('heading', { name: '第一主题回答' })).toBeVisible();
    await expect(history.locator('[aria-current="page"]')).toContainText('Alice 第一主题');
    await workspace.getByRole('button', { name: '查看引用 1', exact: true }).click();
    const source = page.getByRole('dialog', { name: '引用来源', exact: true });
    await expect(source.locator('blockquote')).not.toBeEmpty();
    await page.keyboard.press('Escape');
    await expect(source).toBeHidden();
    expect(modelRequests).toBe(requestsBeforeRestore);
    expect(errors).toEqual([]);
    expect(externalRequests).toEqual([]);
    await page.screenshot({ path: test.info().outputPath('desktop-restored-history.png') });
  } finally {
    await ai.close();
  }
});

test('亮暗选择刷新后保留，自动模式跟随系统变化并恢复偏好', async ({ page }) => {
  const { workspace, errors, externalRequests } = await openThematic(page);
  const appearance = workspace.getByRole('radiogroup', { name: '主题外观', exact: true });
  const light = appearance.getByRole('radio', { name: '亮色', exact: true });
  const dark = appearance.getByRole('radio', { name: '暗色', exact: true });
  const automatic = appearance.getByRole('radio', { name: '跟随系统', exact: true });

  await light.click();
  await expect(light).toHaveAttribute('aria-checked', 'true');
  await expect(workspace).toHaveAttribute('data-appearance', 'light');
  const lightBackground = await workspace.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await dark.click();
  await expect(dark).toHaveAttribute('aria-checked', 'true');
  await expect(workspace).toHaveAttribute('data-appearance-preference', 'dark');
  await expect(workspace).toHaveAttribute('data-appearance', 'dark');
  await expect
    .poll(() => workspace.evaluate((element) => getComputedStyle(element).backgroundColor))
    .not.toBe(lightBackground);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.reload();
  await expect(dark).toHaveAttribute('aria-checked', 'true');
  await expect(workspace).toHaveAttribute('data-appearance', 'dark');
  await page.screenshot({ path: test.info().outputPath('appearance-dark.png') });

  await automatic.click();
  await expect(automatic).toHaveAttribute('aria-checked', 'true');
  await expect(workspace).toHaveAttribute('data-appearance-preference', 'auto');
  await expect(workspace).toHaveAttribute('data-appearance', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(workspace).toHaveAttribute('data-appearance', 'dark');
  await page.reload();
  await expect(automatic).toHaveAttribute('aria-checked', 'true');
  await expect(workspace).toHaveAttribute('data-appearance-preference', 'auto');
  await expect(workspace).toHaveAttribute('data-appearance', 'dark');

  await light.click();
  await page.reload();
  await expect(light).toHaveAttribute('aria-checked', 'true');
  await expect(workspace).toHaveAttribute('data-appearance-preference', 'light');
  await expect(workspace).toHaveAttribute('data-appearance', 'light');
  await expect(workspace).toHaveCSS('background-color', lightBackground);
  await page.screenshot({ path: test.info().outputPath('appearance-light.png') });
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
});

test('窄窗历史抽屉可关闭，Escape返回触发按钮且不遮挡提问', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { workspace, errors, externalRequests } = await openThematic(page);
  const open = workspace.getByRole('button', { name: '打开主题历史', exact: true });
  const drawer = page.getByRole('dialog', { name: '主题历史', exact: true });
  await expect(drawer).toBeHidden();
  await expect(open).toBeInViewport({ ratio: 1 });
  await open.click();
  await expect(drawer).toBeVisible();
  await expect(drawer.getByLabel('搜索主题历史', { exact: true })).toBeVisible();
  for (const key of ['Tab', 'Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await page.screenshot({ path: test.info().outputPath('mobile-history-open.png') });
  await drawer.getByRole('button', { name: '关闭主题历史', exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(open).toBeFocused();
  await open.click();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(open).toBeFocused();
  const question = workspace.getByLabel('主题或问题', { exact: true });
  await expect(question).toBeInViewport({ ratio: 1 });
  await question.fill('关闭抽屉后仍能输入主题');
  await expect(question).toHaveValue('关闭抽屉后仍能输入主题');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('mobile-history-closed.png') });
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
});
