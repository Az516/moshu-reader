import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/** A loopback OpenAI-compatible server; tests validate UI/protocol, not model quality. */
export async function startThematicAI() {
  const server = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', '*');
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }
    if (request.method === 'GET' && request.url === '/v1/models') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ data: [{ id: 'fixture', name: 'Local fixture' }] }));
      return;
    }
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on('end', () => {
      const payload = JSON.parse(body) as { messages: { role: string; content: string }[] };
      const system = payload.messages.find((message) => message.role === 'system')?.content || '';
      const lastQuestion =
        payload.messages.filter((message) => message.role === 'user').at(-1)?.content || '';
      const content = system.includes('同义表达')
        ? '{"queries":["Alice"]}'
        : system.includes('筛选候选')
          ? '{"matches":[{"index":1,"relevance":"direct"}]}'
          : system.includes('corrections')
            ? '{"corrections":[]}'
            : `## ${lastQuestion.includes('第二主题') ? '第二主题回答' : '第一主题回答'}\n\n这是本地协议模拟，原文描写了 Alice 的行动。[1]`;
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.end(
        `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\ndata: [DONE]\n\n`,
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

export async function connectThematicAI(page: Page, baseURL: string) {
  await page.getByLabel('更多主题阅读操作', { exact: true }).click();
  await page.getByRole('button', { name: '小墨设置', exact: true }).click();
  await page.locator('[data-reading-ai-config] summary').click();
  await page.getByLabel('服务地址', { exact: true }).fill(baseURL);
  await page.getByLabel('模型名称', { exact: true }).fill('fixture');
  await page.getByLabel('API Key', { exact: true }).fill('local-test-only');
  await page.getByRole('button', { name: '保存连接', exact: true }).click();
  await expect(
    page.getByText('配置已保存。提问时只发送所选片段和必要邻文。', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.getByRole('button', { name: '自动联网已开启', exact: true }).click();
}
