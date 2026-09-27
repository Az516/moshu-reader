import type { ArchiveGroup, BookNotesData, BookNotesExport } from './types';

export const exportBookNotesMarkdown = (data: BookNotesExport) => exportBookNotes(data, 'markdown');
export const exportBookNotesText = (data: BookNotesExport) => exportBookNotes(data, 'text');

export function createBookNotesExport(
  book: BookNotesExport['book'],
  groups: ArchiveGroup[],
  data: BookNotesData,
): BookNotesExport {
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    book,
    groups,
    reflections: data.reflections,
    reports: data.reports,
  };
}
export function exportBookNotes(
  data: BookNotesExport,
  format: 'markdown' | 'text' | 'json',
): string {
  if (format === 'json') return JSON.stringify(data, null, 2);
  const lines = [
    `# ${data.book.title} · 本书笔记`,
    '',
    `作者：${data.book.author}`,
    `书籍标识：${data.book.hash}`,
    `导出时间：${data.exportedAt}`,
    '',
  ];
  let chapter = '';
  for (const group of data.groups) {
    if (chapter !== group.chapterId) {
      chapter = group.chapterId;
      lines.push(`## ${group.chapter}`, '');
    }
    lines.push(`### ${group.excerpt ? '原文与记录' : '我的记录'}`, `来源 ID：${group.id}`, '');
    if (group.excerpt) lines.push(...group.excerpt.split('\n').map((line) => `> ${line}`), '');
    if (group.source?.cfi) lines.push(`原文位置：${group.source.cfi}`, '');
    for (const entry of group.entries) {
      lines.push(
        `#### ${entry.kind === 'question' ? '疑问' : entry.kind === 'highlight' ? '划线' : entry.kind === 'bookmark' ? '书签' : '笔记'} · ${entry.createdAt || '时间未记录'}`,
        `记录 ID：${entry.id}`,
        '',
        entry.text || '仅保存原文位置',
        '',
      );
      for (const revision of entry.reading?.revisions || [])
        lines.push(`修改前（${revision.at}）：`, revision.text, '');
      if (entry.reading?.aiText) lines.push('小墨建议（非个人笔记）：', entry.reading.aiText, '');
    }
  }
  if (data.reflections.length) lines.push('## 整书感悟', '');
  for (const item of data.reflections)
    lines.push(
      `### ${item.title || '未命名感悟'}`,
      `文档 ID：${item.id} · 更新于 ${item.updatedAt}`,
      '',
      item.text,
      '',
      ...(item.references.length ? [`引用记录：${item.references.join('、')}`, ''] : []),
    );
  if (data.reports.length) lines.push('## AI 分析（独立于个人感悟）', '');
  for (const item of data.reports)
    lines.push(
      `### ${item.title}`,
      `模型：${item.model} · ${item.createdAt}`,
      `范围：${item.scope}`,
      `已分析 ${item.coverage.entries}/${item.coverage.totalEntries} 条笔记，${item.coverage.reflections}/${item.coverage.totalReflections} 篇感悟`,
      '',
      item.text,
      '',
    );
  return format === 'text'
    ? lines.map((line) => line.replace(/^#{1,6} /, '').replace(/^> /, '')).join('\n')
    : lines.join('\n');
}
