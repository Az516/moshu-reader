import { readFile, realpath, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildArchiveGroups } from '../../src/features/book-notes/grouping.ts';

const object = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const array = (x) => Array.isArray(x) ? x : [];
const string = (x) => typeof x === 'string' ? x : '';
const flatToc = (toc) => array(toc).flatMap((item) => [item, ...flatToc(item.subitems)]);
const bookMeta = (book) => ({ hash: book.hash, title: string(book.title), author: string(book.author), ...(book.format ? { format: book.format } : {}) });
export const fingerprint = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 20);
const inside = (root, file) => file === root || file.startsWith(root + path.sep);

async function readWithin(root, file, optional = false, binary = false) {
  let actual;
  try { actual = await realpath(file); } catch (error) {
    if (optional && error.code === 'ENOENT') return undefined;
    throw new Error('指定的资料不存在或无法读取。');
  }
  if (!inside(root, actual)) throw new Error('资料路径超出已指定的书库范围。');
  const size = await stat(actual);
  if (!size.isFile() || size.size > (binary ? 150 : 64) * 1024 * 1024) throw new Error('资料不是可读取的文件或超过大小限制。');
  const bytes = await readFile(actual);
  if (binary) return bytes;
  try { return JSON.parse(bytes.toString('utf8')); } catch { throw new Error('本地 JSON 资料无法解析，原文件未修改。'); }
}
export class NotesLibrary {
  static async open({ library, snapshots = [] }) {
    if ((!library && !snapshots.length) || (library && snapshots.length)) throw new Error('请指定 --library 书库目录，或一个或多个 --snapshot JSON 文件。');
    if (snapshots.length) return new NotesLibrary(null, await Promise.all(snapshots.map((file) => realpath(path.resolve(file)))));
    const root = await realpath(path.resolve(library));
    for (const candidate of [path.join(root, 'Books'), path.join(root, 'Readest', 'Books'), root]) {
      try {
        const books = await realpath(candidate);
        if (!inside(root, books)) continue;
        await stat(path.join(books, 'library.json'));
        return new NotesLibrary(books, [], root);
      } catch { /* Try the three documented directory layouts. */ }
    }
    throw new Error('未找到 Books/library.json；请指定墨书数据目录或 Books 目录。');
  }
  constructor(booksRoot, snapshots, allowedRoot) { this.booksRoot = booksRoot; this.snapshots = snapshots; this.allowedRoot = allowedRoot; }
  async snapshotData() {
    const result = [];
    for (const file of this.snapshots) {
      const data = await readWithin(path.dirname(file), file);
      if (data?.schemaVersion !== 1 || typeof data.book?.hash !== 'string' || !Array.isArray(data.groups) || !Array.isArray(data.reflections) || !Array.isArray(data.reports) || data.groups.some((group) => typeof group?.id !== 'string' || !Array.isArray(group.entries))) throw new Error('快照不是墨书「本书笔记」导出的 JSON 格式。');
      result.push(data);
    }
    if (new Set(result.map((item) => item.book.hash)).size !== result.length) throw new Error('多个快照包含同一本书，请只保留一个版本。');
    return result;
  }
  async books() {
    if (this.snapshots.length) return (await this.snapshotData()).map((item) => bookMeta(item.book));
    const books = await readWithin(this.booksRoot, path.join(this.booksRoot, 'library.json'));
    if (!Array.isArray(books)) throw new Error('书库目录格式无法识别。');
    return books.filter((book) => object(book) && !book.deletedAt && typeof book.hash === 'string').map(bookMeta);
  }
  async book(bookId) {
    if (typeof bookId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(bookId)) throw new Error('bookId 格式无效。');
    const books = await this.books();
    const book = books.find((item) => item.hash === bookId);
    if (!book) throw new Error('指定书籍不在当前资料范围内。');
    return book;
  }
  async directory(bookId) {
    const directory = await realpath(path.join(this.booksRoot, bookId));
    if (!inside(this.booksRoot, directory) || directory === this.booksRoot) throw new Error('书籍目录超出已指定范围。');
    return directory;
  }
  async archive(bookId) {
    const book = await this.book(bookId);
    if (this.snapshots.length) return (await this.snapshotData()).find((item) => item.book.hash === bookId);
    const directory = await this.directory(bookId);
    const [native, reading, modes, nav, notes] = await Promise.all(['config.json', 'reading-method.json', 'reading-modes.json', 'nav.json', 'book-notes.json'].map((name) => readWithin(directory, path.join(directory, name), true)));
    for (const data of [reading, modes, notes]) {
      if (data && (data.version !== 1 || data.bookHash !== bookId)) throw new Error('书籍资料版本或归属不匹配。');
    }
    if (native?.booknotes !== undefined && (!Array.isArray(native.booknotes) || native.booknotes.some((note) => !object(note) || typeof note.id !== 'string'))) throw new Error('划线批注格式无法识别，原文件未修改。');
    if (reading && (!Array.isArray(reading.records) || reading.records.some((record) => !object(record) || typeof record.id !== 'string' || typeof record.userText !== 'string'))) throw new Error('阅读笔记格式无法识别，原文件未修改。');
    if (modes && (!object(modes.captures) || !object(modes.reconstructions) || Object.values(modes.captures).some((text) => typeof text !== 'string'))) throw new Error('章节思考格式无法识别，原文件未修改。');
    if (notes && (!Array.isArray(notes.reflections) || !Array.isArray(notes.reports))) throw new Error('感悟与分析稿格式无法识别，原文件未修改。');
    return { schemaVersion: 1, book, groups: buildArchiveGroups({ book, booknotes: array(native?.booknotes), readingData: reading, modeState: modes, toc: array(nav?.toc) }), reflections: array(notes?.reflections), reports: array(notes?.reports) };
  }
  async chapters(bookId) {
    const archive = await this.archive(bookId);
    if (this.booksRoot) {
      const directory = await this.directory(bookId);
      const nav = await readWithin(directory, path.join(directory, 'nav.json'), true);
      const files = (await readdir(directory)).filter((file) => /\.epub$/i.test(file));
      let epubPath = files.length === 1 ? path.join(directory, files[0]) : undefined;
      if (!epubPath) {
        const books = await readWithin(this.booksRoot, path.join(this.booksRoot, 'library.json'));
        const book = books.find((item) => item.hash === bookId);
        if (typeof book?.filePath === 'string' && /\.epub$/i.test(book.filePath) && inside(this.allowedRoot, path.resolve(book.filePath))) epubPath = path.resolve(book.filePath);
      }
      if (epubPath) {
        const bytes = await readWithin(this.allowedRoot, epubPath, false, true);
        const { extractEpubChapters } = await import('./epub.mjs');
        return extractEpubChapters(bytes, flatToc(nav?.toc));
      }
      const cache = await readWithin(directory, path.join(directory, 'thematic-passages.json'), true);
      if (cache?.version === 1 && cache.bookHash === bookId && Array.isArray(cache.passages)) {
        const chapters = new Map();
        for (const passage of cache.passages) {
          if (passage.bookHash !== bookId || !Number.isInteger(passage.sectionIndex) || typeof passage.excerpt !== 'string') throw new Error('本地原文索引格式无效。');
          const id = `section:${passage.sectionIndex}`;
          if (!chapters.has(id)) chapters.set(id, { id, label: passage.chapter, sectionIndex: passage.sectionIndex, source: 'cached-passages', completeChapter: false, bookVersion: cache.bookVersion, text: '' });
          const chapter = chapters.get(id);
          chapter.text += `${chapter.text ? '\n\n' : ''}${passage.excerpt}`;
        }
        if (chapters.size) return [...chapters.values()].sort((a, b) => a.sectionIndex - b.sectionIndex);
      }
    }
    const chapters = new Map();
    for (const group of archive.groups) {
      const id = group.chapterId || `label:${group.chapter || '全书笔记'}`;
      if (!chapters.has(id)) chapters.set(id, { id, label: group.chapter || '全书笔记', source: 'note-excerpts', completeChapter: false, excerpts: new Set() });
      if (group.excerpt) chapters.get(id).excerpts.add(group.excerpt);
    }
    return [...chapters.values()].map(({ excerpts, ...chapter }) => ({ ...chapter, text: [...excerpts].join('\n\n') }));
  }
}
