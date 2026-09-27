'use client';

import { useEffect, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useNotebookStore } from '@/store/notebookStore';
import { isTauriAppPlatform } from '@/services/environment';
import { makeSafeFilename } from '@/utils/misc';
import { ReadingMethodPanel } from '../reading-method';
import type {
  CreateReadingRecord,
  ReadingMethodRecord,
  ReadingRecordPatch,
} from '../reading-method/types';
import {
  emptyReadingData,
  exportReadingMarkdown,
  loadReadingData,
  mutateReadingData,
} from './data';
import type { ReadingData, ReadingRecord } from './data';
import { askReadingAI, defaultAIConfig, loadAIConfig, readAIKey, saveAIConfig } from './ai';
import { actionTab, useReadingSession } from './session';

export function AIConnection({
  contextDescription = '提问时只发送所选片段和必要邻文。',
}: {
  contextDescription?: string;
} = {}) {
  const [config, setConfig] = useState(defaultAIConfig);
  const [key, setKey] = useState('');
  const [savedKey, setSavedKey] = useState(false);
  const [readingKey, setReadingKey] = useState(true);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    try {
      setConfig(loadAIConfig());
    } catch {
      setMessage('模型配置无法读取，请重新填写。');
    }
    void readAIKey()
      .then((value) => setSavedKey(Boolean(value)))
      .catch((error) => setMessage(error instanceof Error ? error.message : '暂时无法读取钥匙串。'))
      .finally(() => setReadingKey(false));
  }, []);
  const save = async (clear = false) => {
    setBusy(true);
    setMessage('');
    try {
      await saveAIConfig(config, key, clear);
      setKey('');
      setSavedKey(Boolean(await readAIKey()));
      setMessage(clear ? '已移除 API Key。' : `配置已保存。${contextDescription}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败，请重试。');
    } finally {
      setBusy(false);
    }
  };
  const field = 'input input-bordered eink-bordered h-9 w-full text-sm';
  return (
    <details className='border-base-300 shrink-0 border-b px-4 py-2 text-sm' data-reading-ai-config>
      <summary className='cursor-pointer py-1 font-medium'>
        模型连接{readingKey ? ' · 正在读取连接' : savedKey ? ' · 已配置' : ' · 待配置'}
      </summary>
      <div className='mt-3 space-y-3 pb-2'>
        <p className='text-base-content/70 text-xs leading-relaxed'>
          接入 OpenAI-compatible 服务。桌面端 Key 保存在系统钥匙串；网页预览仅在当前会话使用。
        </p>
        <label className='block space-y-1'>
          <span>服务地址</span>
          <input
            aria-label='服务地址'
            className={field}
            type='url'
            value={config.baseUrl}
            onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
            placeholder='https://your-provider.example/v1'
          />
        </label>
        <label className='block space-y-1'>
          <span>模型名称</span>
          <input
            aria-label='模型名称'
            className={field}
            value={config.model}
            onChange={(e) => setConfig({ ...config, model: e.target.value })}
            placeholder='填写服务商提供的模型 ID'
          />
        </label>
        <label className='block space-y-1'>
          <span>API Key</span>
          <input
            aria-label='API Key'
            type='password'
            autoComplete='off'
            className={field}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={savedKey ? '已保存，留空保持原 Key' : '输入 API Key'}
          />
        </label>
        {!isTauriAppPlatform() && (
          <p className='text-base-content/70 text-xs'>网页预览的服务端须允许跨域请求。</p>
        )}
        <div className='flex gap-2'>
          <button
            type='button'
            className='btn btn-sm btn-contrast'
            disabled={busy}
            onClick={() => void save()}
          >
            保存连接
          </button>
          {savedKey && (
            <button
              type='button'
              className='btn btn-sm btn-ghost eink-bordered'
              disabled={busy}
              onClick={() => void save(true)}
            >
              移除 Key
            </button>
          )}
        </div>
        {message && (
          <p role='status' className='text-xs leading-relaxed'>
            {message}
          </p>
        )}
      </div>
    </details>
  );
}

export default function ReadingWorkspace({ bookKey }: { bookKey: string }) {
  const { appService } = useEnv();
  const bookHash = bookKey.split('-')[0]!;
  const bookData = useBookDataStore((state) => state.booksData[bookHash]);
  const request = useReadingSession((state) => state.request);
  const currentRequest = request?.bookKey === bookKey ? request : null;
  const [data, setData] = useState<ReadingData | null>(null);
  const [error, setError] = useState('');
  const [streaming, setStreaming] = useState<{ id: string; text: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeRecordId = useRef<string | null>(null);
  const mounted = useRef(true);
  const dataRef = useRef<ReadingData | null>(null);
  const consumedRequests = useRef(new Set<number>());
  const initial = emptyReadingData(
    bookHash,
    bookData?.book?.title || '',
    bookData?.book?.author || '',
  );

  useEffect(() => {
    mounted.current = true;
    if (appService)
      void loadReadingData(appService, initial)
        .then((value) => {
          if (mounted.current) {
            dataRef.current = value;
            setData(value);
          }
        })
        .catch((reason: unknown) => {
          if (mounted.current)
            setError(reason instanceof Error ? reason.message : '读取记录失败。');
        });
    return () => {
      mounted.current = false;
      abortRef.current?.abort();
    };
    // The parent keys this workspace by book hash, isolating every book's requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService, bookHash]);

  async function save(mutate: (value: ReadingData) => ReadingData) {
    if (!appService) throw new Error('书库尚未就绪。');
    const next = await mutateReadingData(appService, initial, mutate);
    dataRef.current = next;
    if (mounted.current) setData(next);
    return next;
  }
  async function createRecord(input: CreateReadingRecord): Promise<ReadingRecord> {
    if (input.source?.bookHash && input.source.bookHash !== bookHash)
      throw new Error('所选原文属于另一本书，请重新选文。');
    const now = new Date().toISOString();
    const record: ReadingRecord = {
      ...input,
      id: crypto.randomUUID(),
      originalText: input.userText,
      revisions: [],
      createdAt: now,
      updatedAt: now,
    };
    await save((value) => ({ ...value, records: [...value.records, record] }));
    return record;
  }
  async function updateRecord(id: string, patch: ReadingRecordPatch) {
    if (activeRecordId.current === id)
      throw new Error('请先等待当前回答结束，或停止回答后再修改这条记录。');
    if (patch.source && patch.source.bookHash !== bookHash) throw new Error('只能关联本书原文。');
    await save((value) => ({
      ...value,
      records: value.records.map((record) => {
        if (record.id !== id) return record;
        const changed = patch.userText !== undefined && patch.userText !== record.userText;
        return {
          ...record,
          ...patch,
          source: record.source || patch.source,
          updatedAt: new Date().toISOString(),
          revisions: changed
            ? [...record.revisions, { text: record.userText, at: new Date().toISOString() }]
            : record.revisions,
        };
      }),
    }));
  }
  async function askAI(record: ReadingMethodRecord) {
    if (abortRef.current) throw new Error('已有回答正在生成，请稍候或停止当前回答。');
    if (!record.source || record.source.bookHash !== bookHash)
      throw new Error('请先为这条记录选择本书原文。');
    const controller = new AbortController();
    abortRef.current = controller;
    activeRecordId.current = record.id;
    const timeout = setTimeout(() => controller.abort(new Error('请求超时')), 60000);
    setError('');
    setStreaming({ id: record.id, text: '' });
    try {
      const result = await askReadingAI(
        record,
        dataRef.current?.profile || initial.profile,
        controller.signal,
        (text) => {
          if (mounted.current) setStreaming({ id: record.id, text });
        },
      );
      await save((value) => ({
        ...value,
        records: value.records.map((item) =>
          item.id !== record.id
            ? item
            : {
                ...item,
                aiText: result.text,
                aiInputText: record.userText,
                model: result.model,
                updatedAt: new Date().toISOString(),
                aiHistory: item.aiText
                  ? [
                      ...(item.aiHistory || []),
                      {
                        text: item.aiText,
                        model: item.model,
                        inputText: item.aiInputText,
                        at: item.updatedAt || new Date().toISOString(),
                      },
                    ]
                  : item.aiHistory,
              },
        ),
      }));
    } catch (reason) {
      const message = controller.signal.aborted
        ? controller.signal.reason instanceof Error &&
          controller.signal.reason.message === '请求超时'
          ? '模型请求超时，个人记录已保存，可以重试。'
          : '回答已停止，个人记录已保存。'
        : reason instanceof Error
          ? reason.message
          : '模型请求失败，请重试。';
      if (mounted.current) setError(message);
      throw new Error(message);
    } finally {
      clearTimeout(timeout);
      abortRef.current = null;
      activeRecordId.current = null;
      if (mounted.current) setStreaming(null);
    }
  }

  // A toolbar click is handled once even across React StrictMode's effect replay.
  useEffect(() => {
    if (!data || !currentRequest || currentRequest.action !== 'ask' || !currentRequest.source)
      return;
    if (consumedRequests.current.has(currentRequest.nonce) || currentRequest.handled) return;
    consumedRequests.current.add(currentRequest.nonce);
    useReadingSession.setState({ request: { ...currentRequest, handled: true } });
    void createRecord({
      kind: 'question',
      status: 'open',
      source: currentRequest.source,
      userText: '请解释这段话的含义，指出作者的理由与原文依据。',
    })
      .then(askAI)
      .catch((reason: unknown) => {
        if (mounted.current) setError(reason instanceof Error ? reason.message : '提问失败。');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, currentRequest?.nonce]);

  if (!bookData?.book) return null;
  return (
    <div className='flex min-h-0 flex-1 flex-col' data-active-reading-workspace>
      <AIConnection />
      {error && (
        <div
          role='alert'
          className='eink-bordered border-base-300 mx-3 mt-2 rounded-lg border p-3 text-sm'
        >
          {error}
          <button className='btn btn-xs btn-ghost ms-2' onClick={() => setError('')}>
            收起
          </button>
        </div>
      )}
      {streaming && (
        <div role='status' className='flex items-center justify-between px-4 py-2 text-xs'>
          <span>正在对照原文…</span>
          <button
            className='btn btn-xs btn-ghost eink-bordered'
            onClick={() => abortRef.current?.abort()}
          >
            停止回答
          </button>
        </div>
      )}
      {!data ? (
        <p className='p-4 text-sm'>
          {error ? '原记录未被修改。重新打开侧栏可重试读取。' : '正在读取本书记录…'}
        </p>
      ) : (
        <ReadingMethodPanel
          bookId={bookHash}
          bookTitle={bookData.book.title}
          bookAuthor={bookData.book.author}
          profile={data.profile}
          source={currentRequest?.source}
          records={data.records.map((record) =>
            record.id === streaming?.id && streaming.text
              ? { ...record, aiText: streaming.text }
              : record,
          )}
          focusRequest={
            currentRequest
              ? {
                  tab: actionTab(currentRequest.action),
                  nonce: currentRequest.nonce,
                  kind: currentRequest.action === 'understanding' ? 'understanding' : undefined,
                }
              : undefined
          }
          onProfileChange={async (profile) => {
            await save((value) => ({ ...value, profile }));
          }}
          onCreateRecord={createRecord}
          onUpdateRecord={updateRecord}
          onAskAI={askAI}
          onGoToSource={(source) => {
            if (source.bookHash !== bookHash || !source.cfi) {
              setError('这条原文没有可用的本书位置。');
              return;
            }
            void Promise.resolve()
              .then(() => useReaderStore.getState().getView(bookKey)?.goTo(source.cfi!))
              .then(() => {
                if (!useNotebookStore.getState().isNotebookPinned)
                  useNotebookStore.getState().setNotebookVisible(false);
              })
              .catch(() => setError('无法定位原文，请确认书籍版本。'));
          }}
          onOpenContents={() => {
            const store = useBookDataStore.getState();
            const config = store.getConfig(bookKey);
            if (config)
              store.setConfig(bookKey, {
                viewSettings: { ...config.viewSettings, sideBarTab: 'toc' },
              });
            useSidebarStore.getState().setSideBarVisible(true);
            if (!useNotebookStore.getState().isNotebookPinned)
              useNotebookStore.getState().setNotebookVisible(false);
          }}
          onExport={async () => {
            if (!appService || !dataRef.current) return;
            await appService.saveFile(
              `${makeSafeFilename(dataRef.current.bookTitle)}-阅读记录.md`,
              exportReadingMarkdown(dataRef.current),
              { mimeType: 'text/markdown' },
            );
          }}
        />
      )}
    </div>
  );
}
