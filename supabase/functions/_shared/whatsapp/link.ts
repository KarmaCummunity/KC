// Issue #1090: parse a link-code message ("123456", "LINK 123456", "קישור 123456") and
// the fixed replies to a redeem result. Codes are issued in the app (Pro only).

import type { Lang } from './replies.ts';

const LINK_RE = /^\s*(?:(link|connect|קישור|חיבור|קוד)\s*[:\-]?\s*)?(\d{6})\s*$/i;

export type LinkStatus = 'linked' | 'invalid' | 'locked' | 'not_pro';

export function parseLinkCode(text: string): { code: string; lang: Lang } | null {
  const m = LINK_RE.exec(text ?? '');
  if (!m) return null;
  const word = (m[1] ?? '').toLowerCase();
  return { code: m[2], lang: word === 'link' || word === 'connect' ? 'en' : 'he' };
}

const REPLIES: Record<LinkStatus, Record<Lang, string>> = {
  linked: {
    he: 'המספר חובר לחשבון שלך בקהילת קארמה. אפשר לכתוב לי מה את/ה מחפש/ת או מציע/ה.',
    en: 'This number is now linked to your Karma Community account. Tell me what you are looking for or offering.',
  },
  invalid: {
    he: 'הקוד לא תקין או שפג תוקפו. צור/י קוד חדש באפליקציה ושלח/י אותו כאן.',
    en: 'That code is invalid or expired. Create a new code in the app and send it here.',
  },
  locked: {
    he: 'יותר מדי ניסיונות. נסה/י שוב בעוד שעה.',
    en: 'Too many attempts. Please try again in an hour.',
  },
  not_pro: {
    he: 'הבוט האישי בוואטסאפ זמין למנויי Pro. אפשר להצטרף באפליקציה.',
    en: 'The personal WhatsApp bot is for Pro members. You can upgrade in the app.',
  },
};

export function isLinkStatus(v: unknown): v is LinkStatus {
  return v === 'linked' || v === 'invalid' || v === 'locked' || v === 'not_pro';
}

export function linkReply(status: LinkStatus, lang: Lang): string {
  return REPLIES[status][lang];
}
