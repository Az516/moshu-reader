import type { Page } from '@playwright/test';
import type { DialogueFile } from '../../src/features/reading-modes/dialogue-history';
import { expect, test } from '../fixtures/base';
import { SAMPLE_EPUB } from '../fixtures/books';
import { connectThematicAI, startThematicAI } from '../fixtures/ai';
import { LibraryPage } from '../pages/LibraryPage';

test.use({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' });

async function revealTools(page: Page) {
  await page.mouse.move(720, 6);
  await expect(page.locator('.moshu-topbar')).toHaveCSS('opacity', '1');
}

async function visibleProse(page: Page) {
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
          const x = frame.left + rect.left + 20;
          const y = frame.top + rect.top + rect.height / 2;
          if (
            rect.width > 220 &&
            rect.height < 50 &&
            x > bounds.left &&
            x < bounds.right - 220 &&
            y > bounds.top + 130 &&
            y < bounds.bottom - 180
          )
            return { x, y };
        }
      }
    }
    return null;
  });
}

/** Inspect only the ordinary-dialogue file in the browser's local filesystem. */
async function savedDialogues(page: Page): Promise<DialogueFile | null> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('AppFileSystem', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
        const request = database.transaction('files').objectStore('files').getAllKeys();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const path = keys.find(
        (key) => typeof key === 'string' && key.endsWith('/reading-dialogues.json'),
      );
      if (!path) return null;
      const file = await new Promise<{ content: string }>((resolve, reject) => {
        const request = database.transaction('files').objectStore('files').get(path);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return JSON.parse(file.content);
    } finally {
      database.close();
    }
  });
}

test('普通对话关闭和刷新后，从本书历史恢复原选文、CFI、问题与回答', async ({ page }) => {
  test.setTimeout(120_000);
  const ai = await startThematicAI();
  const errors: string[] = [];
  const externalRequests: string[] = [];
  let modelRequests = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.url().startsWith(ai.baseURL) && request.method() === 'POST') modelRequests++;
  });
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
  try {
    const library = new LibraryPage(page);
    await library.goto();
    await library.importBook(SAMPLE_EPUB);
    await library.openFirstBook();
    await page.getByRole('button', { name: /主题阅读/ }).click();
    await connectThematicAI(page, ai.baseURL);
    await page.getByRole('button', { name: '回到正文', exact: true }).click();
    await revealTools(page);
    await page.getByRole('button', { name: '目录', exact: true }).click();
    await page.getByText('Chapter 1 - Down the Rabbit Hole', { exact: true }).first().click();
    await expect.poll(() => visibleProse(page)).not.toBeNull();
    const point = (await visibleProse(page))!;
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 185, point.y, { steps: 9 });
    await page.mouse.up();
    const selection = await page.evaluate(() => {
      const view = document.querySelector('foliate-view') as HTMLElement & {
        renderer: { getContents(): { doc: Document; index: number }[] };
        getCFI(index: number, range: Range): string;
      };
      for (const { doc, index } of view.renderer.getContents()) {
        const selected = doc.getSelection();
        if (selected && !selected.isCollapsed && selected.rangeCount)
          return {
            excerpt: selected.toString().trim(),
            cfi: view.getCFI(index, selected.getRangeAt(0)),
          };
      }
      return null;
    });
    expect(selection?.excerpt.length).toBeGreaterThan(5);
    await page
      .locator('.selection-popup')
      .getByRole('button', { name: /^呼叫小墨/ })
      .click();
    const chat = page.locator('[data-modian-dialogue]');
    await expect(chat).toBeVisible();
    await chat.locator('.modian-dialogue-context summary').click();
    await expect(chat.locator('.modian-dialogue-context blockquote')).toHaveText(
      selection!.excerpt,
    );
    const question = '这段原文怎样描写 Alice 的行动？';
    await chat.getByLabel('输入消息', { exact: true }).fill(question);
    await chat.getByRole('button', { name: '发送', exact: true }).click();
    await expect(chat.getByText('来源已核对', { exact: true })).toBeVisible();
    await expect(chat.getByText('对话已保存在本机', { exact: true })).toBeVisible();
    const saved = await savedDialogues(page);
    const conversation = saved!.conversations.find((item) =>
      item.messages.some((message) => message.text === question),
    )!;
    expect(conversation.source.cfi).toBe(selection!.cfi);
    expect(conversation.source.excerpt).toBe(selection!.excerpt);
    expect(conversation.messages.at(-1)?.status).toBe('complete');
    const answer = await chat.locator('.modian-message.is-assistant .moshu-answer').innerText();
    const requestCount = modelRequests;
    expect(requestCount).toBeGreaterThanOrEqual(2);
    await chat.getByRole('button', { name: '关闭对话', exact: true }).click();
    await expect(chat).toBeHidden();
    await page.reload();
    await expect(page.locator('foliate-view')).toBeVisible();
    await revealTools(page);
    await page.locator('.moshu-dialogue-entry').click();
    await expect(chat).toBeVisible();
    await chat.getByRole('button', { name: '本书对话历史', exact: true }).click();
    await chat
      .getByRole('region', { name: '本书对话历史', exact: true })
      .getByRole('button', { name: new RegExp(question) })
      .click();
    await chat.locator('.modian-dialogue-context summary').click();
    await expect(chat.locator('.modian-dialogue-context blockquote')).toHaveText(
      selection!.excerpt,
    );
    await expect(chat.locator('.modian-message.is-user')).toHaveText(question);
    await expect(chat.locator('.modian-message.is-assistant .moshu-answer')).toHaveText(answer);
    expect(
      (await savedDialogues(page))!.conversations.find((item) => item.id === conversation.id)
        ?.source,
    ).toEqual(conversation.source);
    expect(modelRequests).toBe(requestCount);
    expect(externalRequests).toEqual([]);
    expect(errors).toEqual([]);
    await page.screenshot({ path: test.info().outputPath('restored-local-dialogue.png') });
  } finally {
    await ai.close();
  }
});
