import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/base';
import { SAMPLE_EPUB } from '../fixtures/books';
import { LibraryPage } from '../pages/LibraryPage';

// Real installed Chrome. This case uses the reader's own words and never calls a model.
test.use({ viewport: { width: 1487, height: 1058 }, locale: 'en-US', channel: 'chrome' });

async function capture(page: Page, name: string) {
  await mkdir('/tmp/moshu-qa', { recursive: true });
  await page.screenshot({ path: `/tmp/moshu-qa/thematic-e2e-${name}.png`, fullPage: false });
}

async function chooseThematic(page: Page) {
  await page.getByRole('button', { name: /切换模式/ }).click();
  await page.getByRole('button', { name: /主题阅读/ }).click();
  await expect(page.getByRole('region', { name: '主题阅读工作区' })).toBeVisible();
}

test('真实 EPUB：问题、书目、术语、作者观点、关系、讨论与判断闭环，并保留原文与草稿', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const library = new LibraryPage(page);
  await library.goto();
  await library.emptyStateImportButton.click();
  await library.localFileImportItem.waitFor({ state: 'visible' });
  const chooserPromise = page.waitForEvent('filechooser');
  await library.localFileImportItem.click();
  const chooser = await chooserPromise;
  // Both are real EPUB archives; the second is the repository's explicit Test Author fixture.
  await chooser.setFiles([
    SAMPLE_EPUB,
    SAMPLE_EPUB.replace('sample-alice.epub', 'repro-3688.epub'),
  ]);
  await expect(library.bookCards()).toHaveCount(2);
  await library.bookCards().filter({ hasText: "Alice's Adventures in Wonderland" }).click();
  await expect(page.getByRole('heading', { name: '选择阅读方式' })).toBeVisible();
  await page.getByRole('button', { name: /主题阅读/ }).click();
  const workspace = page.getByRole('region', { name: '主题阅读工作区' });
  await expect(workspace.getByRole('heading', { name: '你想弄清什么问题？' })).toBeVisible();
  await workspace
    .getByLabel('研究问题', { exact: true })
    .fill('原文怎样描写 Alice 与 fox 的行动？');
  await workspace
    .getByLabel('这次研究的范围', { exact: true })
    .fill('只对照第一章中的人物行为与原文叙述');
  await workspace.getByLabel('暂不讨论', { exact: true }).fill('未提供的心理学解释');
  await workspace.getByRole('button', { name: /检视我的书库/ }).click();
  await expect(workspace.getByRole('heading', { name: '哪些书值得带进这次研究？' })).toBeVisible();
  await expect(workspace.getByText(/在本机找到 \d+ 处词语匹配原文/)).toBeVisible({
    timeout: 60_000,
  });
  for (const checkbox of await workspace.locator('.thematic-book-choice input').all())
    await checkbox.check();
  await capture(page, 'thematic-bibliography');
  await workspace.getByRole('button', { name: /确认 2 本书，统一术语/ }).click();
  await workspace.getByRole('button', { name: '添加中立术语' }).click();
  await workspace.getByLabel('中立术语', { exact: true }).fill('人物行动');
  for (const input of await workspace.getByPlaceholder('保留作者自己的叫法').all())
    await input.fill('行动描写');
  for (const select of await workspace.getByLabel(/的术语映射关系/).all())
    await select.selectOption('related');
  await workspace
    .getByLabel('映射与适用边界', { exact: true })
    .fill('先保留作者词语，不把行动直接等同于动机。');
  await workspace.getByRole('button', { name: '确认这项映射' }).click();
  await workspace.getByRole('button', { name: /开始整理作者观点/ }).click();
  await expect(workspace.getByRole('heading', { name: '每位作者分别怎样回答？' })).toBeVisible();
  await expect(workspace.locator('.thematic-concepts')).toBeHidden();
  await expect(workspace.locator('.thematic-writing-paper')).toHaveCount(0);
  const sourceTexts: string[] = [];
  const claims: string[] = [];
  for (let index = 0; index < 2; index++) {
    const row = workspace.locator('.thematic-viewpoint').nth(index);
    await row.getByRole('button', { name: /选择原文与整理/ }).click();
    const dialog = page.locator('dialog.thematic-dialog[open]');
    const candidate = dialog.locator('.thematic-record').first();
    await expect(candidate).toBeVisible();
    const sourceText = (await candidate.locator('blockquote').innerText()).trim();
    sourceTexts.push(sourceText);
    expect(sourceText.length).toBeGreaterThan(30);
    await candidate.getByRole('button', { name: '选作观点依据' }).click();
    const claim = `作者写道：${sourceText.slice(0, 90)}`;
    claims.push(claim);
    await dialog.getByLabel('作者观点', { exact: true }).fill(claim);
    await dialog
      .getByLabel('观点理由', { exact: true })
      .fill('依据是所选原文中的连续叙述，尚不补充外部解释。');
    await dialog.getByLabel('适用范围', { exact: true }).fill('仅限当前选中的原文片段');
    await dialog.getByRole('button', { name: '已对照原文，确认观点' }).click();
    await expect(dialog).toBeHidden();
    await expect(row.locator('.thematic-viewpoint-answer strong')).toHaveText(claim);
    if (index === 0)
      await expect(
        workspace.getByRole('button', { name: /还需要另一位作者的回答才能比较/ }),
      ).toBeDisabled();
  }
  await expect(workspace.getByText('已核对原文', { exact: true })).toHaveCount(2);
  await capture(page, 'thematic-viewpoints');
  await workspace.getByRole('button', { name: /观点已核对，进入关系分析/ }).click();
  await workspace.getByRole('button', { name: '我来核对关系' }).click();
  // A saved draft must not imply a relation after the reader narrows the scope to one book.
  await workspace.getByRole('button', { name: /2 本书 ·/ }).click();
  const bookScope = page.locator('dialog.thematic-dialog[open]');
  await bookScope.locator('.thematic-book-choice input').nth(1).uncheck();
  await bookScope.getByRole('button', { name: '确认研究范围' }).click();
  await expect(workspace.getByText('已保存在本机', { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    workspace.getByText('还需要另一位作者的回答才能比较', { exact: true }),
  ).toBeVisible();
  await expect(workspace.locator('.thematic-relation')).toHaveCount(0);
  await expect(workspace.getByRole('button', { name: '我来核对关系' })).toHaveCount(0);
  await capture(page, 'single-author-restored-draft');
  await workspace.getByRole('button', { name: /1 本书 ·/ }).click();
  await bookScope.locator('.thematic-book-choice input').nth(1).check();
  await bookScope.getByRole('button', { name: '确认研究范围' }).click();
  await workspace.locator('.thematic-relation select').selectOption('different_scope');
  const relation = '两份原文描述不同主体的行动；它们讨论的范围不同，不能仅凭这些描述推断共同动机。';
  await workspace.getByLabel('客观说明与适用范围').fill(relation);
  await workspace.getByRole('button', { name: '确认这项关系' }).click();
  await workspace.getByRole('button', { name: /进入客观讨论/ }).click();
  await expect(workspace.locator('.thematic-writing-paper')).toContainText(relation);
  await capture(page, 'thematic-discussion');
  const followupDraft = '作者这里是否只是描述行动，而没有直接解释动机？';
  await workspace.getByLabel('向墨点追问或纠正').fill(followupDraft);
  await expect(workspace.getByText('已保存在本机', { exact: true })).toBeVisible();
  await page.reload();
  await expect(workspace.getByLabel('向墨点追问或纠正')).toHaveValue(followupDraft);
  await workspace.getByRole('button', { name: /形成我的判断/ }).click();
  const judgment = '我暂时把人物行动与动机解释分开。当前原文支持行动描述，尚不足以据此断言动机。';
  await workspace.getByLabel('共同点', { exact: true }).fill('现有材料描述了人物的行动。');
  await workspace.getByLabel('我的综合判断', { exact: true }).fill(judgment);
  await workspace
    .getByLabel('这和我有什么关系', { exact: true })
    .fill('以后读人物动机时，先找到作者明确写出的依据。');
  await workspace.locator('.thematic-citation-picker summary').click();
  await workspace.locator('.thematic-citation-picker input').first().check();
  await expect(workspace.getByText('已保存在本机', { exact: true })).toBeVisible();
  await capture(page, 'thematic-judgment-details');
  await workspace.evaluate((element) => {
    element.scrollTop = 0;
  });
  await capture(page, 'thematic-judgment');
  await page.reload();
  await expect(workspace.getByLabel('我的综合判断', { exact: true })).toHaveValue(judgment);
  await workspace.locator('.thematic-citation-picker summary').click();
  await expect(workspace.locator('.thematic-citation-picker input').first()).toBeChecked();
  const sourceLink = workspace
    .locator('.thematic-citation-picker label')
    .filter({ hasText: 'Repro 3688' })
    .getByRole('button', { name: '原文', exact: true });
  await sourceLink.click();
  await expect(workspace).not.toBeVisible();
  await expect(page.locator('foliate-view')).toBeVisible();
  await chooseThematic(page);
  await expect(workspace.getByLabel('我的综合判断', { exact: true })).toHaveValue(judgment);
  const downloadPromise = page.waitForEvent('download');
  await workspace.getByRole('button', { name: '导出研究与引用' }).click();
  const download = await downloadPromise;
  await download.saveAs('/tmp/moshu-qa/thematic-research-export.md');
  const exported = await readFile('/tmp/moshu-qa/thematic-research-export.md', 'utf8');
  expect(exported).toContain(judgment);
  for (const claim of claims) expect(exported).toContain(claim);
  expect(exported).toContain('epubcfi(');
  for (const sourceText of sourceTexts) expect(exported).toContain(sourceText);
  await page.setViewportSize({ width: 390, height: 844 });
  await workspace.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect
    .poll(() => workspace.evaluate((element) => element.scrollWidth - element.clientWidth))
    .toBeLessThanOrEqual(1);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
    .toBeLessThanOrEqual(1);
  await capture(page, 'mobile-judgment');
  expect(pageErrors).toEqual([]);
  await expect(page.locator('nextjs-portal [data-nextjs-dialog-overlay]')).toBeHidden();
});

/** Isolated localhost protocol fixture. Its generated text is never a real model result. */
async function startThematicProtocolFixture() {
  let invalidReference = false;
  let count = 0;
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
      count += 1;
      const data = JSON.parse(body) as { messages: { role: string; content: string }[] };
      const prompt = data.messages.find((message) => message.role === 'user')?.content || '';
      const raw = prompt.split('以下 JSON 是书中引用资料：\n')[1]?.split('\n')[0] || '{}';
      const source = JSON.parse(raw) as { excerpt?: string };
      const passageId = source.excerpt?.match(/^\[([^\]]+)\]/)?.[1] || '';
      const answer = JSON.stringify({
        claim: '【本地协议模拟】这条观点只用于验证原文引用流转。',
        reasons: ['【本地协议模拟】引用来自本轮实际选择的 EPUB 段落。'],
        scope: '仅用于自动化验证',
        authorTerms: [],
        passageIds: [invalidReference ? 'nonexistent-fixture-passage' : passageId],
      });
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      response.write(
        `data: ${JSON.stringify({ id: 'thematic-protocol-fixture', object: 'chat.completion.chunk', created: 1, model: 'local-protocol-fixture', choices: [{ index: 0, delta: { content: answer }, finish_reason: null }] })}\n\n`,
      );
      response.end(
        `data: ${JSON.stringify({ id: 'thematic-protocol-fixture', object: 'chat.completion.chunk', created: 1, model: 'local-protocol-fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    count: () => count,
    invalidate: () => {
      invalidReference = true;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

test('本地协议模拟：结构化观点只接受真实原文ID，错误引用不覆盖已存观点', async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = await startThematicProtocolFixture();
  try {
    const library = new LibraryPage(page);
    await library.goto();
    await library.importBook(SAMPLE_EPUB);
    await expect(library.bookCards()).toHaveCount(1);
    await library.openFirstBook();
    await page.getByRole('button', { name: /主题阅读/ }).click();
    const workspace = page.getByRole('region', { name: '主题阅读工作区' });
    await expect(workspace.getByRole('heading', { name: '你想弄清什么问题？' })).toBeVisible();
    await workspace.getByRole('button', { name: '墨点设置', exact: true }).click();
    const settings = page.getByRole('dialog', { name: '墨点设置' });
    await settings.locator('summary').filter({ hasText: '模型连接' }).click();
    await settings.getByLabel('服务地址').fill(fixture.url);
    await settings.getByLabel('模型名称').fill('local-protocol-fixture');
    await settings.getByLabel('API Key').fill('fixture-only-not-a-real-secret');
    await settings.getByRole('button', { name: '保存连接', exact: true }).click();
    await expect(settings.getByText(/配置已保存/)).toBeVisible();
    await settings.getByRole('button', { name: '关闭设置' }).click();
    await workspace.getByLabel('研究问题', { exact: true }).fill('Alice 的行动有什么依据？');
    await workspace.getByRole('button', { name: /检视我的书库/ }).click();
    await expect(workspace.getByText(/在本机找到 \d+ 处词语匹配原文/)).toBeVisible({
      timeout: 60_000,
    });
    await workspace.locator('.thematic-book-choice input').first().check();
    await workspace.getByRole('button', { name: /确认 1 本书，统一术语/ }).click();
    await workspace.getByRole('button', { name: /开始整理作者观点/ }).click();
    await workspace.getByRole('button', { name: /选择原文与整理/ }).click();
    const dialog = page.locator('dialog.thematic-dialog[open]');
    await dialog
      .locator('.thematic-record')
      .first()
      .getByRole('button', { name: '选作观点依据' })
      .click();
    await dialog.getByRole('button', { name: '请墨点整理待核对观点' }).click();
    await expect(dialog.getByLabel('作者观点', { exact: true })).toHaveValue(
      '【本地协议模拟】这条观点只用于验证原文引用流转。',
    );
    fixture.invalidate();
    await dialog.getByRole('button', { name: '请墨点整理待核对观点' }).click();
    await expect(dialog.getByRole('alert')).toContainText('没有返回可核对的本书观点');
    await expect(dialog.getByLabel('作者观点', { exact: true })).toHaveValue(
      '【本地协议模拟】这条观点只用于验证原文引用流转。',
    );
    expect(fixture.count()).toBe(2);
    await capture(page, 'structured-protocol-validation');
  } finally {
    await fixture.close();
  }
});
