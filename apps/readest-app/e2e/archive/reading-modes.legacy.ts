import { mkdir } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/base';
import { SAMPLE_EPUB } from '../fixtures/books';
import { LibraryPage } from '../pages/LibraryPage';

test.use({ viewport: { width: 1487, height: 1058 }, locale: 'en-US' });

async function importAndChoose(page: Page, mode: '快速阅读' | '分析阅读') {
  const library = new LibraryPage(page);
  await library.goto();
  await library.importBook(SAMPLE_EPUB);
  await expect(library.bookCards()).toHaveCount(1);
  await library.openFirstBook();
  // The EPUB viewer is intentionally hidden until the reader chooses a purpose.
  await expect(page.getByRole('heading', { name: '选择阅读方式' })).toBeVisible();
  await page.getByRole('button', { name: new RegExp(mode) }).click();
  await expect(page.locator('foliate-view')).toBeVisible();
  await page.getByText('Chapter 1 - Down the Rabbit Hole', { exact: true }).first().click();
  await expect.poll(async () => (await visibleProseLines(page)).length).toBeGreaterThan(2);
}

/** Read rendered geometry only. Real pointer gestures perform selection and dwelling. */
async function visibleProseLines(page: Page) {
  return page.evaluate(() => {
    const view = document.querySelector('foliate-view') as
      | (HTMLElement & {
          renderer: { getContents: () => { doc: Document }[] };
        })
      | null;
    if (!view) return [];
    const bounds = view.getBoundingClientRect();
    const lines: { x: number; y: number; width: number }[] = [];
    for (const { doc } of view.renderer.getContents()) {
      const iframe = doc.defaultView?.frameElement;
      const frame = iframe?.getBoundingClientRect();
      if (!iframe || !frame) continue;
      for (const paragraph of doc.querySelectorAll('p')) {
        if ((paragraph.textContent || '').trim().length < 40) continue;
        const range = doc.createRange();
        range.selectNodeContents(paragraph);
        for (const rect of range.getClientRects()) {
          const x = frame.left + rect.left + 24;
          const y = frame.top + rect.top + rect.height / 2;
          if (rect.width < 220 || rect.height < 10 || rect.height > 70) continue;
          if (
            x < bounds.left + 15 ||
            x + 180 > bounds.right - 30 ||
            y < bounds.top + 30 ||
            y > bounds.bottom - 45
          )
            continue;
          if (x < frame.left || x + 180 > frame.right || y < frame.top || y > frame.bottom)
            continue;
          if (y < 120 || y > innerHeight - 130) continue;
          let hit = document.elementFromPoint(x, y);
          while (hit?.shadowRoot) {
            const inner = hit.shadowRoot.elementFromPoint(x, y);
            if (!inner || inner === hit) break;
            hit = inner;
          }
          if (hit === iframe) lines.push({ x, y, width: rect.width - 24 });
        }
      }
    }
    return lines
      .sort((a, b) => a.y - b.y)
      .filter((line, index, all) => !index || Math.abs(line.y - all[index - 1]!.y) > 3);
  });
}

async function selectPassageAndOpenDialogue(
  page: Page,
  entry: 'bottom' | 'toolbar' | 'shortcut' = 'bottom',
) {
  const line = (await visibleProseLines(page))[1]!;
  expect(line).toBeTruthy();
  await page.mouse.move(line.x, line.y);
  await page.mouse.down();
  await page.mouse.move(line.x + 190, line.y, { steps: 9 });
  await page.mouse.up();
  const selectionTools = page.locator('.selection-popup');
  await expect(selectionTools).toBeVisible();
  const selectedText = await page.evaluate(() => {
    const view = document.querySelector('foliate-view') as HTMLElement & {
      renderer: { getContents: () => { doc: Document }[] };
    };
    return view.renderer
      .getContents()
      .map(({ doc }) => doc.getSelection()?.toString() || '')
      .join('');
  });
  expect(selectedText.length).toBeGreaterThan(8);
  if (entry === 'toolbar') {
    await expect(selectionTools.getByRole('button', { name: /^呼叫小墨/ })).toBeVisible();
    await expect(selectionTools.getByRole('button', { name: /^笔记/ })).toBeVisible();
    await expect(selectionTools.getByRole('button', { name: /^标记/ })).toBeVisible();
    await expect(selectionTools.getByRole('button', { name: /^Copy/ })).toHaveCount(0);
    for (const name of [/^呼叫小墨/, /^笔记/, /^标记/]) {
      const button = selectionTools.getByRole('button', { name });
      await expect
        .poll(() =>
          button.evaluate((element) => ({
            oneLine: element.scrollHeight <= element.clientHeight + 1,
            whiteSpace: getComputedStyle(element.querySelector('span')!).whiteSpace,
          })),
        )
        .toEqual({ oneLine: true, whiteSpace: 'nowrap' });
    }
    await capture(page, 'selection-toolbar-integrated');
    await selectionTools.getByRole('button', { name: /^呼叫小墨/ }).click();
  } else if (entry === 'shortcut') {
    await page.keyboard.press('Meta+e');
  } else {
    await page.locator('.moshu-dialogue-entry').click();
  }
  const card = page.locator('[data-modian-dialogue]');
  await expect(card).toBeVisible();
  await expect(card.getByLabel('输入消息', { exact: true })).toBeFocused();
  await expect(card.locator('blockquote')).toHaveText(selectedText.trim());
  await expect(card.getByText('可以问原文，也可以聊背景、看法和你的想法。')).toBeVisible();
  await expect(card.getByText(/作者的结论是什么/)).toHaveCount(0);
  await expect(selectionTools).not.toBeVisible();
  return card;
}

async function capture(page: Page, name: string) {
  await mkdir('/tmp/moshu-qa', { recursive: true });
  await page.screenshot({ path: `/tmp/moshu-qa/${name}.png`, fullPage: false });
}

test.describe('墨书阅读模式 · 真实 EPUB', () => {
  test('分析阅读显示定位光标，且阅读背景可切换', async ({ page }) => {
    await importAndChoose(page, '分析阅读');
    const follow = page.getByRole('button', { name: /字句跟随/ });
    if ((await follow.getAttribute('aria-pressed')) !== 'true') await follow.click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const view = document.querySelector('foliate-view') as HTMLElement & {
            renderer: { getContents: () => { doc: Document }[] };
          };
          return view.renderer.getContents()[0]?.doc.documentElement.style.cursor || '';
        }),
      )
      .toContain('data:image/svg+xml');

    await page.getByRole('button', { name: '阅读背景' }).click();
    const menu = page.locator('.moshu-paper-menu');
    await expect(menu).toBeVisible();
    const menuBox = await menu.boundingBox();
    expect(menuBox).not.toBeNull();
    expect(menuBox!.y).toBeGreaterThanOrEqual(0);
    expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(1058);
    await menu.getByRole('radio', { name: '纯白' }).click();
    await expect
      .poll(() =>
        page.locator('.moshu-root').evaluate((el) => getComputedStyle(el).backgroundColor),
      )
      .toBe('rgb(255, 255, 255)');
    await page.getByRole('button', { name: '阅读背景' }).click();
    await menu.getByRole('radio', { name: '米白' }).click();
    await expect
      .poll(() =>
        page.locator('.moshu-root').evaluate((el) => getComputedStyle(el).backgroundColor),
      )
      .toBe('rgb(241, 232, 208)');
  });

  test('快速阅读停留存疑，切换分析并保存思考，刷新后原文锚点和记录保留', async ({ page }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await importAndChoose(page, '快速阅读');
    await expect(page.locator('.moshu-root')).toHaveAttribute('data-mode', 'quick');
    await expect(page.getByRole('button', { name: /字句跟随/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    const point = (await visibleProseLines(page))[2]!;
    await page.mouse.move(point.x, point.y);
    await expect(page.locator('[data-sentence-guide]')).toBeVisible();
    const nudge = page.getByRole('complementary', { name: '停留提醒' });
    await expect(nudge).toBeVisible({ timeout: 10_000 });
    await nudge.getByRole('button', { name: /在这里停了一会/ }).click();
    const reminder = page.getByRole('region', { name: '墨点停留提醒' });
    await expect(reminder).toBeVisible();
    await capture(page, 'quick-dwell');
    await reminder.getByRole('radio', { name: '横线' }).click();
    await reminder.getByRole('button', { name: '留下疑问' }).click();
    await expect(reminder).not.toBeVisible();
    await expect(page.locator('[data-question-markers] button[data-status="open"]')).toHaveCount(1);
    await expect(page.locator('[data-question-highlight="underline"]').first()).toBeVisible();
    await capture(page, 'question-marker-redesigned');

    await page.getByLabel('显示阅读工具栏').click();
    await page.getByRole('button', { name: /切换模式/ }).click();
    await page.getByRole('button', { name: /分析阅读/ }).click();
    await expect(page.locator('.moshu-root')).toHaveAttribute('data-mode', 'analytical');
    await expect(page.getByRole('button', { name: /字句跟随/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await page.getByRole('button', { name: /存疑与思考/ }).click();
    const records = page.getByRole('dialog', { name: '存疑与思考' });
    await expect(records.getByText('这一句，我想稍后再想。', { exact: true })).toBeVisible();
    await records.getByRole('button', { name: '关闭思考' }).click();

    const card = await selectPassageAndOpenDialogue(page);
    const excerpt = await card.locator('blockquote').innerText();
    const thought = '人物的好奇心推动她走入陌生世界；我想继续观察她怎样回应变化。';
    await card.getByLabel('我的理解或疑问').fill(thought);
    await capture(page, 'analytical-dialogue');
    await card.getByRole('button', { name: '保存思考' }).click();
    await expect(card).not.toBeVisible();

    await page.reload();
    await expect(page.locator('.moshu-root')).toHaveAttribute('data-mode', 'analytical');
    await page.getByRole('button', { name: /存疑与思考/ }).click();
    await expect(records.getByText(thought, { exact: true })).toBeVisible();
    const savedThought = records.locator('article').filter({ hasText: thought });
    await expect(savedThought.locator('blockquote')).toHaveText(excerpt);
    await expect(records.getByText('这一句，我想稍后再想。', { exact: true })).toBeVisible();
    await savedThought.getByRole('button', { name: '回到原文' }).click();
    await expect(records).not.toBeVisible();
    await expect(page.locator('foliate-view')).toBeVisible();
    await expect(page.locator('[data-question-highlight="underline"]').first()).toBeVisible();
    await capture(page, 'analytical-reopened');
    expect(errors).toEqual([]);
  });

  test('公开检索失败明确显示错误，仍能把问题保存到本书', async ({ page }) => {
    test.setTimeout(120_000);
    await importAndChoose(page, '分析阅读');
    // Deterministic failure fixture; no public result or model answer is fabricated.
    await page.route('https://api.crossref.org/works?**', (route) =>
      route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
    );
    const card = await selectPassageAndOpenDialogue(page);
    const question = '这段话与现实中的好奇心研究有什么关系？';
    await card.getByLabel('我的理解或疑问').fill(question);
    await card.getByRole('switch', { name: '同时查公开资料' }).check();
    await card.getByLabel('公开资料检索词').fill('curiosity');
    await card.getByRole('button', { name: '请墨点查证' }).click();
    await expect(card.getByRole('alert')).toContainText('公开资料服务暂时不可用');
    await expect(card.locator('.modian-dialogue-answer')).toHaveCount(0);
    await card.getByRole('button', { name: '先存疑' }).click();
    await page.getByRole('button', { name: /存疑与思考/ }).click();
    await expect(
      page.getByRole('dialog', { name: '存疑与思考' }).getByText(question, { exact: true }),
    ).toBeVisible();
  });

  test('选文工具栏和快捷键打开对话保留引文并收起旧工具', async ({ page }) => {
    await importAndChoose(page, '分析阅读');
    for (const entry of ['toolbar', 'shortcut'] as const) {
      const card = await selectPassageAndOpenDialogue(page, entry);
      const saveLabel = entry === 'toolbar' ? '标记疑问' : '标记笔记';
      const cancelLabel = entry === 'toolbar' ? '取消疑问标记' : '取消笔记标记';
      await card.getByLabel('输入消息', { exact: true }).fill('这条内容先做一个标记。');
      await card.getByRole('button', { name: saveLabel, exact: true }).click();
      await expect(card.getByRole('button', { name: cancelLabel, exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await card.getByRole('button', { name: cancelLabel, exact: true }).click();
      await expect(card.getByRole('button', { name: saveLabel, exact: true })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      await capture(page, `analytical-dialogue-${entry}`);
      await card.getByRole('button', { name: '关闭对话', exact: true }).click();
      await expect(card).not.toBeVisible();
    }
  });

  test('翻到下一页前释放选区，不把标注工具栏带到新页面', async ({ page }) => {
    await importAndChoose(page, '分析阅读');
    const line = (await visibleProseLines(page))[1]!;
    await page.mouse.move(line.x, line.y);
    await page.mouse.down();
    await page.mouse.move(line.x + 190, line.y, { steps: 9 });
    await page.mouse.up();
    const selectionTools = page.locator('.selection-popup');
    await expect(selectionTools).toBeVisible();
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(selectionTools).not.toBeVisible();
  });

  test('后文关键词只提示线索，读者确认后变勾且解答原文刷新保留', async ({ page }) => {
    await importAndChoose(page, '分析阅读');
    const card = await selectPassageAndOpenDialogue(page);
    const question = 'Why does the rabbit carry a watch?';
    await card.getByLabel('我的理解或疑问').fill(question);
    await card.getByRole('button', { name: '先存疑' }).click();
    const clue = page.getByRole('complementary', { name: '疑问相关线索' });
    await expect(clue.getByText('这段可能与先前疑问有关')).toBeVisible();
    await expect(page.locator('[data-question-markers] button[data-status="open"]')).toHaveCount(1);
    await expect(
      page.locator('[data-question-markers] button[data-status="resolved"]'),
    ).toHaveCount(0);
    await capture(page, 'question-followup');
    await clue.getByRole('button', { name: '我确认已解答' }).click();
    await expect(clue.getByText('已按你的确认标为解决')).toBeVisible();
    await expect(
      page.locator('[data-question-markers] button[data-status="resolved"]'),
    ).toHaveCount(1);
    await clue.getByRole('button', { name: '收起', exact: true }).click();
    await page.reload();
    await page.getByRole('button', { name: /存疑与思考/ }).click();
    const saved = page
      .getByRole('dialog', { name: '存疑与思考' })
      .locator('article')
      .filter({ hasText: question });
    await expect(saved).toContainText('已解决');
    await saved.getByRole('button', { name: '回到解答原文' }).click();
    await expect(page.getByRole('dialog', { name: '存疑与思考' })).not.toBeVisible();
    await expect(page.locator('foliate-view')).toBeVisible();
  });
});
