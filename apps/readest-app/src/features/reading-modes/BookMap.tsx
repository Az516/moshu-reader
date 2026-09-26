import { useEffect, useState } from 'react';
import { PiArrowRight, PiCheck, PiX } from 'react-icons/pi';
import type { BookDoc, TOCItem } from '@/libs/document';
import type { ModeState } from './state';
import IconButton from './IconButton';
export const mapSteps = ['目录', '序言', '章首尾', '抽样阅读', '决定精读范围'];
export const flattenToc = (toc: TOCItem[]): TOCItem[] =>
  toc.flatMap((item) => [item, ...flattenToc(item.subitems || [])]);
const isPreface = (label: string) =>
  /序言|前言|自序|译者序|譯者序|导言|導言|引言|绪论|緒論|\b(preface|foreword|introduction)\b/i.test(
    label,
  );
export default function BookMap({
  doc,
  state,
  onChange,
  onGo,
  onClose,
  onAnalyze,
}: {
  doc: BookDoc;
  state: ModeState;
  onChange: (mutate: (s: ModeState) => ModeState) => Promise<void>;
  onGo: (target: string | number) => void;
  onClose: () => void;
  onAnalyze: () => void;
}) {
  const toc = flattenToc(doc.toc || []);
  const prefaceEntries = toc.filter((item) => isPreface(item.label));
  const [samples, setSamples] = useState<{ index: number; first: string; last: string }[]>([]);
  const [prefaces, setPrefaces] = useState<{ href: string; label: string; excerpt: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const scan = async () => {
      const result: { index: number; first: string; last: string }[] = [];
      const introductions: { href: string; label: string; excerpt: string }[] = [];
      const entries = flattenToc(doc.toc || []).filter((item) => isPreface(item.label));
      setLoading(true);
      setError('');
      for (let index = 0; index < doc.sections.length; index++) {
        const section = doc.sections[index]!;
        if (section.linear === 'no') continue;
        try {
          const source = await section.createDocument();
          const elements = [...source.querySelectorAll('p,blockquote')];
          const blocks = elements
            .map((el) => el.textContent?.trim() || '')
            .filter((text) => text.length > 30);
          if (blocks.length)
            result.push({
              index,
              first: blocks[0]!.slice(0, 260),
              last: blocks[blocks.length - 1]!.slice(-260),
            });
          for (const entry of entries) {
            const [path, fragment] = doc.splitTOCHref(entry.href);
            if (path !== section.id && path !== section.href) continue;
            const anchor = fragment
              ? source.getElementById(decodeURIComponent(String(fragment)))
              : null;
            if (fragment && !anchor) continue;
            const nextHeading =
              anchor &&
              [...source.querySelectorAll('h1,h2,h3,h4,h5,h6')].find(
                (heading) =>
                  heading !== anchor &&
                  anchor.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
              );
            const first = elements.find(
              (element) =>
                (element.textContent?.trim().length ?? 0) > 0 &&
                (!anchor ||
                  element === anchor ||
                  anchor.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) &&
                (!nextHeading ||
                  element.compareDocumentPosition(nextHeading) & Node.DOCUMENT_POSITION_FOLLOWING),
            );
            introductions.push({
              href: entry.href,
              label: entry.label,
              excerpt: first?.textContent?.trim().slice(0, 260) || '',
            });
          }
        } catch {
          if (active) setError('部分章节暂时无法扫描，仍可从目录进入原文。');
        }
        if (!active) return;
      }
      setSamples(result);
      setPrefaces(introductions);
      setLoading(false);
    };
    void scan().catch(() => {
      if (active) setError('部分章节暂时无法扫描，仍可从目录进入原文。');
    });
    return () => {
      active = false;
    };
  }, [doc]);
  const selected =
    state.stage === 3
      ? samples.filter((_, i) => i % Math.max(1, Math.floor(samples.length / 4)) === 0).slice(0, 4)
      : samples;
  return (
    <div className='moshu-overlay'>
      <section
        className='moshu-sheet moshu-map-sheet'
        role='dialog'
        aria-modal='true'
        aria-label='全书地图'
      >
        <header>
          <div>
            <small>全书地图 · {state.stage + 1} / 5</small>
            <h2>{mapSteps[state.stage]}</h2>
          </div>
          <IconButton label='收起地图' purpose='回到正文' shortcut='Esc' onClick={onClose}>
            <PiX />
          </IconButton>
        </header>
        <p className='moshu-muted'>
          沿着脉络，先建立一个全局的地图。以下为书中原文摘录，由你决定值得深入的部分。
        </p>
        {error && <p role='status'>{error}</p>}
        <div className='moshu-map-content'>
          {state.stage === 0 || state.stage === 4 ? (
            toc.length ? (
              toc.map((item, i) => (
                <div className='moshu-toc-row' key={`${item.href}-${i}`}>
                  {state.stage === 4 && (
                    <input
                      type='checkbox'
                      aria-label={`精读 ${item.label}`}
                      checked={state.intensive.includes(item.href)}
                      onChange={(e) => {
                        const checked = e.currentTarget.checked;
                        void onChange((s) => ({
                          ...s,
                          intensive: checked
                            ? [...new Set([...s.intensive, item.href])]
                            : s.intensive.filter((h) => h !== item.href),
                        }));
                      }}
                    />
                  )}
                  <button
                    type='button'
                    onClick={() => {
                      onGo(item.href);
                      onClose();
                    }}
                  >
                    <span>{String(i + 1).padStart(2, '0')}</span>
                    {item.label}
                    <PiArrowRight />
                  </button>
                </div>
              ))
            ) : (
              <p>本书未提供目录，可通过正文页码选择阅读位置。</p>
            )
          ) : state.stage === 1 ? (
            prefaceEntries.length ? (
              prefaceEntries.map((entry) => (
                <article key={entry.href}>
                  <button
                    type='button'
                    onClick={() => {
                      onGo(entry.href);
                      onClose();
                    }}
                  >
                    {entry.label} · 回到原文 <PiArrowRight />
                  </button>
                  {prefaces.find((item) => item.href === entry.href)?.excerpt ? (
                    <blockquote>
                      {prefaces.find((item) => item.href === entry.href)!.excerpt}
                    </blockquote>
                  ) : (
                    <p className='moshu-muted'>
                      {loading ? '正在读取序言原文…' : '可从目录位置进入序言原文。'}
                    </p>
                  )}
                </article>
              ))
            ) : (
              <div>
                <p>本书未单列序言。可以查看目录，或从开篇进入原文。</p>
                <button type='button' onClick={() => void onChange((s) => ({ ...s, stage: 0 }))}>
                  查看目录
                </button>
                <button
                  type='button'
                  onClick={() => {
                    onGo(toc[0]?.href || samples[0]?.index || 0);
                    onClose();
                  }}
                >
                  从开篇开始
                </button>
              </div>
            )
          ) : !samples.length ? (
            <p role='status'>
              {loading ? '正在读取章节原文…' : '尚未找到可摘取的正文段落，可从目录进入原文。'}
            </p>
          ) : (
            selected.map((sample) => (
              <article key={sample.index}>
                <button
                  type='button'
                  onClick={() => {
                    onGo(sample.index);
                    onClose();
                  }}
                >
                  第 {sample.index + 1} 节 · 回到原文 <PiArrowRight />
                </button>
                <blockquote>{sample.first}</blockquote>
                {state.stage === 2 && sample.last !== sample.first && (
                  <blockquote>{sample.last}</blockquote>
                )}
              </article>
            ))
          )}
        </div>
        <footer>
          {state.stage > 0 && (
            <button
              type='button'
              onClick={() => void onChange((s) => ({ ...s, stage: Math.max(0, s.stage - 1) }))}
            >
              上一步
            </button>
          )}
          {state.stage < 4 ? (
            <button
              type='button'
              className='moshu-primary'
              onClick={() => void onChange((s) => ({ ...s, stage: Math.min(4, s.stage + 1) }))}
            >
              <PiCheck /> 我已检视，继续
            </button>
          ) : (
            <button
              type='button'
              className='moshu-primary'
              disabled={!state.intensive.length}
              onClick={onAnalyze}
            >
              进入分析阅读 <PiArrowRight />
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
