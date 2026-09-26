'use client';

import { useEffect, useState } from 'react';
import type { AppService } from '@/types/system';
import {
  getLocalReaderRecoveryNotices,
  LOCAL_READER_RECOVERED_EVENT,
  type LocalReaderRecoveryNotice as RecoveryNotice,
} from '@/services/localReaderPersistence';

export default function LocalReaderRecoveryNotice({ service }: { service?: AppService | null }) {
  const [notices, setNotices] = useState<RecoveryNotice[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const update = () => setNotices(service ? getLocalReaderRecoveryNotices(service) : []);
    update();
    window.addEventListener(LOCAL_READER_RECOVERED_EVENT, update);
    return () => window.removeEventListener(LOCAL_READER_RECOVERED_EVENT, update);
  }, [service]);
  const visible = notices.filter(
    (notice) => !dismissed.has(`${notice.path}:${notice.recoveredAt}`),
  );
  if (!visible.length) return null;
  return (
    <aside
      className='eink-bordered border-base-content/30 bg-base-100 text-base-content relative z-50 mx-3 my-2 rounded-lg border p-3 text-sm'
      role='status'
      aria-live='polite'
    >
      <div className='flex items-start justify-between gap-3'>
        <p>本地阅读记录已从本机备份恢复。你可以继续阅读。</p>
        <button
          type='button'
          className='shrink-0 underline underline-offset-4'
          onClick={() =>
            setDismissed(
              (previous) =>
                new Set([
                  ...previous,
                  ...visible.map((notice) => `${notice.path}:${notice.recoveredAt}`),
                ]),
            )
          }
        >
          知道了
        </button>
      </div>
      <details className='mt-2'>
        <summary className='cursor-pointer'>查看恢复记录与保留文件</summary>
        <ul className='mt-2 space-y-2'>
          {visible.map((notice) => (
            <li key={`${notice.path}:${notice.recoveredAt}`} className='break-all'>
              <span>已恢复：{notice.path}</span>
              {notice.corruptPath && (
                <p>
                  损坏原件已保留：<code>{notice.corruptPath}</code>
                </p>
              )}
            </li>
          ))}
        </ul>
      </details>
    </aside>
  );
}
