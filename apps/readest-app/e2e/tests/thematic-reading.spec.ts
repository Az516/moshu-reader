import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures/base';
import { SAMPLE_EPUB } from '../fixtures/books';
import { connectThematicAI, startThematicAI } from '../fixtures/ai';
import { LibraryPage } from '../pages/LibraryPage';

test.use({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });

async function focusStaysInside(page: Page, dialog: Locator) {
  await expect(dialog).toBeVisible();
  for (const key of ['Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Tab', 'Tab', 'Tab']) {
    await page.keyboard.press(key);
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
}

test('主题书目、引用和历史弹窗圈定焦点，历史主题恢复后保留问题与引用', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const ai = await startThematicAI();
  try {
    const library = new LibraryPage(page);
    await library.goto();
    await library.importBook(SAMPLE_EPUB);
    await library.openFirstBook();
    await page.getByRole('button', { name: /主题阅读/ }).click();
    await expect(page.getByRole('region', { name: '主题阅读工作区' })).toBeVisible();
    await connectThematicAI(page, ai.baseURL);
    await page.getByLabel('主题或问题', { exact: true }).fill('Alice 第一主题');
    await page.getByLabel('主题或问题', { exact: true }).press('Enter');
    await expect(page.getByRole('heading', { name: '第一主题回答' })).toBeVisible();
    await expect(page.getByRole('button', { name: '停止回答', exact: true })).toBeHidden();

    const sourceButton = page.getByRole('button', { name: '查看引用 1', exact: true });
    await sourceButton.click();
    const source = page.getByRole('dialog', { name: '引用来源', exact: true });
    await expect(source.locator('blockquote')).not.toBeEmpty();
    await focusStaysInside(page, source);
    await page.keyboard.press('Escape');
    await expect(source).toBeHidden();
    await expect(sourceButton).toBeFocused();

    const adjustBooks = page.getByRole('button', { name: '调整书目', exact: true });
    await adjustBooks.click();
    const books = page.getByRole('dialog', { name: '调整研究书目', exact: true });
    await expect(books.getByRole('checkbox')).toHaveCount(1);
    await expect(books.getByRole('checkbox')).toBeChecked();
    await focusStaysInside(page, books);
    await page.keyboard.press('Escape');
    await expect(books).toBeHidden();
    await expect(adjustBooks).toBeFocused();

    const more = page.getByLabel('更多主题阅读操作', { exact: true });
    await page
      .getByTestId('thematic-history-panel')
      .getByRole('button', { name: '新主题', exact: true })
      .click();
    await page.getByLabel('主题或问题', { exact: true }).fill('Alice 第二主题');
    await page.getByLabel('主题或问题', { exact: true }).press('Enter');
    await expect(page.getByRole('heading', { name: '第二主题回答' })).toBeVisible();
    await expect(page.getByRole('button', { name: '停止回答', exact: true })).toBeHidden();
    await more.click();
    await page.getByRole('button', { name: '历史主题', exact: true }).click();
    const history = page.getByRole('dialog', { name: '历史主题', exact: true });
    await expect(history.getByRole('button', { name: /Alice 第一主题/ })).toBeVisible();
    await focusStaysInside(page, history);
    await page.keyboard.press('Escape');
    await expect(history).toBeHidden();
    await expect(more).toBeFocused();
    await more.click();
    await page.getByRole('button', { name: '历史主题', exact: true }).click();
    await history.getByRole('button', { name: /Alice 第一主题/ }).click();
    await expect(history).toBeHidden();
    await expect(page.getByRole('heading', { name: '第一主题回答' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '第二主题回答' })).toBeHidden();
    await page.reload();
    await expect(page.getByRole('heading', { name: '第一主题回答' })).toBeVisible();
    await sourceButton.click();
    await expect(source.locator('blockquote')).not.toBeEmpty();
    expect(errors).toEqual([]);
  } finally {
    await ai.close();
  }
});
