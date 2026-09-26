import { LOCAL_EDITION } from '@/services/localEdition';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import { MdExpandMore } from 'react-icons/md';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { checkForAppUpdates, checkAppReleaseNotes } from '@/helpers/updater';
import { parseWebViewInfo } from '@/utils/ua';
import { getAppVersion } from '@/utils/version';
import { writeTextToClipboard } from '@/utils/clipboard';
import { eventDispatcher } from '@/utils/event';
import SupportLinks from './SupportLinks';
import LegalLinks from './LegalLinks';
import Dialog from './Dialog';
import Link from './Link';
import ModianMascot from '@/features/reading-modes/ModianMascot';

export const setAboutDialogVisible = (visible: boolean) => {
  const dialog = document.getElementById('about_window');
  if (dialog) {
    const event = new CustomEvent('setDialogVisibility', {
      detail: { visible },
    });
    dialog.dispatchEvent(event);
  }
};

type UpdateStatus = 'checking' | 'updating' | 'updated' | 'error';

export const AboutWindow = () => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [browserInfo, setBrowserInfo] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setBrowserInfo(parseWebViewInfo(appService));

    const handleCustomEvent = (event: CustomEvent) => {
      setIsOpen(event.detail.visible);
    };

    const el = document.getElementById('about_window');
    if (el) {
      el.addEventListener('setDialogVisibility', handleCustomEvent as EventListener);
    }

    return () => {
      if (el) {
        el.removeEventListener('setDialogVisibility', handleCustomEvent as EventListener);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCheckUpdate = async () => {
    setUpdateStatus('checking');
    try {
      const hasUpdate = await checkForAppUpdates(_, false, settings.updateChannel);
      if (hasUpdate) {
        handleClose();
      } else {
        setUpdateStatus('updated');
      }
    } catch (error) {
      console.info('Error checking for updates:', error);
      setUpdateStatus('error');
    }
  };

  const handleShowRecentUpdates = async () => {
    const hasNotes = await checkAppReleaseNotes(false);
    if (hasNotes) {
      handleClose();
    } else {
      setUpdateStatus('error');
    }
  };

  const handleClose = () => {
    setIsOpen(false);
    setUpdateStatus(null);
  };

  const versionInfo = `${_('Version {{version}}', { version: getAppVersion() })} (${browserInfo})`;

  // Mobile users can't select the version string to paste it into a bug
  // report, so the label itself copies it.
  const handleCopyVersion = async () => {
    const copied = await writeTextToClipboard(versionInfo);
    if (!copied) return;
    eventDispatcher.dispatch('toast', {
      type: 'info',
      message: _('Copied to clipboard'),
      className: 'whitespace-nowrap',
      timeout: 2000,
    });
  };

  const versionButton = (
    <button
      type='button'
      title={_('Copy')}
      className='text-neutral-content rounded-md text-center text-sm focus-visible:ring-2 focus-visible:ring-base-content/15 focus-visible:outline-hidden'
      onClick={handleCopyVersion}
    >
      {versionInfo}
    </button>
  );

  const localAboutContent = (
    <div className='about-content mx-auto flex w-full max-w-[540px] flex-col gap-5 pb-6 sm:pb-8'>
      <section className='flex flex-col items-center gap-4 px-1 pt-2 text-center sm:flex-row sm:items-center sm:text-start'>
        <div className='bg-base-200/55 eink-bordered flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl border border-base-200'>
          <ModianMascot mood='reading' motion='enter' size={82} />
        </div>
        <div className='min-w-0'>
          <p className='text-base-content/55 mb-1 text-sm font-medium tracking-[0.16em]'>墨书</p>
          <h2 className='text-2xl font-semibold tracking-tight text-balance sm:text-3xl'>
            读进去，也想明白
          </h2>
          <p className='text-base-content/70 mt-2 text-sm leading-relaxed'>
            墨书是一款围绕深度阅读设计的本地阅读工具。它把原文、笔记、疑问与小墨放在同一条阅读路径里，让每一次阅读都能留下自己的理解。
          </p>
        </div>
      </section>

      <section aria-label='墨书的核心能力' className='grid grid-cols-1 gap-2 sm:grid-cols-3'>
        {[
          ['三种阅读方式', '快速浏览、细读分析、跨书探索'],
          ['回答可回到原文', '从结论直接找到书中依据'],
          ['书籍与思考留在本机', '阅读资料由你自己保管'],
        ].map(([title, description]) => (
          <div
            key={title}
            className='bg-base-200/45 eink-bordered rounded-lg border border-base-200 px-3 py-3'
          >
            <h3 className='text-sm font-semibold'>{title}</h3>
            <p className='text-base-content/60 mt-1 text-xs leading-relaxed'>{description}</p>
          </div>
        ))}
      </section>

      <div className='flex justify-center'>{versionButton}</div>

      <details className='group eink-bordered rounded-lg border border-base-200 bg-base-100'>
        <summary className='flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-4 py-2.5 text-sm font-medium focus-visible:ring-2 focus-visible:ring-base-content/15 focus-visible:outline-hidden'>
          <span>开源许可</span>
          <MdExpandMore
            aria-hidden='true'
            size={18}
            className='text-base-content/45 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none'
          />
        </summary>
        <div className='border-base-200 text-base-content/65 border-t px-4 py-3 text-xs leading-relaxed'>
          <p>
            墨书基于 Readest 开源项目构建，并依照 GNU Affero General Public License v3.0
            提供相应代码。
          </p>
          <p className='mt-2' dir='ltr'>
            © {new Date().getFullYear()} Bilingify LLC. All rights reserved.
          </p>
          <div className='mt-3 flex flex-wrap gap-x-4 gap-y-2'>
            <Link
              href='https://github.com/readest/readest'
              className='rounded-sm underline decoration-base-content/30 underline-offset-4 focus-visible:ring-2 focus-visible:ring-base-content/15 focus-visible:outline-hidden'
            >
              Readest 源代码
            </Link>
            <Link
              href='https://www.gnu.org/licenses/agpl-3.0.html'
              className='rounded-sm underline decoration-base-content/30 underline-offset-4 focus-visible:ring-2 focus-visible:ring-base-content/15 focus-visible:outline-hidden'
            >
              GNU AGPL v3
            </Link>
          </div>
        </div>
      </details>
    </div>
  );

  return (
    <Dialog
      id='about_window'
      isOpen={isOpen}
      title={LOCAL_EDITION ? '关于墨书' : _('About Readest')}
      onClose={handleClose}
      boxClassName={
        LOCAL_EDITION
          ? 'sm:h-auto! sm:max-h-[min(760px,90vh)] sm:w-[min(620px,calc(100vw-32px))]! sm:max-w-[620px]!'
          : 'sm:w-[480px]! sm:max-w-(--breakpoint-sm)! sm:h-auto'
      }
      contentClassName={LOCAL_EDITION ? 'sm:px-8' : undefined}
    >
      {isOpen &&
        (LOCAL_EDITION ? (
          localAboutContent
        ) : (
          <div className='about-content flex flex-col items-center justify-center gap-4 pb-10 sm:pb-0'>
            <div className='flex flex-1 flex-col items-center justify-end gap-2 px-8 py-2'>
              <div className='mb-2 mt-6'>
                <Image
                  src='/icon.png'
                  alt='App Logo'
                  className='h-20 w-20'
                  width={64}
                  height={64}
                />
              </div>
              <div className='flex select-text flex-col items-center'>
                <h2 className='mb-2 text-2xl font-bold'>Readest</h2>
                {versionButton}
              </div>
              <div className='my-1 h-5'>
                {!updateStatus && (
                  <button
                    className='btn btn-sm btn-primary cursor-pointer p-1 text-xs'
                    onClick={appService?.hasUpdater ? handleCheckUpdate : handleShowRecentUpdates}
                  >
                    {_('Check Update')}
                  </button>
                )}
                {updateStatus === 'updated' && (
                  <p className='text-neutral-content mt-2 text-xs'>
                    {_('Already the latest version')}
                  </p>
                )}
                {updateStatus === 'checking' && (
                  <p className='text-neutral-content mt-2 text-xs'>
                    {_('Checking for updates...')}
                  </p>
                )}
                {updateStatus === 'error' && (
                  <p className='text-error mt-2 text-xs'>{_('Error checking for updates')}</p>
                )}
              </div>
            </div>

            <hr aria-hidden='true' className='border-base-300 my-12 w-full sm:my-4' />

            <div
              className='flex flex-1 flex-col items-center justify-start gap-2 px-4 text-center'
              dir='ltr'
            >
              <p className='text-neutral-content text-sm'>
                © {new Date().getFullYear()} Bilingify LLC. All rights reserved.
              </p>

              <p className='text-neutral-content text-xs'>
                This software is licensed under the{' '}
                <Link
                  href='https://www.gnu.org/licenses/agpl-3.0.html'
                  className='text-blue-500 underline'
                >
                  GNU Affero General Public License v3.0
                </Link>
                . You are free to use, modify, and distribute this software under the terms of the
                AGPL v3 license. Please see the license for more details.
              </p>
              <p className='text-neutral-content text-xs'>
                Source code is available at{' '}
                <Link href='https://github.com/readest/readest' className='text-blue-500 underline'>
                  GitHub
                </Link>
                .
              </p>

              <LegalLinks />
            </div>
            <SupportLinks />
          </div>
        ))}
    </Dialog>
  );
};
