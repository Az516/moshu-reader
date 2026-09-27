import { unzipSync, strFromU8 } from 'fflate';
import { JSDOM } from 'jsdom';
import path from 'node:path';

function xml(text) {
  return new JSDOM(text, { contentType: 'text/xml' }).window;
}
function archivePath(base, href) {
  const decoded = decodeURIComponent(href.split('#')[0]);
  if (/^[a-z]+:|^\//i.test(decoded)) throw new Error('EPUB 包含不支持的外部正文地址。');
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(base), decoded));
  if (joined.startsWith('../')) throw new Error('EPUB 正文路径无效。');
  return joined;
}

/** Text-only EPUB spine extraction. JSDOM scripts/resources remain disabled. */
export function extractEpubChapters(bytes, toc = []) {
  let total = 0;
  const zip = unzipSync(bytes, { filter(entry) {
    if (!/\.(?:xml|opf|xhtml|html|htm)$/i.test(entry.name)) return false;
    total += entry.originalSize;
    if (entry.originalSize > 20 * 1024 * 1024 || total > 80 * 1024 * 1024) {
      throw new Error('EPUB 正文超出本地解析大小限制。');
    }
    return true;
  } });
  const getText = (name) => {
    if (!zip[name]) throw new Error('EPUB 缺少正文或目录文件。');
    return strFromU8(zip[name]);
  };
  const container = xml(getText('META-INF/container.xml'));
  const opfName = container.document.querySelector('rootfile')?.getAttribute('full-path');
  container.close();
  if (!opfName || opfName.startsWith('/') || opfName.includes('..')) throw new Error('EPUB 容器无效。');
  const opf = xml(getText(opfName));
  try {
    const items = new Map([...opf.document.querySelectorAll('manifest > item')].map((item) => [item.getAttribute('id'), item]));
    const spine = [...opf.document.querySelectorAll('spine > itemref')];
    if (!spine.length) throw new Error('EPUB 没有可读取的正文顺序。');
    return spine.map((ref, sectionIndex) => {
      const item = items.get(ref.getAttribute('idref'));
      const href = item?.getAttribute('href');
      if (!href) throw new Error('EPUB 章节缺少正文。');
      const entry = archivePath(opfName, href);
      const window = new JSDOM(getText(entry)).window;
      try {
        const doc = window.document;
        for (const node of doc.querySelectorAll('script,style,nav,svg,[hidden],[aria-hidden="true"]')) node.remove();
        const label = toc.find((chapter) => chapter.index === sectionIndex)?.label || doc.querySelector('h1,h2,title')?.textContent?.trim() || `第 ${sectionIndex + 1} 节`;
        for (const node of doc.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6,blockquote,br,tr')) node.append(doc.createTextNode('\n'));
        const text = (doc.body?.textContent || '').replace(/[ \t\r]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
        return { id: `section:${sectionIndex}`, label, sectionIndex, href: entry, source: 'epub', completeChapter: true, text };
      } finally { window.close(); }
    });
  } finally { opf.close(); }
}
