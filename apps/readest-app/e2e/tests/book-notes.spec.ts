import { mkdir, readFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import type { BookNotesExport } from '../../src/features/book-notes/types';
import { expect, test } from '../fixtures/base';
import { SAMPLE_EPUB } from '../fixtures/books';
import { LibraryPage } from '../pages/LibraryPage';

test.use({ viewport: { width: 1600, height: 1000 }, locale: 'en-US', colorScheme: 'light' });
const screenshots = '/Users/youze/GPT/阅读软件/界面验证-本书笔记-2026-09-27';

async function openNotes(page: Page) {
  if (await page.getByLabel('显示阅读工具栏', { exact: true }).isVisible())
    await page.getByLabel('显示阅读工具栏', { exact: true }).click();
  await page.getByRole('button', { name: '本书笔记', exact: true }).click();
  const workspace = page.getByRole('region', { name: '本书笔记', exact: true });
  await expect(workspace).toBeVisible();
  await expect(workspace.locator('.book-notes-card')).not.toHaveCount(0);
  return workspace;
}

/** Every test has an isolated empty browser context. Only our imported Alice fixture is seeded. */
async function setupArchive(page: Page) {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      !['localhost', '127.0.0.1'].includes(url.hostname)
    )
      await route.abort();
    else await route.continue();
  });
  const library = new LibraryPage(page);
  await library.goto();
  await library.importBook(SAMPLE_EPUB);
  await expect(library.bookCards()).toHaveCount(1);
  await library.openFirstBook();
  await page.getByRole('button', { name: /快速阅读/ }).click();
  await expect(page.locator('foliate-view')).toBeVisible();
  const readerUrl = page.url();
  const seeded = await page.evaluate(async () => {
    type Toc = { label: string; href: string; subitems?: Toc[] };
    const view = document.querySelector('foliate-view') as HTMLElement & {
      book: {
        sections: { id: string; href?: string; createDocument(): Promise<Document> }[];
        toc: Toc[];
        splitTOCHref(href: string): [string, string?];
      };
      getCFI(index: number, range: Range): string;
    };
    const flat = (items: Toc[]): Toc[] =>
      items.flatMap((item) => [item, ...flat(item.subitems || [])]);
    const toc = flat(view.book.toc);
    const passages: {
      excerpt: string;
      cfi: string;
      chapter: string;
      sectionIndex: number;
      href: string;
    }[] = [];
    for (let index = 0; index < view.book.sections.length && passages.length < 12; index++) {
      const section = view.book.sections[index]!;
      const doc = await section.createDocument();
      const paragraphs = [...doc.querySelectorAll('p')]
        .filter((p) => (p.textContent || '').trim().length > 120)
        .slice(0, 4);
      if (paragraphs.length < 4) continue;
      const item = toc.find((candidate) => {
        const [path] = view.book.splitTOCHref(candidate.href);
        return section.id === path || section.href === path;
      });
      for (const paragraph of paragraphs) {
        const range = doc.createRange();
        range.selectNodeContents(paragraph);
        passages.push({
          excerpt: paragraph.textContent!.replace(/\s+/g, ' ').trim(),
          cfi: view.getCFI(index, range),
          chapter: item?.label || `第 ${index + 1} 节`,
          sectionIndex: index,
          href: item?.href || section.href || section.id,
        });
      }
    }
    if (passages.length !== 12)
      throw new Error('Alice fixture must provide 12 real paragraph locations');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('AppFileSystem', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const files = await new Promise<{ path: string; content: string | ArrayBuffer }[]>(
        (resolve, reject) => {
          const request = database.transaction('files').objectStore('files').getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        },
      );
      const configFile = files.find((file) =>
        /^Readest\/Books\/[^/]+\/config\.json$/.test(file.path),
      );
      if (!configFile || typeof configFile.content !== 'string')
        throw new Error('Imported fixture config was not saved');
      const base = configFile.path.replace(/\/config\.json$/, '');
      const hash = base.split('/').at(-1)!;
      const config = JSON.parse(configFile.content);
      const firstDate = Date.parse('2026-09-01T08:00:00Z');
      config.booknotes = passages.slice(0, 11).map((source, index) => ({
        id: `fixture-native-${index}`,
        type: 'annotation',
        cfi: source.cfi,
        text: source.excerpt,
        note: `测试笔记 ${index + 1}：第一次阅读时，我注意到 Alice 的观察和行动。`,
        style: 'highlight',
        color: 'yellow',
        createdAt: firstDate + index * 1000,
        updatedAt: firstDate + index * 1000,
      }));
      const repeated = [0, 0, 1, 2, 3, 4, 5, 11];
      const records = repeated.map((position, index) => {
        const source = passages[position]!;
        const text = `再次阅读 ${index + 1}：这次理解与第一次不同，我想保留这个变化。`;
        const at = new Date(firstDate + (index + 1) * 86_400_000).toISOString();
        return {
          id: `fixture-reading-${index}`,
          kind: index === 1 ? 'question' : 'understanding',
          status: index === 1 ? 'open' : 'kept',
          userText: text,
          originalText: text,
          revisions: [],
          createdAt: at,
          updatedAt: at,
          source: { ...source, bookHash: hash, bookVersion: `book-hash:${hash}` },
        };
      });
      const now = new Date(firstDate).toISOString();
      const reading = {
        version: 1,
        bookHash: hash,
        bookTitle: 'Alice’s Adventures in Wonderland',
        bookAuthor: 'Lewis Carroll',
        profile: {
          genre: 'fiction',
          goal: '',
          initialThought: '',
          fourQuestions: ['', '', '', ''],
        },
        records,
        updatedAt: now,
      };
      const first = passages[0]!;
      const modes = {
        version: 1,
        bookHash: hash,
        mode: 'quick',
        follow: false,
        followStyle: 'soft',
        reminders: false,
        quietDate: '',
        stage: 0,
        captures: {
          [`section:${first.sectionIndex}:${first.href}`]: '章节思考：Alice 的好奇心带着故事前进。',
        },
        reconstructions: {},
        intensive: [],
      };
      return {
        hash,
        firstExcerpt: first.excerpt,
        firstChapter: first.chapter,
        totalEntries: 20,
        passages: 12,
        files: [
          [configFile.path, config],
          [`${base}/reading-method.json`, reading],
          [`${base}/reading-modes.json`, modes],
        ].map(([path, value]) => ({ path: path as string, content: JSON.stringify(value) })),
      };
    } finally {
      database.close();
    }
  });
  // Leave the reader before seeding: its pagehide progress flush owns config.json.
  await library.goto();
  await page.evaluate(async (files) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('AppFileSystem', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('files', 'readwrite');
        for (const file of files) transaction.objectStore('files').put(file);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }, seeded.files);
  await page.goto(readerUrl);
  await expect(page.locator('foliate-view')).toBeVisible();
  return { workspace: await openNotes(page), seeded, errors };
}

async function screenshot(page: Page, name: string) {
  await mkdir(screenshots, { recursive: true });
  if (name === '02-桌面笔记叠加详情' || name === '04-拖动后分栏')
    await page.locator('.book-notes-detail-scroll').evaluate((element) => {
      element.scrollTop = 0;
    });
  await page.screenshot({ path: `${screenshots}/${name}.png`, fullPage: true });
}
const repeatedCard = (workspace: Locator) =>
  workspace.locator('.book-notes-card').filter({ hasText: '共 3 次记录' });
async function drag(page: Page, divider: Locator, delta: number) {
  const bounds = (await divider.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + Math.min(160, bounds.height / 2));
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width / 2 + delta,
    bounds.y + Math.min(160, bounds.height / 2),
    { steps: 8 },
  );
  await page.mouse.up();
}

test('按章节聚合 20 条记录，追加思考和感悟刷新保留，完整导出 JSON', async ({ page }) => {
  const { workspace, seeded, errors } = await setupArchive(page);
  await expect(workspace.getByText('20 条笔记 · 12 处原文', { exact: true })).toBeVisible();
  await expect(workspace.locator('.book-notes-card')).toHaveCount(13);
  await expect(
    workspace
      .getByRole('complementary', { name: '笔记章节' })
      .getByRole('button', { name: new RegExp(seeded.firstChapter) }),
  ).toBeVisible();
  expect(
    await workspace
      .locator('.book-notes-card-quote')
      .first()
      .evaluate((element) => getComputedStyle(element).webkitLineClamp),
  ).toBe('3');
  await screenshot(page, '01-桌面笔记列表');
  await repeatedCard(workspace).click();
  const detail = workspace.getByRole('region', { name: '笔记详情', exact: true });
  await expect(detail.getByText(seeded.firstExcerpt, { exact: true })).toBeVisible();
  expect(
    await detail
      .locator('.book-notes-full-quote')
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThanOrEqual(16);
  await expect(detail.locator('.book-notes-timeline > li')).toHaveCount(3);
  const appended = '第三次阅读：我开始把好奇心和行动联系起来，这条想法应独立保留。';
  await detail.getByLabel('追加想法', { exact: true }).fill(appended);
  await detail.getByRole('button', { name: '保存新想法', exact: true }).click();
  await expect(detail.locator('.book-notes-timeline > li')).toHaveCount(4);
  await expect(
    detail.getByText('测试笔记 1：第一次阅读时，我注意到 Alice 的观察和行动。', { exact: true }),
  ).toBeVisible();
  await expect(detail.getByText(appended, { exact: true })).toBeVisible();
  await expect(workspace.getByText('21 条笔记 · 12 处原文', { exact: true })).toBeVisible();
  await screenshot(page, '02-桌面笔记叠加详情');
  await detail.getByRole('button', { name: '引用到感悟' }).click();
  await workspace.getByLabel('感悟标题', { exact: true }).fill('第一次读完：好奇心与行动');
  await workspace
    .getByLabel('感悟正文', { exact: true })
    .fill('这本书让我想到，理解可以在多次阅读之间慢慢积累。\n\n我想继续观察自己的好奇心。');
  expect(
    await workspace
      .getByLabel('感悟标题', { exact: true })
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThanOrEqual(28);
  expect(
    await workspace
      .getByLabel('感悟正文', { exact: true })
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThanOrEqual(16);
  await expect(workspace.getByText('已自动保存', { exact: true })).toBeVisible();
  await expect(workspace.getByRole('region', { name: '感悟引用的笔记' })).toBeVisible();
  await screenshot(page, '03-桌面感悟编辑');
  await workspace.getByRole('button', { name: '返回阅读', exact: true }).click();
  await expect(workspace).toBeHidden();
  await page.reload();
  await expect(page.locator('foliate-view')).toBeVisible();
  const reopened = await openNotes(page);
  await expect(reopened.getByText('21 条笔记 · 12 处原文', { exact: true })).toBeVisible();
  await reopened.getByRole('tab', { name: '感悟', exact: true }).click();
  await expect(reopened.getByLabel('感悟标题', { exact: true })).toHaveValue(
    '第一次读完：好奇心与行动',
  );
  await expect(reopened.getByLabel('感悟正文', { exact: true })).toHaveValue(
    /理解可以在多次阅读之间慢慢积累/,
  );
  await reopened.getByRole('button', { name: '导出', exact: true }).click();
  const exportDialog = page.getByRole('dialog', { name: '导出本书笔记', exact: true });
  await expect(exportDialog).toBeVisible();
  await expect
    .poll(() => exportDialog.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
  await page.keyboard.press('Escape');
  await expect(exportDialog).toBeHidden();
  await expect(reopened.getByRole('button', { name: '导出', exact: true })).toBeFocused();
  await reopened.getByRole('button', { name: '导出', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page
    .getByRole('dialog', { name: '导出本书笔记', exact: true })
    .getByRole('button', { name: 'JSON 资料包' })
    .click();
  const download = await downloadPromise;
  const payload = JSON.parse(await readFile((await download.path())!, 'utf8')) as BookNotesExport;
  expect(payload.schemaVersion).toBe(1);
  expect(payload.groups.flatMap((group) => group.entries)).toHaveLength(21);
  expect(
    payload.groups.find((group) => group.excerpt === seeded.firstExcerpt)?.entries,
  ).toHaveLength(4);
  expect(payload.reflections[0]?.references).toHaveLength(4);
  expect(payload.reflections[0]?.title).toBe('第一次读完：好奇心与行动');
  expect(JSON.stringify(payload)).toContain(appended);
  await page.getByRole('button', { name: '关闭笔记导出', exact: true }).click();
  await reopened.getByRole('tab', { name: '笔记', exact: true }).click();
  await reopened.locator('.book-notes-card').filter({ hasText: '共 4 次记录' }).click();
  await reopened
    .getByRole('region', { name: '笔记详情', exact: true })
    .getByRole('button', { name: '回到原文' })
    .click();
  await expect(reopened).toBeHidden();
  await expect(page.locator('.moshu-root')).toHaveAttribute('data-mode', 'analytical');
  await expect
    .poll(() =>
      page.evaluate((excerpt) => {
        const view = document.querySelector('foliate-view') as HTMLElement & {
          renderer: { getContents(): { doc: Document }[] };
        };
        return view.renderer
          .getContents()
          .some(({ doc }) => (doc.body.textContent || '').replace(/\s+/g, ' ').includes(excerpt));
      }, seeded.firstExcerpt),
    )
    .toBe(true);
  const einkNotes = await openNotes(page);
  await einkNotes.getByRole('tab', { name: '笔记', exact: true }).click();
  await einkNotes.locator('.book-notes-card').filter({ hasText: '共 4 次记录' }).click();
  // CSS-only E-ink state in this synthetic browser; no user setting is changed.
  await page.evaluate(() => document.documentElement.setAttribute('data-eink', 'true'));
  const selected = einkNotes.locator('.book-notes-card.is-selected');
  await expect(selected).toHaveCSS('outline-style', 'solid');
  await expect(selected).toHaveCSS('outline-width', '1px');
  await expect(selected).toHaveCSS('box-shadow', 'none');
  expect(
    await selected.evaluate((element) => {
      const style = getComputedStyle(element);
      return style.outlineColor === style.color;
    }),
  ).toBe(true);
  await screenshot(page, '09-墨水屏笔记');
  await einkNotes.getByRole('button', { name: '新建独立笔记', exact: true }).click();
  const independent = einkNotes.getByRole('region', { name: '笔记详情', exact: true });
  await independent
    .getByLabel('追加想法', { exact: true })
    .fill('没有绑定原文的独立思考也应该留下。');
  await independent.getByRole('button', { name: '保存新想法', exact: true }).click();
  await expect(independent.locator('.book-notes-timeline > li')).toHaveCount(1);
  await expect(independent.locator('.book-notes-timeline')).toContainText(
    '没有绑定原文的独立思考也应该留下。',
  );
  expect(errors).toEqual([]);
});

test('两个分界线拖动只改变相邻区域，键盘可调，关闭与刷新记住宽度及草稿', async ({ page }) => {
  const { workspace, errors } = await setupArchive(page);
  await repeatedCard(workspace).click();
  const sidebar = workspace.locator('.book-notes-sidebar');
  const main = workspace.locator('.book-notes-main');
  const detail = workspace.getByRole('region', { name: '笔记详情', exact: true });
  const navDivider = workspace.getByRole('separator', { name: '调整目录与内容宽度', exact: true });
  const detailDivider = workspace.getByRole('separator', { name: '调整笔记详情宽度', exact: true });
  const sizes = async () =>
    Promise.all(
      [sidebar, main, detail].map(async (element) => (await element.boundingBox())!.width),
    );
  await detail.getByLabel('追加想法', { exact: true }).fill('拖动时保留的未提交草稿');
  const before = await sizes();
  await drag(page, navDivider, 64);
  const afterNav = await sizes();
  expect(afterNav[0]! - before[0]!).toBeCloseTo(64, 0);
  expect(before[1]! - afterNav[1]!).toBeCloseTo(64, 0);
  expect(afterNav[2]!).toBeCloseTo(before[2]!, 0);
  await drag(page, detailDivider, -80);
  const afterDetail = await sizes();
  expect(afterDetail[2]! - afterNav[2]!).toBeCloseTo(80, 0);
  expect(afterNav[1]! - afterDetail[1]!).toBeCloseTo(80, 0);
  expect(afterDetail[0]!).toBeCloseTo(afterNav[0]!, 0);
  await detailDivider.focus();
  await detailDivider.press('ArrowLeft');
  await expect(detail.getByLabel('追加想法', { exact: true })).toHaveValue(
    '拖动时保留的未提交草稿',
  );
  const adjusted = await sizes();
  expect(adjusted[2]! - afterDetail[2]!).toBeCloseTo(10, 0);
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('moshu.book-notes.panels.v1') || '{}').detail,
      ),
    )
    .toBeCloseTo(adjusted[2]!, 0);
  await screenshot(page, '04-拖动后分栏');
  await detail.getByRole('button', { name: '关闭笔记详情', exact: true }).click();
  await repeatedCard(workspace).click();
  await expect(detail.getByLabel('追加想法', { exact: true })).toHaveValue(
    '拖动时保留的未提交草稿',
  );
  expect((await sizes())[2]).toBeCloseTo(adjusted[2]!, 0);
  await workspace.getByRole('button', { name: '返回阅读', exact: true }).click();
  await page.reload();
  await expect(page.locator('foliate-view')).toBeVisible();
  const reopened = await openNotes(page);
  await repeatedCard(reopened).click();
  expect((await reopened.locator('.book-notes-sidebar').boundingBox())!.width).toBeCloseTo(
    adjusted[0]!,
    0,
  );
  expect(
    (await reopened.getByRole('region', { name: '笔记详情', exact: true }).boundingBox())!.width,
  ).toBeCloseTo(adjusted[2]!, 0);
  expect(errors).toEqual([]);
});

test('390px 手机和 800px 窄窗口可返回列表、写感悟，无横向溢出', async ({ page }) => {
  const { workspace, errors } = await setupArchive(page);
  const noOverflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(noOverflow).toBe(true);
  await expect(workspace.getByLabel('选择笔记章节', { exact: true })).toBeVisible();
  await screenshot(page, '05-手机笔记列表');
  await repeatedCard(workspace).click();
  const detail = workspace.getByRole('region', { name: '笔记详情', exact: true });
  await expect(detail).toBeVisible();
  await expect.poll(async () => (await detail.boundingBox())!.width).toBeGreaterThanOrEqual(388);
  await detail.getByLabel('追加想法', { exact: true }).fill('手机端的新理解');
  await detail.getByRole('button', { name: '保存新想法', exact: true }).click();
  await expect(detail.locator('.book-notes-timeline > li')).toHaveCount(4);
  await expect(detail.locator('.book-notes-timeline')).toContainText('手机端的新理解');
  await expect(detail.getByText('已记下，之前的思考也在。', { exact: true })).toBeVisible();
  await detail.locator('.book-notes-detail-scroll').evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect.poll(noOverflow).toBe(true);
  await screenshot(page, '06-手机笔记详情');
  await detail.getByRole('button', { name: '关闭笔记详情', exact: true }).click();
  await workspace.getByRole('tab', { name: '感悟', exact: true }).click();
  await workspace.getByRole('button', { name: '写第一篇感悟', exact: true }).click();
  await workspace.getByLabel('感悟标题', { exact: true }).fill('手机记录的感悟');
  await workspace.getByLabel('感悟正文', { exact: true }).fill('小窗口也能舒服地记录读后感。');
  expect(
    await workspace
      .getByLabel('感悟正文', { exact: true })
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThanOrEqual(16);
  await expect(workspace.getByText('已自动保存', { exact: true })).toBeVisible();
  await expect.poll(noOverflow).toBe(true);
  await screenshot(page, '07-手机感悟');
  await page.setViewportSize({ width: 800, height: 900 });
  await workspace.getByRole('tab', { name: '笔记', exact: true }).click();
  await workspace.locator('.book-notes-card').filter({ hasText: '共 4 次记录' }).click();
  await expect(detail).toBeVisible();
  await expect.poll(noOverflow).toBe(true);
  await screenshot(page, '08-窄窗口笔记详情');
  expect(errors).toEqual([]);
});
