// Fixed replies to consent keywords (issue #937). Sent as free-form session messages,
// which Meta allows inside the 24h customer-service window opened by the user's message.

export type Lang = 'he' | 'en';
export type KeywordAction = 'opt_out' | 'opt_in' | 'help';

const REPLIES: Record<KeywordAction, Record<Lang, string>> = {
  opt_out: {
    he: 'הוסרת מהודעות קהילת קארמה ב-WhatsApp. לא נשלח לך הודעות נוספות. כדי לחזור, שלח/י "הצטרף".',
    en: 'You have been unsubscribed from Karma Community WhatsApp messages. Reply START to subscribe again.',
  },
  opt_in: {
    he: 'נרשמת להתראות התאמה מקהילת קארמה ב-WhatsApp. להסרה בכל עת שלח/י "הסר". לעזרה: "עזרה".',
    en: 'You are subscribed to Karma Community match alerts on WhatsApp. Reply STOP to unsubscribe, HELP for help.',
  },
  help: {
    he: 'קהילת קארמה: שלח/י "הסר" להפסקת הודעות, "הצטרף" לחידוש, או פנה/י אלינו דרך האפליקציה.',
    en: 'Karma Community: reply STOP to unsubscribe, START to resubscribe, or contact us in the app.',
  },
};

export function isKeywordAction(v: unknown): v is KeywordAction {
  return v === 'opt_out' || v === 'opt_in' || v === 'help';
}

export function keywordReply(action: KeywordAction, lang: string | null | undefined): string {
  return REPLIES[action][lang === 'en' ? 'en' : 'he'];
}

/** opt_out/opt_in confirmations must reach the user even right after STOP. */
export function replyKind(action: KeywordAction): 'consent_confirmation' | 'help' {
  return action === 'help' ? 'help' : 'consent_confirmation';
}

// #1086: the personal bot is Pro only. Sent at most once per 24h per number.
const UPSELL: Record<'unlinked' | 'not_pro', Record<Lang, string>> = {
  unlinked: {
    he: 'הבוט האישי של קהילת קארמה בוואטסאפ זמין למנויי Pro. כדי להתחיל: באפליקציה, הגדרות > וואטסאפ, צור/י קוד ושלח/י אותו כאן.',
    en: 'The personal Karma Community WhatsApp bot is for Pro members. To start: in the app, Settings > WhatsApp, create a code and send it here.',
  },
  not_pro: {
    he: 'הבוט האישי בוואטסאפ זמין למנויי Pro. אפשר לשדרג באפליקציה, ואז פשוט לכתוב לי כאן.',
    en: 'The personal WhatsApp bot is for Pro members. Upgrade in the app, then just message me here.',
  },
};

export function upsellReply(access: 'unlinked' | 'not_pro', lang: Lang): string {
  return UPSELL[access][lang];
}

/** Hebrew letters anywhere → he; otherwise en if there are Latin letters; default he. */
export function detectLang(text: string): Lang {
  if (/[\u0590-\u05ff]/.test(text)) return 'he';
  return /[a-z]/i.test(text) ? 'en' : 'he';
}
