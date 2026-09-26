import { IconType } from 'react-icons';
import { PiChatCircleText, PiQuestion, PiNotebook } from 'react-icons/pi';
import { FiSearch } from 'react-icons/fi';
import { FiLink } from 'react-icons/fi';
import { FiShare } from 'react-icons/fi';
import { PiHighlighterFill } from 'react-icons/pi';
import { LuBookA } from 'react-icons/lu';
import { BsPencilSquare } from 'react-icons/bs';
import { BsTranslate } from 'react-icons/bs';
import { FaHeadphones } from 'react-icons/fa6';
import { IoIosBuild } from 'react-icons/io';
import { AnnotationToolType } from '@/types/annotator';
import { stubTranslation as _ } from '@/utils/misc';
import type { ShortcutAction } from '@/helpers/shortcuts';

type AnnotationToolButton = {
  type: AnnotationToolType;
  label: string;
  tooltip: string;
  Icon: IconType;
  quickAction?: boolean;
  shortcutAction?: ShortcutAction;
  shortcut?: string;
};

function createAnnotationToolButtons(buttons: AnnotationToolButton[]): AnnotationToolButton[] {
  return buttons;
}

export const annotationToolButtons = createAnnotationToolButtons([
  {
    type: 'ask-reading',
    label: _('呼叫小墨'),
    tooltip: _('带着选文呼叫小墨'),
    shortcut: 'cmd+e',
    Icon: PiChatCircleText,
  },
  {
    type: 'save-question',
    label: _('Save a reading question'),
    tooltip: _('Keep a question and continue reading'),
    Icon: PiQuestion,
  },
  {
    type: 'write-understanding',
    label: _('Write my understanding'),
    tooltip: _('Compare my understanding with the passage'),
    Icon: PiNotebook,
  },
  {
    type: 'copylink',
    label: _('Copy Link'),
    tooltip: _('Copy link to text after selection'),
    Icon: FiLink,
  },
  {
    type: 'highlight',
    label: _('Highlight'),
    tooltip: _('Highlight text after selection'),
    shortcutAction: 'onHighlightSelection',
    Icon: PiHighlighterFill,
    quickAction: true,
  },
  {
    type: 'annotate',
    label: _('Annotate'),
    tooltip: _('Annotate text after selection'),
    shortcutAction: 'onAnnotateSelection',
    Icon: BsPencilSquare,
  },
  {
    type: 'search',
    label: _('Search'),
    tooltip: _('Search text after selection'),
    shortcutAction: 'onSearchSelection',
    Icon: FiSearch,
    quickAction: true,
  },
  {
    type: 'dictionary',
    label: _('Dictionary'),
    tooltip: _('Look up text in dictionary after selection'),
    shortcutAction: 'onDictionarySelection',
    Icon: LuBookA,
    quickAction: true,
  },
  {
    type: 'translate',
    label: _('Translate'),
    tooltip: _('Translate text after selection'),
    shortcutAction: 'onTranslateSelection',
    Icon: BsTranslate,
    quickAction: true,
  },
  {
    type: 'tts',
    label: _('Speak'),
    tooltip: _('Read text aloud after selection'),
    shortcutAction: 'onReadAloudSelection',
    Icon: FaHeadphones,
    quickAction: true,
  },
  {
    type: 'proofread',
    label: _('Proofread'),
    tooltip: _('Proofread text after selection'),
    shortcutAction: 'onProofreadSelection',
    Icon: IoIosBuild,
  },
  {
    type: 'share',
    label: _('Share'),
    tooltip: _('Share text after selection'),
    Icon: FiShare,
    quickAction: true,
  },
]);

export const annotationToolQuickActions = annotationToolButtons.filter(
  (button) => button.quickAction,
);
