import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/base';
import type { ReaderPage } from '../pages/ReaderPage';

test.use({ viewport: { width: 1440, height: 1000 } });

/** Isolated protocol fixture: every answer is explicitly simulated, never a paid model call. */
async function startSimulatedAI() {
  let mode: 'success' | 'failure' | 'slow' = 'success';
  const requests: { model: string; messages: { role: string; content: string }[] }[] = [];
  const server = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () => {
      requests.push(JSON.parse(body));
      if (mode === 'failure') {
        response.writeHead(503, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify({ error: { message: '本地模拟服务暂时不可用', type: 'server_error' } }),
        );
        return;
      }
      const round = requests.length;
      const pieces =
        mode === 'slow'
          ? ['【本地模拟】这条回答尚未完成。', '等待中的内容不应覆盖已保存回答。']
          : [
              '【本地模拟】选文讨论了人物的观察。',
              ' 请结合原文核对自己的表述。',
              ` 第${round}轮模拟完成。`,
            ];
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      response.flushHeaders();
      let index = 0;
      const write = () => {
        response.write(
          `data: ${JSON.stringify({ id: `fixture-${round}`, object: 'chat.completion.chunk', created: 1, model: 'local-test-model', choices: [{ index: 0, delta: { content: pieces[index] }, finish_reason: null }] })}\n\n`,
        );
        index += 1;
        if (index === pieces.length) {
          response.write(
            `data: ${JSON.stringify({ id: `fixture-${round}`, object: 'chat.completion.chunk', created: 1, model: 'local-test-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
          );
          response.end();
        }
      };
      write();
      const timer = setInterval(write, mode === 'slow' ? 10_000 : 600);
      response.on('close', () => clearInterval(timer));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    setMode: (value: typeof mode) => {
      mode = value;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

/** Real, visible text geometry only; the mouse still performs every focus-guide interaction. */
async function visibleTextLines(page: Page) {
  return page.evaluate(() => {
    const view = document.querySelector('foliate-view') as HTMLElement & {
      renderer: { getContents: () => { doc: Document }[]; columnCount: number };
    };
    if (!view) return [];
    const bounds = view.getBoundingClientRect();
    const result: { x: number; y: number; height: number }[] = [];
    for (const { doc } of view.renderer.getContents()) {
      const frame = doc.defaultView?.frameElement?.getBoundingClientRect();
      if (!frame) continue;
      for (const paragraph of doc.querySelectorAll('p')) {
        const walker = doc.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
          if ((node.textContent || '').trim().length > 20) {
            const range = doc.createRange();
            range.selectNodeContents(node);
            for (const rect of range.getClientRects()) {
              const x = frame.left + rect.left + Math.min(100, rect.width / 2);
              const y = frame.top + rect.top + rect.height / 2;
              let hit = document.elementFromPoint(x, y);
              while (hit?.shadowRoot) {
                const deeper = hit.shadowRoot.elementFromPoint(x, y);
                if (!deeper || deeper === hit) break;
                hit = deeper;
              }
              if (
                hit === doc.defaultView?.frameElement &&
                rect.width > 180 &&
                rect.height > 10 &&
                x >= frame.left &&
                x <= frame.right &&
                y >= frame.top &&
                y <= frame.bottom &&
                x > Math.max(0, bounds.left) + 20 &&
                x < Math.min(innerWidth, bounds.right) - 100 &&
                y > Math.max(100, bounds.top + 70) &&
                y < Math.min(innerHeight - 100, bounds.bottom - 70)
              ) {
                result.push({ x, y, height: rect.height });
              }
            }
          }
          node = walker.nextNode();
        }
      }
    }
    return result
      .sort((a, b) => a.y - b.y)
      .filter((line, index, lines) => index === 0 || Math.abs(line.y - lines[index - 1]!.y) > 3);
  });
}

async function selectVisibleText(page: Page, reader: ReaderPage) {
  await reader.openTocChapter(2);
  await expect.poll(async () => (await visibleTextLines(page)).length).toBeGreaterThan(3);
  const point = (await visibleTextLines(page))[2]!;
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 220, point.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.selection-popup')).toBeVisible();
}

test.describe('Active reading', () => {
  test('keeps a real EPUB reading card, anchored thoughts, questions and export across reopening', async ({
    page,
    openBook,
  }) => {
    test.setTimeout(180_000);
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    const reader = await openBook();
    const workspace = page.locator('[data-active-reading-workspace]');
    const openAssistant = async (currentReader: ReaderPage) => {
      if (!(await workspace.isVisible())) {
        await currentReader.revealHeader();
        await page.locator('button[aria-label="阅读助手"]').click();
      }
      await expect(workspace.getByRole('tab', { name: '读前', exact: true })).toBeVisible();
    };

    await expect(page).toHaveURL(/\/reader\//);
    await expect(page).toHaveTitle(/Readest|Alice/);
    await openAssistant(reader);

    const goal = '理解人物选择与故事叙述之间的关系';
    const initialThought = '通过爱丽丝的经历观察常识被改变时的反应';
    const fourQuestion = '我会区分自己的解读与书中明确写出的内容';
    const standaloneThought = '尚未关联原文的个人联想，之后再补位置';
    const anchoredThought = '这一段表现了人物面对陌生情境时的好奇与疑惑';
    const questionText = '这段里的反应与前文有什么关系？';
    const unsavedDraft = '这句是还没有保存的阅读草稿';

    await workspace.getByLabel('这是什么类型的书？').selectOption('fiction');
    await workspace.getByLabel('我为什么想读？').fill(goal);
    await workspace.getByLabel('现在看来，这本书主要讲什么？').fill(initialThought);
    await workspace.getByRole('button', { name: '保存阅读卡', exact: true }).click();
    await expect(workspace.getByRole('button', { name: '保存阅读卡', exact: true })).toBeDisabled();

    await workspace.getByRole('tab', { name: '理解', exact: true }).click();
    await workspace.locator('summary').filter({ hasText: '全书四问' }).click();
    await workspace.getByLabel('这对我有什么意义？').fill(fourQuestion);
    await workspace.getByRole('button', { name: '保存阅读卡', exact: true }).click();
    await expect(workspace.getByRole('button', { name: '保存阅读卡', exact: true })).toBeDisabled();
    await workspace.locator('summary').filter({ hasText: '全书四问' }).click();
    await workspace.getByLabel('我的理解', { exact: true }).fill(standaloneThought);
    await workspace.getByRole('button', { name: '保存我的想法' }).click();
    const standaloneRecord = workspace.locator('article').filter({ hasText: standaloneThought });
    await expect(standaloneRecord).toHaveCount(1);
    await expect(
      standaloneRecord.getByRole('button', { name: '请 AI 核对', exact: true }),
    ).toBeDisabled();

    // Use the existing real-EPUB selection helper: its text range is created
    // inside the book's iframe and travels through the actual annotation toolbar.
    await reader.closeNotebook();
    await selectVisibleText(page, reader);
    await reader.popupTool('Write my understanding').click();
    await expect(workspace.getByLabel('我的理解', { exact: true })).toBeVisible();
    const excerpt = (await workspace.locator('blockquote').first().innerText()).trim();
    expect(excerpt.length).toBeGreaterThan(20);
    await workspace.getByLabel('我的理解', { exact: true }).fill(anchoredThought);
    await workspace.getByRole('button', { name: '保存我的想法' }).click();
    const anchoredRecord = workspace.locator('article').filter({ hasText: anchoredThought });
    await expect(anchoredRecord).toHaveCount(1);
    await expect(
      anchoredRecord.getByRole('button', { name: '请 AI 核对', exact: true }),
    ).toBeEnabled();

    // A personal note without a source can acquire the selected passage later.
    await standaloneRecord.getByRole('button', { name: '关联当前选文后再核对' }).click();
    await expect(
      standaloneRecord.getByRole('button', { name: '请 AI 核对', exact: true }),
    ).toBeEnabled();
    await standaloneRecord.locator('summary').click();
    await expect(standaloneRecord.locator('blockquote')).toHaveText(excerpt);

    await workspace.getByRole('tab', { name: '疑问', exact: true }).click();
    await workspace.getByLabel('我的疑问', { exact: true }).fill(questionText);
    await workspace.getByRole('button', { name: '暂存疑问', exact: true }).click();
    const questionRecord = workspace.locator('article').filter({ hasText: questionText });
    await expect(questionRecord).toHaveCount(1);
    await questionRecord.getByRole('button', { name: '先保留', exact: true }).click();
    await expect(
      questionRecord.getByRole('button', { name: '先保留', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await questionRecord.getByRole('button', { name: '已明白', exact: true }).click();
    await expect(questionRecord).toHaveCount(0);
    await workspace.getByRole('button', { name: '显示全部' }).click();
    await expect(
      questionRecord.getByRole('button', { name: '已明白', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await questionRecord.getByRole('button', { name: '不再需要', exact: true }).click();
    await expect(
      questionRecord.getByRole('button', { name: '不再需要', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await questionRecord.getByRole('button', { name: '重新打开' }).click();
    await expect(questionRecord.getByRole('button', { name: '已明白', exact: true })).toBeEnabled();
    await questionRecord.getByRole('button', { name: '已明白', exact: true }).click();
    await expect(
      questionRecord.getByRole('button', { name: '已明白', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');

    await workspace.getByRole('tab', { name: '理解', exact: true }).click();
    await workspace.getByLabel('我的理解', { exact: true }).fill(unsavedDraft);
    await reader.closeNotebook();
    await openAssistant(reader);
    await workspace.getByRole('tab', { name: '理解', exact: true }).click();
    await expect(workspace.getByLabel('我的理解', { exact: true })).toHaveValue(unsavedDraft);
    await expect(anchoredRecord).toHaveCount(1);

    await page.reload();
    await reader.waitForReady();
    await openAssistant(reader);
    await workspace.getByRole('tab', { name: '读前', exact: true }).click();
    await expect(workspace.getByLabel('我为什么想读？')).toHaveValue(goal);
    await expect(workspace.getByLabel('现在看来，这本书主要讲什么？')).toHaveValue(initialThought);
    await expect(workspace.getByLabel('这是什么类型的书？')).toHaveValue('fiction');
    await page.screenshot({ path: path.join(tmpdir(), 'active-reading-profile.png') });

    await workspace.getByRole('tab', { name: '理解', exact: true }).click();
    await expect(workspace.getByLabel('我的理解', { exact: true })).toHaveValue(unsavedDraft);
    await workspace.locator('summary').filter({ hasText: '全书四问' }).click();
    await expect(workspace.getByLabel('这对我有什么意义？')).toHaveValue(fourQuestion);
    await workspace.locator('summary').filter({ hasText: '全书四问' }).click();
    await expect(anchoredRecord).toHaveCount(1);
    await anchoredRecord.locator('summary').click();
    await expect(anchoredRecord.locator('blockquote')).toHaveText(excerpt);
    await page.screenshot({ path: path.join(tmpdir(), 'active-reading-saved-thought.png') });

    await workspace.getByRole('tab', { name: '疑问', exact: true }).click();
    await workspace.getByRole('button', { name: '显示全部' }).click();
    await expect(
      questionRecord.getByRole('button', { name: '已明白', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');

    await workspace.getByRole('tab', { name: '回顾', exact: true }).click();
    await workspace.getByLabel('也可以回顾之前留下的内容').selectOption({ index: 1 });
    await expect(workspace.locator('form blockquote')).toHaveCount(0);
    await workspace
      .getByLabel('我的回忆', { exact: true })
      .fill('我记得这段描写了人物观察与反应的过程');
    await workspace.getByRole('button', { name: '展开原文' }).click();
    await expect(workspace.locator('form blockquote')).toHaveText(excerpt);
    await workspace.getByRole('button', { name: '保存这次回忆' }).click();
    await expect(
      workspace.locator('article').filter({ hasText: '我记得这段描写了人物观察与反应的过程' }),
    ).toHaveCount(1);
    await page.screenshot({ path: path.join(tmpdir(), 'active-reading-review.png') });

    const downloadPromise = page.waitForEvent('download');
    await workspace.getByRole('button', { name: '导出 Markdown' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/阅读记录\.md$/);
    const exportPath = path.join(tmpdir(), 'active-reading-export.md');
    await download.saveAs(exportPath);
    const markdown = await readFile(exportPath, 'utf8');
    expect(markdown).toContain(goal);
    expect(markdown).toContain(fourQuestion);
    expect(markdown).toContain(anchoredThought);
    expect(markdown).toContain(questionText);
    expect(markdown).toContain('### 原文');
    expect(markdown).toContain('### 我的内容');
    expect(markdown.replace(/^> ?/gm, '')).toContain(excerpt);
    expect(markdown).toMatch(/原文位置（EPUB CFI）：epubcfi\(/);
    expect(markdown).toMatch(/书籍版本标识：[a-f0-9]+/i);
    expect(markdown).not.toContain(unsavedDraft);

    await expect(page.locator('nextjs-portal [data-nextjs-dialog-overlay]')).toBeHidden();
    await writeFile(
      path.join(tmpdir(), 'active-reading-browser-errors.json'),
      JSON.stringify({ pageErrors, consoleErrors }, null, 2),
    );
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('streams a local simulated answer, preserves prior inputs and survives failed or stopped requests', async ({
    page,
    openBook,
  }) => {
    test.setTimeout(180_000);
    const fixture = await startSimulatedAI();
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const original = '请解释这段话的含义，指出作者的理由与原文依据。';
    const revised = '我认为这一段主要描述人物的焦虑，请对照原文。';
    try {
      const reader = await openBook();
      const workspace = page.locator('[data-active-reading-workspace]');
      await reader.revealHeader();
      await page.locator('button[aria-label="阅读助手"]').click();
      const configure = async () => {
        const config = workspace.locator('[data-reading-ai-config]');
        if (!(await config.evaluate((element) => (element as HTMLDetailsElement).open))) {
          await config.locator('summary').click();
        }
        await config.getByLabel('服务地址').fill(fixture.baseUrl);
        await config.getByLabel('模型名称').fill('local-test-model');
        await config.getByLabel('API Key', { exact: true }).fill('test-local-fixture');
        await config.getByRole('button', { name: '保存连接' }).click();
        await expect(config.locator('summary')).toContainText('已配置');
        await config.locator('summary').click();
      };
      await configure();
      await reader.closeNotebook();
      await selectVisibleText(page, reader);
      await reader.popupTool('Ask about this').click();
      const record = workspace.locator('article').first();
      await expect(record).toContainText('【本地模拟】选文讨论了人物的观察。');
      await expect(workspace.getByRole('button', { name: '停止回答', exact: true })).toBeVisible();
      await page.screenshot({ path: path.join(tmpdir(), 'active-reading-ai-streaming.png') });
      await expect(record).toContainText('第1轮模拟完成');
      await expect(workspace.getByRole('button', { name: '停止回答', exact: true })).toHaveCount(0);
      expect(fixture.requests).toHaveLength(1);
      expect(fixture.requests[0]?.model).toBe('local-test-model');
      expect(
        fixture.requests[0]?.messages.some((message) => message.content.includes(original)),
      ).toBe(true);

      await record.getByRole('button', { name: '编辑我的话' }).click();
      await record.getByLabel('编辑我的疑问').fill(revised);
      await record.getByRole('button', { name: '保存修改', exact: true }).click();
      await expect(record).toContainText(`这条建议对应此前表述：${original}`);
      await page.screenshot({ path: path.join(tmpdir(), 'active-reading-ai-prior-input.png') });
      await record.getByRole('button', { name: '再次请 AI 核对', exact: true }).click();
      await expect(record).toContainText('第2轮模拟完成');
      await expect(record).not.toContainText('这条建议对应此前表述：');
      expect(fixture.requests).toHaveLength(2);

      await page.reload();
      await reader.waitForReady();
      if (!(await workspace.isVisible())) {
        await reader.revealHeader();
        await page.locator('button[aria-label="阅读助手"]').click();
      }
      await workspace.getByRole('tab', { name: '疑问', exact: true }).click();
      await expect(record).toContainText(revised);
      await expect(record).toContainText('第2轮模拟完成');
      await configure();

      fixture.setMode('failure');
      await record.getByRole('button', { name: '再次请 AI 核对', exact: true }).click();
      await expect(
        workspace.getByRole('alert').filter({ hasText: '本地模拟服务暂时不可用' }).first(),
      ).toBeVisible();
      await expect(record).toContainText(revised);
      await expect(record).toContainText('第2轮模拟完成');

      fixture.setMode('slow');
      await record.getByRole('button', { name: '再次请 AI 核对', exact: true }).click();
      await expect(record).toContainText('这条回答尚未完成');
      await workspace.getByRole('button', { name: '停止回答', exact: true }).click();
      await expect(
        workspace.getByRole('alert').filter({ hasText: '回答已停止，个人记录已保存' }).first(),
      ).toBeVisible();
      await expect(record).toContainText(revised);
      await expect(record).toContainText('第2轮模拟完成');
      await expect(record).not.toContainText('这条回答尚未完成');
      await page.screenshot({ path: path.join(tmpdir(), 'active-reading-ai-stopped.png') });

      const downloadPromise = page.waitForEvent('download');
      await workspace.getByRole('button', { name: '导出 Markdown' }).click();
      const download = await downloadPromise;
      const exportPath = path.join(tmpdir(), 'active-reading-ai-export.md');
      await download.saveAs(exportPath);
      const markdown = await readFile(exportPath, 'utf8');
      expect(markdown).toContain('### AI 建议');
      expect(markdown).toContain('模型：local-test-model');
      expect(markdown).toContain('本次对照的个人表述：');
      expect(markdown).toContain(revised);
      expect(markdown).toContain(original);
      expect(markdown).toContain('此前 AI 建议');
      expect(markdown).toContain('第1轮模拟完成');
      expect(markdown).toContain('第2轮模拟完成');
      expect(markdown).not.toContain('这条回答尚未完成');
      expect(markdown).not.toContain('test-local-fixture');
      await writeFile(
        path.join(tmpdir(), 'active-reading-ai-errors.json'),
        JSON.stringify({ pageErrors, consoleErrors }, null, 2),
      );
      expect(pageErrors).toEqual([]);
      expect(
        consoleErrors.filter((message) => !message.includes('503 (Service Unavailable)')),
      ).toEqual([]);
      await expect(page.locator('nextjs-portal [data-nextjs-dialog-overlay]')).toBeHidden();
    } finally {
      await fixture.close();
    }
  });

  test('follows real pointer positions and pauses for selection, then recomputes after page and font changes', async ({
    page,
    openBook,
  }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    const reader = await openBook();
    await reader.openTocChapter(2);
    await reader.revealHeader();
    const toggle = page.getByRole('button', { name: 'Visual follow', exact: true });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const guide = page.locator('[data-focus-guide]');
    const line = guide.locator(':scope > div').nth(2);
    await expect
      .poll(() =>
        page
          .locator('foliate-view')
          .evaluate(
            (element) =>
              (element as HTMLElement & { renderer: { columnCount: number } }).renderer.columnCount,
          ),
      )
      .toBe(1);
    await expect.poll(async () => (await visibleTextLines(page)).length).toBeGreaterThan(5);

    const hoverAndCheck = async (point: { x: number; y: number }) => {
      await page.mouse.move(point.x, point.y, { steps: 4 });
      await expect(guide).toBeVisible();
      await expect
        .poll(async () => {
          const rect = await line.boundingBox();
          return !!rect && rect.y <= point.y + 2 && rect.y + rect.height >= point.y - 2;
        })
        .toBe(true);
    };
    let lines = await visibleTextLines(page);
    const first = lines[2]!;
    const second = lines.find((point) => point.y > first.y + 60)!;
    expect(second).toBeTruthy();
    await hoverAndCheck(first);
    const firstY = (await line.boundingBox())!.y;
    await hoverAndCheck(second);
    const secondY = (await line.boundingBox())!.y;
    expect(Math.abs(secondY - firstY)).toBeGreaterThan(40);
    await page.waitForTimeout(200);
    expect((await line.boundingBox())!.y).toBe(secondY);
    await page.screenshot({ path: path.join(tmpdir(), 'active-reading-visual-follow.png') });

    await page.mouse.down();
    await expect(guide).toBeHidden();
    await page.mouse.move(second.x + 110, second.y, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(() =>
        page.locator('foliate-view').evaluate((element) => {
          const view = element as HTMLElement & {
            renderer: { getContents: () => { doc: Document }[] };
          };
          return view.renderer
            .getContents()
            .map(({ doc }) => doc.getSelection()?.toString() || '')
            .join('');
        }),
      )
      .not.toBe('');
    await expect(guide).toBeHidden();
    await page.screenshot({
      path: path.join(tmpdir(), 'active-reading-visual-selection-paused.png'),
    });
    await reader.dismissPopup();

    const progress = await reader.readingProgress();
    await reader.nextPage();
    await expect.poll(() => reader.readingProgress()).toBeGreaterThan(progress);
    await expect.poll(async () => (await visibleTextLines(page)).length).toBeGreaterThan(4);
    lines = await visibleTextLines(page);
    await hoverAndCheck(lines[2]!);
    await page.screenshot({ path: path.join(tmpdir(), 'active-reading-visual-after-page.png') });

    const font = await reader.increaseFontSize();
    expect(Number(font.after)).toBeGreaterThan(Number(font.before));
    await expect.poll(async () => (await visibleTextLines(page)).length).toBeGreaterThan(4);
    lines = await visibleTextLines(page);
    await hoverAndCheck(lines[2]!);
    await page.screenshot({ path: path.join(tmpdir(), 'active-reading-visual-after-font.png') });

    await reader.revealHeader();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(guide).toHaveCount(0);
    await writeFile(
      path.join(tmpdir(), 'active-reading-visual-errors.json'),
      JSON.stringify({ pageErrors: errors, consoleErrors }, null, 2),
    );
    expect(errors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    await expect(page.locator('nextjs-portal [data-nextjs-dialog-overlay]')).toBeHidden();
  });
});
