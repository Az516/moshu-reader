import { expect, test } from '../fixtures/base';
import { SAMPLE_EPUB } from '../fixtures/books';
import { LibraryPage } from '../pages/LibraryPage';

test.use({ viewport: { width: 1224, height: 768 }, locale: 'en-US' });

test('阅读操作入口随窗格宽度重排，窄窗仍可打开目录、笔记和对话', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const library = new LibraryPage(page);
  await library.goto();
  await library.importBook(SAMPLE_EPUB);
  await library.openFirstBook();
  await page.getByRole('button', { name: /分析阅读/ }).click();
  await expect(page.locator('foliate-view')).toBeVisible();
  await page.getByLabel('显示阅读工具栏', { exact: true }).click();
  await page.getByRole('button', { name: '固定工具栏', exact: true }).click();
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Sidebar', exact: true })
    .getByText('Chapter 1 - Down the Rabbit Hole', { exact: true })
    .click();

  for (const [width, height] of [
    [1224, 768],
    [1440, 900],
    [390, 844],
    [360, 740],
  ]) {
    await page.setViewportSize({ width: width!, height: height! });
    if (width! < 640) {
      const sidebar = page.getByRole('navigation', { name: 'Sidebar', exact: true });
      if (await sidebar.isVisible()) {
        await sidebar.getByRole('button', { name: 'Close', exact: true }).click();
        await expect(sidebar).toBeHidden();
      }
    }
    const actions = page.getByRole('group', { name: '笔记与对话' });
    const notes = actions.getByRole('button', { name: /笔记与疑问/ });
    const dialogue = actions.getByRole('button', { name: /呼叫小墨/ });
    await expect(actions).toBeVisible();
    await expect(notes).toBeInViewport({ ratio: 1 });
    await expect(dialogue).toBeInViewport({ ratio: 1 });
    await expect
      .poll(async () => {
        const a = await notes.boundingBox(),
          b = await dialogue.boundingBox();
        if (!a || !b) return false;
        return (
          a.x + a.width + 7 <= b.x ||
          b.x + b.width + 7 <= a.x ||
          a.y + a.height + 7 <= b.y ||
          b.y + b.height + 7 <= a.y
        );
      })
      .toBe(true);
    await notes.click({ trial: true });
    await dialogue.click({ trial: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.screenshot({ path: '/tmp/moshu-reader-actions-360.png' });

  await page.getByRole('button', { name: /笔记与疑问/ }).click();
  const notesDialog = page.getByRole('dialog', { name: '存疑与思考' });
  await expect(notesDialog).toBeVisible();
  await page.getByRole('button', { name: '关闭思考', exact: true }).click();
  await page.getByRole('button', { name: /呼叫小墨/ }).click();
  const conversation = page.getByRole('dialog', { name: '与小墨对话' });
  await expect(conversation).toBeVisible();
  await expect(conversation.getByLabel('输入消息')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(conversation).toBeHidden();
  await page.getByRole('button', { name: '目录', exact: true }).click();
  const sidebar = page.getByRole('navigation', { name: 'Sidebar', exact: true });
  await expect(sidebar).toBeVisible();
  await sidebar.getByText('Chapter 1 - Down the Rabbit Hole', { exact: true }).click();
  await expect(page.locator('foliate-view')).toBeVisible();
  expect(errors).toEqual([]);
});
