import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';

const server = fileURLToPath(new URL('./server.mjs', import.meta.url));
const cfi = 'epubcfi(/6/2!/4/2/1:0)';
const reading = (records) => ({ version: 1, bookHash: 'book1', records, profile: { fourQuestions: ['', '', '', ''] } });
const record = (id, text) => ({ id, kind: 'understanding', userText: text, status: 'kept', source: { bookHash: 'book1', chapter: '第一章', cfi, excerpt: '共同原文' }, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'moshu-mcp-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const books = path.join(root, 'Books');
  const book = path.join(books, 'book1');
  await mkdir(book, { recursive: true });
  await writeFile(path.join(books, 'library.json'), JSON.stringify([{ hash: 'book1', title: '测试书', author: '作者', format: 'EPUB' }, { hash: 'deleted', title: 'Deleted', deletedAt: 1 }]));
  await writeFile(path.join(book, 'reading-method.json'), JSON.stringify(reading([record('one', '第一次想法'), record('two', '第二次理解')])));
  await writeFile(path.join(book, 'config.json'), JSON.stringify({ booknotes: [{ id: 'native-one', type: 'annotation', cfi, text: '共同原文', note: '旧批注', createdAt: 1000, updatedAt: 1000 }, { id: 'deleted', deletedAt: 1 }] }));
  await writeFile(path.join(book, 'book-notes.json'), JSON.stringify({ version: 1, bookHash: 'book1', reflections: [{ id: 'reflection', title: '感悟', text: '新的理解', references: ['reading:two'] }], reports: [{ id: 'report', title: 'AI分析', text: '分析结果' }] }));
  await writeFile(path.join(book, 'reading-modes.json'), JSON.stringify({ version: 1, bookHash: 'book1', captures: { 'section:0:chapter.xhtml': '章节想法' }, reconstructions: {} }));
  await writeFile(path.join(book, 'nav.json'), JSON.stringify({ toc: [{ label: '第一章', index: 0, href: 'chapter.xhtml', cfi }] }));
  return { root, book, books };
}
function client(t, args) {
  const child = spawn(process.execPath, [server, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const awaiting = new Map();
  let counter = 0;
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line);
    const pending = awaiting.get(message.id);
    if (pending) { awaiting.delete(message.id); clearTimeout(pending.timer); pending.resolve(message); }
  });
  child.on('exit', (code) => {
    for (const p of awaiting.values()) { clearTimeout(p.timer); p.reject(new Error(`server exited ${code}: ${stderr}`)); }
    awaiting.clear();
  });
  return {
    request(method, params = {}) {
      const id = ++counter;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { awaiting.delete(id); reject(new Error(`timeout: ${stderr}`)); }, 10000);
        awaiting.set(id, { resolve, reject, timer });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });
    },
    async call(name, args = {}) {
      const response = await this.request('tools/call', { name, arguments: args });
      assert.equal(response.error, undefined, JSON.stringify(response));
      return response.result;
    },
  };
}
const value = (result) => { assert.equal(result.isError, undefined, JSON.stringify(result)); return JSON.parse(result.content[0].text); };

test('stdio MCP initializes, lists read-only tools, aggregates all notes and rereads fresh data', async (t) => {
  const f = await fixture(t);
  const rpc = client(t, ['--library', f.root]);
  const init = await rpc.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  const listing = await rpc.request('tools/list');
  assert.ok(listing.result.tools.every((tool) => tool.annotations.readOnlyHint));
  const books = value(await rpc.call('list_books'));
  assert.equal(books.total, 1);
  assert.equal(books.items[0].hash, 'book1');
  const notes = value(await rpc.call('list_notes', { bookId: 'book1', limit: 1 }));
  assert.equal(notes.total, 2);
  assert.ok(notes.nextCursor);
  const allNotes = value(await rpc.call('list_notes', { bookId: 'book1' }));
  const repeatedPassage = allNotes.items.find((group) => group.entries.length === 3);
  assert.ok(repeatedPassage);
  const thread = value(await rpc.call('read_note_thread', { bookId: 'book1', noteId: repeatedPassage.id }));
  assert.deepEqual(thread.entries.map((e) => e.id).sort(), ['native:native-one', 'reading:one', 'reading:two']);
  const next = value(await rpc.call('list_notes', { bookId: 'book1', limit: 1, cursor: notes.nextCursor }));
  assert.equal(next.items.length, 1);
  assert.equal(next.nextCursor, null);
  const search = value(await rpc.call('search_notes', { query: '第二次' }));
  assert.equal(search.total, 1);
  assert.equal(search.items[0].book.hash, 'book1');
  const reflections = value(await rpc.call('read_reflections', { bookId: 'book1' }));
  assert.equal(reflections.items[0].id, 'reflection');
  await writeFile(path.join(f.book, 'reading-method.json'), JSON.stringify(reading([record('one', '更新后的想法'), record('two', '第二次理解')])));
  assert.equal((await rpc.call('list_notes', { bookId: 'book1', cursor: notes.nextCursor })).isError, true);
  const updated = value(await rpc.call('read_note_thread', { bookId: 'book1', noteId: thread.id }));
  assert.equal(updated.entries.find((e) => e.id === 'reading:one').text, '更新后的想法');
});

test('rejects traversal, symlinks, invalid args and does not read arbitrary settings', async (t) => {
  const f = await fixture(t);
  const rpc = client(t, ['--library', f.root]);
  await rpc.request('initialize');
  for (const bookId of ['../book1', '/etc', '..', 'absent']) {
    assert.equal((await rpc.call('list_notes', { bookId })).isError, true);
  }
  assert.equal((await rpc.call('list_notes', { bookId: 'book1', limit: -1 })).isError, true);
  assert.equal((await rpc.call('search_notes', { query: '' })).isError, true);
  assert.equal((await rpc.call('list_books', { path: '/etc' })).isError, true);
  const secret = path.join(f.root, 'settings.json');
  await writeFile(secret, JSON.stringify({ API_KEY: 'should-never-appear' }));
  await rm(path.join(f.book, 'config.json'));
  await symlink(secret, path.join(f.book, 'config.json'));
  const response = await rpc.call('list_notes', { bookId: 'book1' });
  assert.equal(response.isError, true);
  assert.ok(!JSON.stringify(response).includes('should-never-appear'));
  assert.equal(JSON.parse(await readFile(secret, 'utf8')).API_KEY, 'should-never-appear');
});

test('reads unified JSON export, preserves note IDs, explicitly limits chapter text to excerpts', async (t) => {
  const f = await fixture(t);
  const snapshot = path.join(f.root, 'notes.json');
  const exported = { schemaVersion: 1, exportedAt: '2026-01-01', book: { hash: 'book1', title: '导出书', author: '作者' }, groups: [{ id: 'group1', chapterId: 'chapter1', chapter: '第一章', chapterOrder: 0, excerpt: '摘录正文', entries: [{ id: 'reading:one', originalId: 'one', origin: 'reading', text: '想法' }] }], reflections: [], reports: [] };
  await writeFile(snapshot, JSON.stringify(exported));
  const rpc = client(t, ['--snapshot', snapshot]);
  await rpc.request('initialize');
  assert.equal(value(await rpc.call('list_notes', { bookId: 'book1' })).items[0].id, 'group1');
  const chapters = value(await rpc.call('list_chapters', { bookId: 'book1' }));
  const chapter = value(await rpc.call('read_chapter', { bookId: 'book1', chapterId: chapters.items[0].id, limit: 2 }));
  assert.equal(chapter.source, 'note-excerpts');
  assert.equal(chapter.completeChapter, false);
  assert.equal(chapter.text, '摘录');
  assert.ok(chapter.nextCursor);
});

test('reads EPUB spine text in pages without executing scripts or loading remote content', async (t) => {
  const f = await fixture(t);
  const files = {
    'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>',
    'OEBPS/content.opf': '<package><manifest><item id="c1" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>',
    'OEBPS/chapter.xhtml': '<html><head><title>测试章</title><script>throw new Error("never")</script><style>ignored</style></head><body><h1>测试章</h1><p>第一段正文。</p><p>第二段正文。</p><img src="https://invalid.example/no"/></body></html>',
  };
  await writeFile(path.join(f.book, '测试书.epub'), zipSync(Object.fromEntries(Object.entries(files).map(([key, text]) => [key, strToU8(text)]))));
  const rpc = client(t, ['--library', f.root]);
  await rpc.request('initialize');
  const chapters = value(await rpc.call('list_chapters', { bookId: 'book1' }));
  assert.equal(chapters.items[0].source, 'epub');
  const result = value(await rpc.call('read_chapter', { bookId: 'book1', chapterId: chapters.items[0].id }));
  assert.equal(result.completeChapter, true);
  assert.match(result.text, /第一段正文。/);
  assert.match(result.text, /第二段正文。/);
  assert.ok(!result.text.includes('throw new Error'));
});

test('cached indexes declare partial scope; reports stay separate; multiple snapshots enumerate all books', async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.book, 'thematic-passages.json'), JSON.stringify({ version: 1, bookHash: 'book1', bookVersion: 'cached-version', passages: [{ bookHash: 'book1', sectionIndex: 0, chapter: '缓存第一章', excerpt: '索引段落一' }, { bookHash: 'book1', sectionIndex: 0, chapter: '缓存第一章', excerpt: '索引段落二' }] }));
  const rpc = client(t, ['--library', f.books]);
  assert.equal((await rpc.request('tools/list')).error.code, -32002);
  await rpc.request('initialize');
  assert.equal((await rpc.request('unknown/method')).error.code, -32601);
  assert.equal(value(await rpc.call('read_reflections', { bookId: 'book1', kind: 'reports' })).items[0].id, 'report');
  const chapter = value(await rpc.call('read_chapter', { bookId: 'book1', chapterId: 'section:0' }));
  assert.equal(chapter.source, 'cached-passages');
  assert.equal(chapter.completeChapter, false);
  assert.equal(chapter.bookVersion, 'cached-version');
  assert.match(chapter.text, /索引段落二/);
  const snapshots = [];
  for (const hash of ['book1', 'book2']) {
    const snapshot = path.join(f.root, `${hash}.json`);
    await writeFile(snapshot, JSON.stringify({ schemaVersion: 1, book: { hash, title: hash }, groups: [], reflections: [], reports: [] }));
    snapshots.push('--snapshot', snapshot);
  }
  const exported = client(t, snapshots);
  await exported.request('initialize');
  const first = value(await exported.call('list_books', { limit: 1 }));
  assert.equal(first.total, 2);
  assert.equal(value(await exported.call('list_books', { cursor: first.nextCursor })).items[0].hash, 'book2');
});

test('corrupt records are surfaced, not silently returned as an empty archive', async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.book, 'reading-method.json'), JSON.stringify({ version: 1, bookHash: 'book1', records: 'corrupt' }));
  const rpc = client(t, ['--library', f.root]);
  await rpc.request('initialize');
  assert.equal((await rpc.call('list_notes', { bookId: 'book1' })).isError, true);
  await writeFile(path.join(f.book, 'reading-method.json'), JSON.stringify(reading([])));
  await writeFile(path.join(f.book, 'config.json'), JSON.stringify({ booknotes: 'corrupt' }));
  assert.equal((await rpc.call('list_notes', { bookId: 'book1' })).isError, true);
});
