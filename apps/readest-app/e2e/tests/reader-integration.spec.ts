import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/base';
import { SAMPLE_EPUB } from '../fixtures/books';
import { LibraryPage } from '../pages/LibraryPage';

test.use({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' });
async function open(page: Page, mode = '快速阅读') {
  const library = new LibraryPage(page);
  await library.goto();
  await library.importBook(SAMPLE_EPUB);
  await library.openFirstBook();
  await page.getByRole('button', { name: new RegExp(mode) }).click();
}
async function tools(page: Page) {
  await page.mouse.move((page.viewportSize()?.width ?? 1440) / 2, 6);
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
      for (const p of doc.querySelectorAll('p')) {
        if ((p.textContent || '').length < 70) continue;
        const range = doc.createRange();
        range.selectNodeContents(p);
        for (const rect of range.getClientRects()) {
          const x = frame.left + rect.left + 20,
            y = frame.top + rect.top + rect.height / 2;
          if (
            rect.width > 150 &&
            rect.height < 50 &&
            x > bounds.left &&
            x < bounds.right - 100 &&
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
async function capture(page: Page, file: string) {
  await mkdir('/tmp/moshu-integration', { recursive: true });
  await page.screenshot({ path: `/tmp/moshu-integration/${file}.png` });
}

test('reader: stable viewport, explicit dwell marks, and single/double page round trip', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  await tools(page);
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await page.getByText('Chapter 1 - Down the Rabbit Hole', { exact: true }).first().click();
  await expect.poll(() => prose(page)).not.toBeNull();
  const point = (await prose(page))!;
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('[data-sentence-guide]')).toHaveCSS('visibility', 'visible');
  await expect(page.locator('[data-sentence-guide]')).toHaveText('');
  const viewport = await page.locator('foliate-view').boundingBox();
  await expect(page.getByLabel('停留提醒', { exact: true })).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-question-highlight]')).toHaveCount(0);
  await capture(page, 'dwell-before-mark');
  await page.getByRole('button', { name: '在这里停了一会，要记点什么吗？' }).click();
  await page.getByRole('radio', { name: '字 横线' }).click();
  await page.getByRole('button', { name: '留下疑问', exact: true }).click();
  await expect(page.locator('[data-question-highlight]')).not.toHaveCount(0);
  await tools(page);
  expect(await page.locator('foliate-view').boundingBox()).toEqual(viewport);
  await page.getByRole('button', { name: '双页', exact: true }).click();
  await expect(page.getByRole('button', { name: '双页', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await capture(page, 'double-page');
  await page.getByRole('button', { name: '单页', exact: true }).click();
  await expect(page.getByRole('button', { name: '单页', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const marksInBounds = await page.evaluate(() => {
    const view = document.querySelector('foliate-view')!.getBoundingClientRect();
    return [...document.querySelectorAll('[data-question-highlight]')].every((mark) => {
      const r = mark.getBoundingClientRect();
      return r.left >= view.left && r.right <= view.right + 1;
    });
  });
  expect(marksInBounds).toBe(true);
  await expect(page.getByRole('contentinfo', { name: 'Footer Bar', exact: true })).toHaveCount(0);
  await capture(page, 'single-page');
  await page.setViewportSize({ width: 390, height: 844 });
  const sidebar = page.getByRole('navigation', { name: 'Sidebar', exact: true });
  await expect(sidebar).toBeVisible();
  await sidebar.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(sidebar).toBeHidden();
  await tools(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await capture(page, 'compact-reader');
  expect(errors).toEqual([]);
});

test('native parallel reading: active pane controls and closing one book', async ({ page }) => {
  await open(page);
  await tools(page);
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await page.getByRole('button', { name: 'Book Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Parallel Read', exact: true }).click();
  await page
    .locator('.book-menu')
    .getByText("Alice's Adventures in Wonderland", { exact: true })
    .click();
  await expect(page.locator('foliate-view')).toHaveCount(2);
  const panes = page.locator('[data-book-pane]');
  await expect(panes).toHaveCount(2);
  await panes.nth(1).getByRole('button', { name: '选择阅读窗格' }).click();
  await expect(panes.nth(1).getByRole('button', { name: '选择阅读窗格' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await tools(page);
  await page.getByRole('button', { name: '单页', exact: true }).click();
  await expect(page.locator('foliate-view').nth(1).locator('foliate-paginator')).toHaveAttribute(
    'max-column-count',
    '1',
  );
  await panes.nth(0).getByRole('button', { name: '选择阅读窗格' }).click();
  await expect(page.getByRole('button', { name: '双页', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await panes.nth(1).getByRole('button', { name: '关闭此阅读窗格' }).click();
  await expect(page.locator('foliate-view')).toHaveCount(1);
  await capture(page, 'parallel-return');
});

test('selection: native toolbar opens dialogue and an anchored note survives reopening', async ({
  page,
}) => {
  await open(page, '分析阅读');
  await tools(page);
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await page.getByText('Chapter 1 - Down the Rabbit Hole', { exact: true }).first().click();
  await expect.poll(() => prose(page)).not.toBeNull();
  const point = (await prose(page))!;
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 185, point.y, { steps: 9 });
  await page.mouse.up();
  const toolbar = page.locator('.selection-popup');
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole('button', { name: /^Copy/ })).toHaveCount(0);
  await toolbar.getByRole('button', { name: /^呼叫小墨/ }).click();
  const chat = page.locator('[data-modian-dialogue]');
  await expect(chat).toBeVisible();
  await chat.locator('summary').first().click();
  const quotation = await chat.locator('blockquote').innerText();
  expect(quotation.length).toBeGreaterThan(5);
  await chat.getByLabel('输入消息', { exact: true }).fill('好奇心让她行动起来。这是我的阅读笔记。');
  await chat.getByRole('button', { name: '标记笔记', exact: true }).click();
  await expect(chat.getByRole('status')).toContainText('已标记为笔记');
  await chat.getByRole('button', { name: '关闭对话', exact: true }).click();
  await page.reload();
  await tools(page);
  await page.locator('.moshu-question-entry').click();
  const notes = page.getByRole('dialog', { name: '存疑与思考', exact: true });
  await expect(notes).toContainText('好奇心让她行动起来。这是我的阅读笔记。');
  await expect(notes.locator('blockquote')).toHaveText(quotation);
  await notes.getByRole('button', { name: '回到原文', exact: true }).click();
  await expect(notes).toBeHidden();
});

test('thematic: true SSE streaming, formatted output, stop/retry, citations and reload', async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const server = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'fixture', name: 'Local fixture' }] }));
      return;
    }
    let body = '';
    req.on('data', (part: Buffer) => {
      body += part.toString();
    });
    req.on('end', () => {
      const request = JSON.parse(body) as { messages: { role: string; content: string }[] };
      const system = request.messages.find((message) => message.role === 'system')?.content || '';
      const metadata = system.includes('同义表达')
        ? '{"queries":["Alice"]}'
        : system.includes('筛选候选')
          ? '{"matches":[{"index":1,"relevance":"direct"}]}'
          : system.includes('corrections')
            ? '{"corrections":[]}'
            : null;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const chunks = metadata
        ? [metadata]
        : [
            '## 阅读中的人生\n\n',
            '**测试输出**：原文提供了观察人物行动的角度。[1]\n\n',
            '- 第一条观察\n- 第二条观察\n\n',
            '> 这是本地协议模拟，用于验证排版。\n',
          ];
      let index = 0;
      const timer = setInterval(
        () => {
          if (index < chunks.length)
            res.write(
              `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: { content: chunks[index++] }, finish_reason: null }] })}\n\n`,
            );
          else {
            clearInterval(timer);
            res.end('data: [DONE]\n\n');
          }
        },
        metadata ? 10 : 650,
      );
      res.on('close', () => clearInterval(timer));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await open(page, '主题阅读');
    await tools(page);
    await page.getByLabel('更多主题阅读操作', { exact: true }).click();
    await page.getByRole('button', { name: '小墨设置', exact: true }).click();
    await page.locator('[data-reading-ai-config] summary').click();
    await page
      .getByLabel('服务地址', { exact: true })
      .fill(`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`);
    await page.getByLabel('模型名称', { exact: true }).fill('fixture');
    await page.getByLabel('API Key', { exact: true }).fill('local-test-only');
    await page.getByRole('button', { name: '保存连接', exact: true }).click();
    await expect(
      page.getByText('配置已保存。提问时只发送所选片段和必要邻文。', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: '关闭设置', exact: true }).click();
    await page.getByRole('button', { name: '自动联网已开启', exact: true }).click();
    await page.getByLabel('主题或问题', { exact: true }).fill('Alice');
    await page.getByLabel('主题或问题', { exact: true }).press('Enter');
    await expect(page.getByRole('heading', { name: '阅读中的人生' })).toBeVisible();
    await expect(page.getByRole('button', { name: '停止回答', exact: true })).toBeVisible();
    await expect(page.locator('.thematic-workspace textarea')).toHaveCount(1);
    await expect(page.getByRole('button', { name: '发送追问', exact: true })).toBeVisible();
    await expect(page.locator('.moshu-answer strong')).toHaveText('测试输出');
    await expect(page.locator('.moshu-answer li')).toHaveCount(2);
    await capture(page, 'thematic-formatted');
    await expect(page.locator('.moshu-answer')).toHaveCSS('font-weight', '400');
    const answerBounds = (await page.locator('.moshu-answer').boundingBox())!;
    const conversationBounds = (await page.locator('.thematic-main').boundingBox())!;
    const historyBounds = (await page.getByTestId('thematic-history-panel').boundingBox())!;
    // The selected two-column layout lets prose expand with the right pane.
    // Keep it inside that pane and clear of the persistent history sidebar.
    expect(answerBounds.x).toBeGreaterThanOrEqual(conversationBounds.x);
    expect(answerBounds.x + answerBounds.width).toBeLessThanOrEqual(
      conversationBounds.x + conversationBounds.width,
    );
    expect(answerBounds.x).toBeGreaterThanOrEqual(historyBounds.x + historyBounds.width);
    const composerBounds = (await page.locator('.thematic-composer').boundingBox())!;
    expect(conversationBounds.y + conversationBounds.height).toBeLessThanOrEqual(composerBounds.y);
    await page.getByRole('button', { name: '查看引用 1', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '引用来源' })).toBeVisible();
    await capture(page, 'thematic-citation');
    await page.getByRole('button', { name: '在书中打开' }).click();
    await expect(page.getByRole('button', { name: '返回主题对话' })).toBeVisible();
    const located = page.locator('.moshu-source-located');
    await expect(located).toBeVisible();
    await expect(located).toContainText('已定位');
    await capture(page, 'thematic-source-located');
    await page.getByRole('button', { name: '返回主题对话' }).click();
    await expect(page.getByRole('heading', { name: '阅读中的人生' })).toBeVisible();
    await page.getByLabel('继续追问', { exact: true }).fill('Alice 的选择');
    await page.getByLabel('继续追问', { exact: true }).press('Shift+Enter');
    await expect(page.getByLabel('继续追问', { exact: true })).toHaveValue('Alice 的选择\n');
    await page.getByLabel('继续追问', { exact: true }).press('Enter');
    await expect(
      page.locator('.thematic-message.is-modian').last().getByRole('heading'),
    ).toBeVisible();
    await page.getByRole('button', { name: '停止回答', exact: true }).click();
    await expect(page.getByText('已停止 · 已保留生成内容', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '重新回答', exact: true }).click();
    await expect(page.getByRole('button', { name: '发送追问', exact: true })).toBeVisible();
    await expect(page.locator('.thematic-message.is-user')).toHaveCount(2);
    await page.reload();
    await expect(page.getByRole('heading', { name: '阅读中的人生' })).toHaveCount(2);
    await page.setViewportSize({ width: 600, height: 850 });
    await capture(page, 'compact-thematic');
    await page.setViewportSize({ width: 390, height: 844 });
    await capture(page, 'mobile-thematic');
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
