import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BookDoc } from '@/libs/document';
import type { AppService } from '@/types/system';
import BookMap from './BookMap';
import { emptyModeState, mutateModeState } from './state';

afterEach(cleanup);
describe('book map persistence', () => {
  it('persists the checked state captured before asynchronous storage completes', async () => {
    const initial = { ...emptyModeState('book'), stage: 4 };
    const files = new Map([['book/reading-modes.json', JSON.stringify(initial)]]);
    const persisted = () => files.get('book/reading-modes.json')!;
    const service = {
      exists: async (path: string) => files.has(path),
      readFile: async (path: string) => files.get(path)!,
      createDir: async () => {},
      writeFile: async (path: string, _base: string, text: string) => {
        files.set(path, text);
      },
      replaceFile: async (from: string, to: string) => {
        files.set(to, files.get(from)!);
        files.delete(from);
      },
      deleteFile: async (path: string) => {
        files.delete(path);
      },
    } as unknown as AppService;
    const doc = {
      toc: [{ href: 'chapter.xhtml', label: '第一章' }],
      sections: [],
    } as unknown as BookDoc;
    function Harness() {
      const [state, setState] = useState(initial);
      return (
        <BookMap
          doc={doc}
          state={state}
          onChange={async (mutate) => setState(await mutateModeState(service, 'book', mutate))}
          onGo={vi.fn()}
          onClose={vi.fn()}
          onAnalyze={vi.fn()}
        />
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('checkbox', { name: '精读 第一章' }));
    await waitFor(() => expect(JSON.parse(persisted()).intensive).toEqual(['chapter.xhtml']));
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: '精读 第一章' }));
    await waitFor(() => expect(JSON.parse(persisted()).intensive).toEqual([]));
  });

  it('uses the preface TOC anchor instead of the first copyright passage', async () => {
    const copyright = '版权页不是作者的序言。'.repeat(6);
    const preface = '这是作者在前言中说明的写作缘起。'.repeat(4);
    const source = new DOMParser().parseFromString(
      `<p>${copyright}</p><h1 id='preface'>前言</h1><p>${preface}</p><h1 id='chapter'>第一章</h1><p>${'第一章原文。'.repeat(10)}</p>`,
      'text/html',
    );
    const doc = {
      toc: [
        { href: 'all.xhtml#preface', label: '作者前言' },
        { href: 'all.xhtml#chapter', label: '第一章' },
      ],
      sections: [{ id: 'all.xhtml', createDocument: async () => source }],
      splitTOCHref: (href: string) => href.split('#'),
    } as unknown as BookDoc;
    render(
      <BookMap
        doc={doc}
        state={{ ...emptyModeState('book'), stage: 1 }}
        onChange={vi.fn()}
        onGo={vi.fn()}
        onClose={vi.fn()}
        onAnalyze={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText(preface)).toBeTruthy());
    expect(screen.queryByText(copyright)).toBeNull();
  });

  it('explains that a book has no separate preface instead of relabeling its opening chapter', async () => {
    const doc = {
      toc: [{ href: 'chapter.xhtml', label: '第一章' }],
      sections: [],
      splitTOCHref: (href: string) => href.split('#'),
    } as unknown as BookDoc;
    render(
      <BookMap
        doc={doc}
        state={{ ...emptyModeState('book'), stage: 1 }}
        onChange={vi.fn()}
        onGo={vi.fn()}
        onClose={vi.fn()}
        onAnalyze={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText('本书未单列序言。可以查看目录，或从开篇进入原文。')).toBeTruthy(),
    );
  });
});
